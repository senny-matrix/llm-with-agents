import { getTracer, Laminar } from "@lmnr-ai/lmnr";
import { type ModelMessage, type ToolSet, streamText } from "ai";
import { config } from "dotenv";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import type { AgentCallbacks, ToolCallInfo } from "../types.ts";
import { getConfig, resetConfig } from "./config.ts";
import {
	calculateUsagePercentage,
	compactConversation,
	DEFAULT_THRESHOLD,
	estimateMessagesTokens,
	getModelLimits,
	isOverThreshold,
} from "./context/index.ts";
import { calculateCost } from "./cost.ts";
import { executeTool, type ToolName } from "./executeTools.ts";
import {
	getModel,
	type ProviderType,
	resetProviderConfig,
	resolveModelName,
	resolveSummarizeModelName,
	setProviderConfig,
	suggestModelForProviderSwap,
} from "./providers/index.ts";
import { filterCompatibleMessages } from "./system/filterMessages.ts";
import {
	DEFAULT_PERSONA_ID,
	getPersona,
	listPersonas,
} from "./system/persona.ts";
import {
	buildSystemPrompt,
	gatherWorkspaceContext,
} from "./system/workspace.ts";
import { tools } from "./tools/index.ts";

// ---------------------------------------------------------------------------
// Module-level initialisation (runs once on first import)
// ---------------------------------------------------------------------------

config({
	path: resolve(dirname(fileURLToPath(import.meta.url)), "../../.env"),
});
resetConfig();
resetProviderConfig();

// ---------------------------------------------------------------------------
// Agent class — encapsulates all runtime state previously held in module
// globals.  Each instance is an independent "conversation session".
// ---------------------------------------------------------------------------

export class Agent {
	// ── Runtime overrides ──
	private modelOverride: string | null = null;
	private summarizeOverride: string | null = null;
	private providerOverride: ProviderType | null = null;
	private personaId: string = DEFAULT_PERSONA_ID;

	// ── System prompt cache ──
	private systemPromptPromise: Promise<string> | null = null;
	private cachedPersonaId: string | null = null;

	constructor() {
		const lmnrApiKey = process.env.LMNR_PROJECT_API_KEY;
		if (lmnrApiKey) {
			Laminar.initialize({ projectApiKey: lmnrApiKey });
		}
	}

	// ── Public getters ──

	get currentModelName(): string {
		return this.modelOverride || getConfig().defaultModel;
	}

	get currentProvider(): ProviderType {
		return this.providerOverride ?? getConfig().defaultProvider;
	}

	get currentPersonaId(): string {
		return this.personaId;
	}

	// ── Mutation helpers (used by TUI slash-commands) ──

	setPersona(id: string): void {
		this.personaId = id;
		this.systemPromptPromise = null;
		this.cachedPersonaId = null;
	}

	setModel(model: string): void {
		this.modelOverride = model;
	}

	setSummarizeModel(model: string): void {
		this.summarizeOverride = model;
	}

	/**
	 * Switch provider at runtime.
	 * Also auto-switches the model to a sensible default for the new
	 * provider if the current model isn't known for that provider.
	 */
	setProvider(provider: ProviderType): string {
		this.providerOverride = provider;

		const currentModel = this.modelOverride ?? getConfig().defaultModel;
		const suggestion = suggestModelForProviderSwap(currentModel, provider);

		if (!suggestion.isKnown) {
			this.modelOverride = suggestion.model;
		}

		return suggestion.suggestion;
	}

	listPersonas() {
		return listPersonas();
	}

	// ── Private helpers ──

