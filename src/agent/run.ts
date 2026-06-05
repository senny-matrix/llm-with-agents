import { getTracer, Laminar } from "@lmnr-ai/lmnr";
import { type ModelMessage, streamText } from "ai";
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

config({
	path: resolve(dirname(fileURLToPath(import.meta.url)), "../../.env"),
});
// Reset cached configs so they re-read env vars that were just loaded above
resetConfig();
resetProviderConfig();

/** Runtime model override (set via /model command in TUI) */
let _runtimeModelOverride: string | null = null;
let _runtimeSummarizeOverride: string | null = null;

/** Runtime provider override (set via /provider command in TUI).
 *  When set, model auto-switches to a sensible default for the new provider. */
let _runtimeProviderOverride: ProviderType | null = null;
/** Runtime persona override (set via /persona command in TUI) */
let _activePersonaId: string = DEFAULT_PERSONA_ID;

export function setRuntimePersona(id: string): void {
	_activePersonaId = id;
}

export function getCurrentPersonaId(): string {
	return _activePersonaId;
}

export function listAvailablePersonas() {
	return listPersonas();
}

export function setRuntimeModel(model: string): void {
	_runtimeModelOverride = model;
}

export function setRuntimeSummarizeModel(model: string): void {
	_runtimeSummarizeOverride = model;
}

/**
 * Switch provider at runtime.
 * Also auto-switches the model to a sensible default for the new provider
 * if the current model isn't known for the new provider.
 * Returns a message describing what happened.
 */
export function setRuntimeProvider(provider: ProviderType): string {
	const previousProvider =
		_runtimeProviderOverride ?? getConfig().defaultProvider;
	_runtimeProviderOverride = provider;

	// Check if current model works with the new provider
	const currentModel = _runtimeModelOverride ?? getConfig().defaultModel;
	const suggestion = suggestModelForProviderSwap(currentModel, provider);

	if (!suggestion.isKnown) {
		_runtimeModelOverride = suggestion.model;
	}

	return suggestion.suggestion;
}

export function getCurrentModelName(): string {
	return _runtimeModelOverride || getConfig().defaultModel;
}

export function getCurrentProvider(): ProviderType {
	return _runtimeProviderOverride ?? getConfig().defaultProvider;
}

const lmnrApiKey = process.env.LMNR_PROJECT_API_KEY;
if (lmnrApiKey) {
	Laminar.initialize({ projectApiKey: lmnrApiKey });
}

// Build the dynamic system prompt once per process (rebuilt on persona switch)
let _systemPromptCache: string | null = null;
let _cachedPersonaId: string | null = null;
function getSystemPrompt(): string {
	const persona = getPersona(_activePersonaId);
	if (_systemPromptCache && _cachedPersonaId === _activePersonaId) {
		return _systemPromptCache;
	}
	const ctx = gatherWorkspaceContext();
	_systemPromptCache = buildSystemPrompt(persona.systemPrompt, ctx);
	_cachedPersonaId = _activePersonaId;
	return _systemPromptCache;
}