	/** Build (or return cached) system prompt for the active persona. */
	private async getSystemPrompt(): Promise<string> {
		const persona = getPersona(this.personaId);
		if (this.systemPromptPromise && this.cachedPersonaId === this.personaId) {
			return this.systemPromptPromise;
		}
		this.cachedPersonaId = this.personaId;
		this.systemPromptPromise = gatherWorkspaceContext().then((ctx) =>
			buildSystemPrompt(persona.systemPrompt, ctx),
		);
		return this.systemPromptPromise;
	}
	async run(
		userMessage: string,
		conversationHistory: ModelMessage[],
		callbacks: AgentCallbacks,
		signal?: AbortSignal,
	): Promise<ModelMessage[]> {
		// Apply runtime provider override so getModel() routes to the right backend
		if (this.providerOverride) {
			setProviderConfig({ provider: this.providerOverride });
		}

		const effectiveModel = this.modelOverride || resolveModelName();
		const modelLimits = getModelLimits(effectiveModel);
		const dynamicSystemPrompt = await this.getSystemPrompt();

		const workingHistory = filterCompatibleMessages(conversationHistory);

		let messages: ModelMessage[] = [
			...workingHistory,
			{ role: "user", content: userMessage },
		];

		const preCheckTokens = estimateMessagesTokens(messages);
		if (isOverThreshold(preCheckTokens.total, modelLimits.contextWindow)) {
			messages = await compactConversation(
				workingHistory,
				resolveSummarizeModelName(this.summarizeOverride ?? undefined),
			);
			messages.push({ role: "user", content: userMessage });
		}

		let fullResponse = "";


		const agent = this; // capture for closures

		while (true) {
			if (signal?.aborted) {
				fullResponse = "⏹️ Interrupted.";
				callbacks?.onToken?.(fullResponse);
				break;
			}
			// ── Stream response from the model, with retry for transient errors ──
			const toolsWithoutExecute: ToolSet = Object.fromEntries(
				Object.entries(tools).map(([name, t]) => {
					const { execute, ...rest } = t;
					return [name, rest as ToolSet[string]];
				}),
			);

			const toolCalls: ToolCallInfo[] = [];
			let currentText = "";
			let streamError: Error | null = null;
			let result: Awaited<ReturnType<typeof streamText>>;

			for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
				try {
					result = streamText({
						model: getModel(resolveModelName(agent.modelOverride ?? undefined)),
						system: dynamicSystemPrompt,
						messages,
						tools: toolsWithoutExecute,
						maxOutputTokens: modelLimits.outputLimit,
						abortSignal: signal,
						experimental_telemetry: {
							isEnabled: true,
							tracer: getTracer(),
						},
					});

					for await (const chunk of result.fullStream) {
						if (chunk.type === "text-delta") {
							currentText += chunk.text;
							callbacks?.onToken?.(chunk.text);
						}
						if (chunk.type === "reasoning-delta") {
							// Accumulate reasoning text so it appears in the final response
							currentText += chunk.text;
							callbacks?.onToken?.(chunk.text);
						}
						if (chunk.type === "tool-call") {
							const input = "input" in chunk ? chunk.input : {};
							toolCalls.push({
								toolCallId: chunk.toolCallId,
								toolName: chunk.toolName,
								args: input as Record<string, unknown>,
							});
							callbacks?.onToolCallStart?.(chunk.toolName, input);
						}
						if (chunk.type === "error") {
							const errText =
								"errorText" in chunk
									? String(chunk.errorText)
									: String(chunk.error ?? "Unknown model error");
							streamError = new Error(errText);
						}
					}
					break; // Success — exit retry loop
				} catch (e) {
					const err = e as Error;
					if (isTransientError(err) && attempt < MAX_RETRIES && !signal?.aborted) {
						const delay = backoffDelay(attempt);
						callbacks?.onToken?.(`\n⏳ Transient error — retrying in ${Math.round(delay / 1000)}s…\n`);
						await sleep(delay);
						// Reset state for retry
						currentText = "";
						toolCalls.length = 0;
						streamError = null;
						continue;
					}
					// Non-transient or exhausted retries — propagate
					// Auto-fallback: if DeepSeek fails, switch to local model
					const currentProv = getCurrentProvider();
					if (currentProv === "deepseek" && attempt === 0 && !signal?.aborted) {
						const cfg = getConfig();
						callbacks?.onToken?.(`\n⚠️ DeepSeek unavailable — switching to local model (${cfg.localModel})…\n`);
						setProviderConfig({ provider: "lmstudio" });
						agent.modelOverride = cfg.localModel;
						// Reset state and retry
						currentText = "";
						toolCalls.length = 0;
						streamError = null;
						continue;
					}
					streamError = err;
					const msg = streamError.message ?? "";
					if (!currentText && !msg.includes("No output generated") && streamError.name !== "AI_NoOutputGeneratedError") {
						throw streamError;
					}
					break;
			}
			}

			// ── Post-retry: report token usage (defined here so it captures `messages`) ──
			const reportTokenUsage = (actualInput?: number, actualOutput?: number) => {
				if (!callbacks.onTokenUsage) return;
				const usage = estimateMessagesTokens(messages);
				const inputTokens = actualInput ?? usage.input;
				const outputTokens = actualOutput ?? usage.output;
				const totalTokens = inputTokens + outputTokens;

				const effModel = agent.modelOverride || resolveModelName();
				const cost = calculateCost(effModel, inputTokens, outputTokens);

				callbacks.onTokenUsage({
					inputTokens,
					outputTokens,
					totalTokens,
					threshold: DEFAULT_THRESHOLD,
					contextWindow: modelLimits.contextWindow,
					percentage: calculateUsagePercentage(totalTokens, modelLimits.contextWindow),
					requestCost: cost.totalCost,
				});

				if (callbacks.onCostUpdate) {
					callbacks.onCostUpdate({ addedCost: cost.totalCost, sessionCost: 0 });
				}
			};

			fullResponse += currentText;

			// No output at all
			if (!currentText && toolCalls.length === 0) {
				if (!streamError) {
					try {
						const reason = await result!.finishReason;
						fullResponse = `Model finished with reason "${reason}" but produced no output. The input may be too long or the model may not support this request type.`;
					} catch (resultErr) {
						streamError = resultErr as Error;
					}
				}
				if (streamError) {
					fullResponse = `${streamError.message}\n\nTry a shorter message or break it into smaller parts.`;
				} else {
					fullResponse = "The model returned nothing for this input. The pasted content may be too long or exceed the context window. Try a shorter message or break it into smaller parts.";
				}
				callbacks?.onToken?.(fullResponse);
				break;
			}

			// Handle stream error with partial results
			if (streamError) {
				const content: Array<{ type: string; text?: string; toolCallId?: string; toolName?: string; input?: unknown }> = [];
				if (currentText) content.push({ type: "text", text: currentText });
				for (const tc of toolCalls) {
					content.push({ type: "tool-call", toolCallId: tc.toolCallId, toolName: tc.toolName, input: tc.args });
				}
				messages.push({ role: "assistant", content } as ModelMessage);
				if (toolCalls.length === 0) break;
			} else {
				const finishReason = await result!.finishReason;
				if (finishReason !== "tool-calls" || toolCalls.length === 0) {
					const responseMessage = await result!.response;
					messages.push(...responseMessage.messages);
					const usage = await result!.totalUsage;
					reportTokenUsage(usage?.inputTokens, usage?.outputTokens);
					break;
				}

				const responseMessages = await result!.response;
				messages.push(...responseMessages.messages);
				const usage = await result!.totalUsage;
				reportTokenUsage(usage?.inputTokens, usage?.outputTokens);
			}

			// Execute tool calls
			const toolResults: string[] = [];
			for (const tc of toolCalls) {
				const approved = callbacks.onToolApproval
					? await callbacks.onToolApproval(tc.toolName, tc.args)
					: true;
				if (!approved) continue;

				const toolResult = await executeTool(tc.toolName as ToolName, tc.args);
				callbacks?.onToolCallEnd?.(tc.toolName, toolResult);
				toolResults.push(toolResult);

				messages.push({
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: tc.toolCallId,
							toolName: tc.toolName,
							output: { type: "text", value: toolResult },
						},
					],
				} as ModelMessage);
				reportTokenUsage();
			}

			if (streamError && toolResults.length > 0 && !currentText) {
				fullResponse = `[Tool execution completed. ${toolResults.length} result(s) available. The agent will respond in the next message.]`;
				callbacks?.onToken?.(fullResponse);
			}
		}
		callbacks?.onComplete?.(fullResponse);
		return messages;
	}
}