export const runAgent = async (
	userMessage: string,
	conversationHistory: ModelMessage[],
	callbacks: AgentCallbacks,
	signal?: AbortSignal,
): Promise<ModelMessage[]> => {
	// Apply runtime provider override so getModel() routes to the right backend
	const runtimeProvider = _runtimeProviderOverride;
	if (runtimeProvider) {
		setProviderConfig({ provider: runtimeProvider });
	}

	const effectiveModel = _runtimeModelOverride || resolveModelName();
	const modelLimits = getModelLimits(effectiveModel);
	const dynamicSystemPrompt = getSystemPrompt();

	const workingHistory = filterCompatibleMessages(conversationHistory);

	let messages: ModelMessage[] = [
		...workingHistory,
		{ role: "user", content: userMessage },
	];

	const preCheckTokens = estimateMessagesTokens(messages);
	if (isOverThreshold(preCheckTokens.total, modelLimits.contextWindow)) {
		messages = await compactConversation(
			workingHistory,
			resolveSummarizeModelName(_runtimeSummarizeOverride ?? undefined),
		);
		// Re-add the user message after compaction
		messages.push({ role: "user", content: userMessage });
	}

	let fullResponse = "";

	const toolsWithoutExecute = Object.fromEntries(
		Object.entries(tools).map(([name, t]) => {
			const { execute, ...rest } = t;
			return [name, rest];
		}),
	);

	while (true) {
		if (signal?.aborted) {
			fullResponse = "⏹️ Interrupted.";
			callbacks?.onToken?.(fullResponse);
			break;
		}

		const result = streamText({
			model: getModel(resolveModelName(_runtimeModelOverride ?? undefined)),
			system: dynamicSystemPrompt,
			messages,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			tools: toolsWithoutExecute as any,
			maxOutputTokens: modelLimits.outputLimit,
			abortSignal: signal,
			experimental_telemetry: {
				isEnabled: true,
				tracer: getTracer(),
			},
		});

		const reportTokenUsage = (actualInput?: number, actualOutput?: number) => {
			if (callbacks.onTokenUsage) {
				const usage = estimateMessagesTokens(messages);
				// Prefer actual counts from API response when available
				const inputTokens = actualInput ?? usage.input;
				const outputTokens = actualOutput ?? usage.output;
				const totalTokens = inputTokens + outputTokens;

				const effectiveModel = _runtimeModelOverride || resolveModelName();
				const cost = calculateCost(effectiveModel, inputTokens, outputTokens);

				callbacks.onTokenUsage({
					inputTokens,
					outputTokens,
					totalTokens,
					threshold: DEFAULT_THRESHOLD,
					contextWindow: modelLimits.contextWindow,
					percentage: calculateUsagePercentage(
						totalTokens,
						modelLimits.contextWindow,
					),
					requestCost: cost.totalCost,
				});

				if (callbacks.onCostUpdate) {
					callbacks.onCostUpdate({
						addedCost: cost.totalCost,
						sessionCost: 0, // accumulated by the TUI
					});
				}
			}
		};

		const toolCalls: ToolCallInfo[] = [];
		let currentText = "";
		let streamError: Error | null = null;

		try {
			for await (const chunk of result.fullStream) {
				if (chunk.type === "text-delta") {
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
					// Don't break — let the stream finish so we can collect any partial output
				}
			}
		} catch (e) {
			streamError = e as Error;
			const msg = streamError.message ?? "";
			if (
				!currentText &&
				!msg.includes("No output generated") &&
				streamError.name !== "AI_NoOutputGeneratedError"
			) {
				throw streamError;
			}
		}

		fullResponse += currentText;

		// No output at all — model produced nothing (empty input, context overflow, etc.)
		if (!currentText && toolCalls.length === 0) {
			// Try to get more diagnostics from the AI SDK result
			if (!streamError) {
				try {
					const reason = await result.finishReason;
					fullResponse = `Model finished with reason "${reason}" but produced no output. The input may be too long or the model may not support this request type.`;
				} catch (resultErr) {
					streamError = resultErr as Error;
				}
			}
			// Use the actual error from the model if available, otherwise the generic message
			if (streamError) {
				fullResponse = `${streamError.message}\n\nTry a shorter message or break it into smaller parts.`;
			} else {
				fullResponse =
					"The model returned nothing for this input. The pasted content may be too long or exceed the context window. Try a shorter message or break it into smaller parts.";
			}
			callbacks?.onToken?.(fullResponse);
			break;
		}

		// Handle stream error with partial results
		if (streamError) {
			const content: Array<{
				type: string;
				text?: string;
				toolCallId?: string;
				toolName?: string;
				input?: unknown;
			}> = [];
			if (currentText) content.push({ type: "text", text: currentText });

			for (const tc of toolCalls) {
				content.push({
					type: "tool-call",
					toolCallId: tc.toolCallId,
					toolName: tc.toolName,
					input: tc.args,
				});
			}
			messages.push({ role: "assistant", content } as ModelMessage);
			if (toolCalls.length === 0) break;
		} else {
			const finishReason = await result.finishReason;
			if (finishReason !== "tool-calls" || toolCalls.length === 0) {
				const responseMessage = await result.response;
				messages.push(...responseMessage.messages);
				const usage = await result.totalUsage;
				reportTokenUsage(usage?.inputTokens, usage?.outputTokens);
				break;
			}

			const responseMessages = await result.response;
			messages.push(...responseMessages.messages);
			const usage = await result.totalUsage;
			reportTokenUsage(usage?.inputTokens, usage?.outputTokens);
		}

		const toolResults: string[] = [];

		for (const tc of toolCalls) {
			const approved = callbacks.onToolApproval
				? await callbacks.onToolApproval(tc.toolName, tc.args)
				: true;
			if (!approved) {
				continue;
			}
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
						output: {
							type: "text",
							value: toolResult,
						},
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
};