// ── Retry/backoff for transient API failures ──

/** Maximum number of retry attempts for transient API errors */
const MAX_RETRIES = 3;
/** Base delay in ms for exponential backoff */
const BASE_BACKOFF_MS = 1_000;

/** Check if an error is transient (rate-limited, 5xx, network issue) */
function isTransientError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	return (
		msg.includes("429") ||
		msg.includes("503") ||
		msg.includes("502") ||
		msg.includes("504") ||
		msg.includes("rate limit") ||
		msg.includes("RateLimit") ||
		msg.includes("too many requests") ||
		msg.includes("internal server error") ||
		msg.includes("Service Unavailable") ||
		msg.includes("ECONNRESET") ||
		msg.includes("ETIMEDOUT") ||
		msg.includes("fetch failed") ||
		msg.includes("network")
	);
}

/** Sleep for `ms` milliseconds */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Compute backoff delay with jitter for a given attempt (0-indexed) */
function backoffDelay(attempt: number): number {
	const exponential = BASE_BACKOFF_MS * 2 ** attempt;
	const jitter = Math.random() * exponential * 0.3;
	return Math.floor(exponential + jitter);
}

// ---------------------------------------------------------------------------
// Default singleton + backward-compatible function exports
// ---------------------------------------------------------------------------

const defaultAgent = new Agent();

export const getCurrentModelName = (): string => defaultAgent.currentModelName;
export const getCurrentProvider = (): ProviderType => defaultAgent.currentProvider;
export const getCurrentPersonaId = (): string => defaultAgent.currentPersonaId;
export const listAvailablePersonas = () => defaultAgent.listPersonas();

export const setRuntimePersona = (id: string): void => defaultAgent.setPersona(id);
export const setRuntimeModel = (model: string): void => defaultAgent.setModel(model);
export const setRuntimeSummarizeModel = (model: string): void => defaultAgent.setSummarizeModel(model);
export const setRuntimeProvider = (provider: ProviderType): string => defaultAgent.setProvider(provider);

export const runAgent = (
	userMessage: string,
	conversationHistory: ModelMessage[],
	callbacks: AgentCallbacks,
	signal?: AbortSignal,
): Promise<ModelMessage[]> => defaultAgent.run(userMessage, conversationHistory, callbacks, signal);
