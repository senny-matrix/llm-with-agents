import { useCallback } from "react";
import type { ModelMessage } from "ai";
import {
	findModel,
	findProvidersForModel,
	formatModelList,
	getModelsForProvider,
	getProviderInfo,
	type ProviderType,
} from "../../agent/providers/index.ts";
import {
	getCurrentModelName,
	getCurrentPersonaId,
	listAvailablePersonas,
	setRuntimeModel,
	setRuntimePersona,
	setRuntimeProvider,
	setRuntimeSummarizeModel,
} from "../../agent/run.ts";
import {
	exportJSON,
	exportMarkdown,
} from "../../agent/session/export.ts";
import {
	generateSessionId,
	listSessions,
	loadSession,
} from "../../agent/session/store.ts";
import type { Message } from "../components/MessageList.tsx";
import type { ToolCallProps } from "../components/ToolCall.tsx";
import { extractAssistantText } from "../utils/messageUtils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommandResult {
	/** true if the input was consumed as a slash command */
	handled: boolean;
	/** when set, the command transformed the input — send *this* to the agent */
	forwardInput?: string;
}

export type ApprovalMode = "safe" | "auto";

export interface CommandDeps {
	exit: () => void;
	mode: ApprovalMode;
	markdownMode: boolean;
	currentModel: string;
	currentProvider: ProviderType;
	currentPersona: string;
	conversationHistory: ModelMessage[];
	setMode: (m: ApprovalMode) => void;
	setMarkdownMode: (b: boolean) => void;
	setCurrentModel: (m: string) => void;
	setCurrentProvider: (p: ProviderType) => void;
	setCurrentPersona: (p: string) => void;
	setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
	setConversationHistory: React.Dispatch<React.SetStateAction<ModelMessage[]>>;
	setTokenUsage: React.Dispatch<
		React.SetStateAction<import("../../types.ts").TokenUsageInfo | null>
	>;
	setSessionCost: React.Dispatch<React.SetStateAction<number>>;
	setStreamingText: React.Dispatch<React.SetStateAction<string>>;
	setActiveToolCalls: React.Dispatch<
		React.SetStateAction<Array<{ id: string } & ToolCallProps>>
	>;
	sessionIdRef: React.MutableRefObject<string>;
}

// ---------------------------------------------------------------------------
// The "init" prompt — too large to inline in the component
// ---------------------------------------------------------------------------

export const INIT_PROMPT = `Please analyze this project thoroughly and create (or update) the CLAUDE.md file at the project root with a comprehensive project reference. Use writeFile to create/update it.

Follow these steps in order:

1. Read existing project docs: CLAUDE.md, AGENTS.md, course.yaml
2. Read config files: package.json, tsconfig.json, tsconfig.build.json, biome.json
3. Use listFiles on src/ to understand the directory structure
4. Read key source files to understand the architecture:
   - src/cli.ts (entry point)
   - src/ui/App.tsx (TUI main component)
   - src/agent/run.ts (core agent loop)
   - src/agent/config.ts (configuration)
   - src/agent/tools/index.ts (tool registry)
   - src/types.ts (type definitions)
5. Optionally read a few tool implementations (src/agent/tools/file.ts, src/agent/tools/shell.ts, src/agent/tools/webSearch.ts) and the system prompt (src/agent/system/prompt.ts, src/agent/system/workspace.ts)

Then write CLAUDE.md covering:

## Project Overview
- Name, purpose, what it does ("agi" — an AI coding agent CLI)
- Who it's for

## Tech Stack
- Runtime: Node.js + TypeScript
- TUI Framework: Ink (React for terminal)
- AI: Vercel AI SDK (@ai-sdk/openai, @ai-sdk/deepseek, @ai-sdk/openai-compatible)
- Observability: Laminar (@lmnr-ai/lmnr)
- Formatting: Biome
- All key dependencies with versions from package.json

## Architecture
- High-level: CLI entry → TUI (Ink/React) → Agent loop → Tools
- How streaming works (streamText → fullStream → text-delta / tool-call chunks)
- Tool system: registry (tools/index.ts) → execution (executeTools.ts) → individual tool files
- Configuration: .agirc.json + env vars → config.ts → runtime overrides
- Session management: auto-save to ~/.agi/sessions/, export as md/json
- MCP support for external tool servers

## Project Structure
- src/cli.ts — CLI entry point, help text, MCP init
- src/index.ts — simple render entry
- src/types.ts — shared TypeScript interfaces
- src/ui/ — Ink/React TUI (App.tsx, components/)
- src/agent/ — core agent logic
  - run.ts — main agent loop with streaming, tool calling, retry, context compaction
  - config.ts — .agirc.json parsing and config management
  - tools/ — tool implementations (file, shell, webSearch, executeCode, image, dateTime, delegate)
  - system/ — system prompt and workspace context gathering
  - context/ — token estimation, model limits, conversation compaction
  - providers/ — LLM provider abstraction (DeepSeek, LM Studio)
  - mcp/ — Model Context Protocol client
  - session/ — session persistence and export
  - cost.ts — cost calculation
  - executeTools.ts — tool dispatch
  - subAgent.ts — sub-agent spawning via delegate tool
- tests/ — test files
- evals/ — Laminar evaluation files
- dist/ — build output

## Build, Run, Test
- npm run dev — development mode with hot reload
- npm start — run directly with tsx
- npm run build — TypeScript compilation to dist/
- npm run eval — run Laminar evaluations
- Binary: "agi" (maps to dist/cli.js)

## Code Conventions
- Biome for formatting (tabs, double quotes) and linting
- TypeScript strict mode
- verbatimModuleSyntax: type imports must use "import type"
- File extensions required in imports (.ts, .tsx)
- React functional components with hooks for TUI
- Tool pattern: { description, inputSchema (zod), execute }
- Async/await throughout

## Configuration
- Config file: ~/.agirc.json (defaultModel, defaultProvider, mode, markdown, lmstudioUrl, mcpServers)
- Env vars override file values: AGENT_MODEL, PROVIDER, AGI_MODE, AGI_MARKDOWN, LMSTUDIO_URL, DEEPSEEK_API_KEY, OPENAI_API_KEY, etc.
- Runtime overrides via /model and /provider commands

## Key Patterns & Conventions
- Agent loop: streamText → handle text/tool-call chunks → execute tools → send results back → loop
- Context management: token estimation, threshold-based compaction, summarize model
- Tool approval: safe (ask) vs auto (approve all) modes
- Retry logic: auto-truncate long inputs that fail with context errors
- Streaming UI: complete paragraphs rendered as markdown, in-progress as raw text with cursor
- Keep any existing content in CLAUDE.md that appears intentional (like OpenSpec instructions)

Make the file thorough and well-organized. This will be read by future AI assistants to quickly understand the codebase.`;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCommands(deps: CommandDeps) {
	const {
		exit,
		mode,
		markdownMode,
		currentModel,
		currentProvider,
		currentPersona,
		conversationHistory,
		setMode,
		setMarkdownMode,
		setCurrentModel,
		setCurrentProvider,
		setCurrentPersona,
		setMessages,
		setConversationHistory,
		setTokenUsage,
		setSessionCost,
		setStreamingText,
		setActiveToolCalls,
		sessionIdRef,
	} = deps;

	return useCallback(
		(userInput: string): CommandResult => {
			const input = userInput.trim().toLowerCase();
			const cmd = input.startsWith("/") ? input.slice(1) : input;

			// ── exit ──
			if (cmd === "exit" || cmd === "quit") {
				exit();
				return { handled: true };
			}

			// ── mode toggles ──
			if (cmd === "auto") {
				setMode("auto");
				setMessages((prev) => [
					...prev,
					{
						role: "assistant",
						content:
							"🟢 Auto-approve mode enabled. All tool calls will run without confirmation.",
					},
				]);
				return { handled: true };
			}
			if (cmd === "safe") {
				setMode("safe");
				setMessages((prev) => [
					...prev,
					{
						role: "assistant",
						content:
							"🛡️ Safe mode enabled. Tool calls will require your approval.",
					},
				]);
				return { handled: true };
			}

			// ── clear / new session ──
			if (cmd === "clear" || cmd === "new") {
				setConversationHistory([]);
				setMessages([]);
				setTokenUsage(null);
				setSessionCost(0);
				setStreamingText("");
				setActiveToolCalls([]);
				sessionIdRef.current = generateSessionId();
				setMessages((prev) => [
					...prev,
					{ role: "assistant", content: "🔄 Fresh session started." },
				]);
				return { handled: true };
			}

			// ── markdown toggles ──
			if (cmd === "md") {
				setMarkdownMode(true);
				setMessages((prev) => [
					...prev,
					{
						role: "assistant",
						content: "📝 Rendered mode — markdown will be styled.",
					},
				]);
				return { handled: true };
			}
			if (cmd === "raw") {
				setMarkdownMode(false);
				setMessages((prev) => [
					...prev,
					{
						role: "assistant",
						content: "📄 Raw mode — showing markdown as plain text.",
					},
				]);
				return { handled: true };
			}

			// ── model ──
			if (cmd === "model") {
				const found = findModel(currentModel);
				const providers = findProvidersForModel(currentModel);
				const providerHints =
					providers.length > 0
						? `\nProvider${providers.length > 1 ? "s" : ""} that support this model: ${providers.map((p) => getProviderInfo(p).label).join(", ")}`
						: "";
				const registryInfo = found
					? `\nRegistry: ${found.model.label} [${getProviderInfo(found.provider).label}]`
					: "\n⚠️ This model is not in the known registry.";
				setMessages((prev) => [
					...prev,
					{
						role: "assistant",
						content: `📋 Current model: **${currentModel}** on **${getProviderInfo(currentProvider).label}** ${getProviderInfo(currentProvider).emoji}.${registryInfo}${providerHints}\n\nTo switch: \`/model <name>\` (e.g., \`/model deepseek-chat\`)\nKnown models for ${getProviderInfo(currentProvider).label}:\n${formatModelList(getModelsForProvider(currentProvider))}`,
					},
				]);
				return { handled: true };
			}

			if (cmd.startsWith("model ")) {
				const offset = userInput.trim().startsWith("/") ? 7 : 6;
				const newModel = userInput.trim().slice(offset).trim();
				if (!newModel) {
					setMessages((prev) => [
						...prev,
						{
							role: "assistant",
							content:
								"⚠️ Usage: `/model <model-name>` (e.g., `/model deepseek-chat`)",
						},
					]);
					return { handled: true };
				}
				const found = findModel(newModel);

				setRuntimeModel(newModel);
				setRuntimeSummarizeModel(newModel);
				setCurrentModel(newModel);

				let feedback = `🔁 Switched to model: **${newModel}** (provider: ${getProviderInfo(currentProvider).label} ${getProviderInfo(currentProvider).emoji})`;

				if (found) {
					feedback += `\n📦 Registry: ${found.model.label} [${getProviderInfo(found.provider).label}]`;
				} else {
					feedback += `\n⚠️ This model is not in the known registry. Make sure ${currentProvider} supports it.`;
				}

				if (found && found.provider !== currentProvider) {
					feedback += `\n⚠️ **Warning**: "${newModel}" is registered for **${getProviderInfo(found.provider).label}** ${getProviderInfo(found.provider).emoji}, but your current provider is **${getProviderInfo(currentProvider).label}** ${getProviderInfo(currentProvider).emoji}.`;
					feedback += `\n💡 Consider switching: /provider ${found.provider}`;
				}

				setMessages((prev) => [
					...prev,
					{ role: "assistant", content: feedback },
				]);
				return { handled: true };
			}

			// ── provider ──
			if (cmd === "provider") {
				const info = getProviderInfo(currentProvider);
				setMessages((prev) => [
					...prev,
					{
						role: "assistant",
						content: `📋 Current provider: **${info.label}** ${info.emoji} — ${info.description}.\n\nKnown models for ${info.label}:\n${formatModelList(info.models)}\n\nTo switch: \`/provider deepseek\` or \`/provider lmstudio\`\n💡 Switching provider will auto-update your model to a compatible one.`,
					},
				]);
				return { handled: true };
			}

			if (cmd.startsWith("provider ")) {
				const offset = userInput.trim().startsWith("/") ? 10 : 9;
				const newProvider = userInput
					.trim()
					.slice(offset)
					.trim()
					.toLowerCase() as ProviderType;
				if (newProvider !== "deepseek" && newProvider !== "lmstudio") {
					setMessages((prev) => [
						...prev,
						{
							role: "assistant",
							content: "⚠️ Usage: `/provider deepseek` or `/provider lmstudio`",
						},
					]);
					return { handled: true };
				}
				const suggestion = setRuntimeProvider(newProvider);
				setCurrentProvider(newProvider);
				setCurrentModel(getCurrentModelName());

				const info = getProviderInfo(newProvider);
				const updatedModel = getCurrentModelName();
				setMessages((prev) => [
					...prev,
					{
						role: "assistant",
						content: `🔁 Switched provider to: **${info.label}** ${info.emoji} — ${info.description}.\n\n${suggestion}\n\nAvailable models for ${info.label}:\n${formatModelList(info.models)}\n\nCurrent: **${updatedModel}**\n\nTo switch model: \`/model <name>\` (e.g., \`/model ${info.models[0]?.id}\`)`,
					},
				]);
				return { handled: true };
			}

			// ── persona ──
			if (cmd === "persona") {
				const currentId = getCurrentPersonaId();
				const personas = listAvailablePersonas();
				const lines = [
					`🧑 **Persona: ${currentId}**`,
					"",
					"Available personas:",
					...personas.map((p) => {
						const active = p.id === currentId ? " ★" : "";
						return `  \`/${p.id}\` — ${p.name} — ${p.description}${active}`;
					}),
					"",
					"Switch with `/persona <id>` (e.g., `/persona senior-engineer`).",
				];
				setMessages((prev) => [
					...prev,
					{ role: "assistant", content: lines.join("\n") },
				]);
				return { handled: true };
			}

			if (cmd.startsWith("persona ")) {
				const offset = userInput.trim().startsWith("/") ? 9 : 8;
				const newPersona = userInput.trim().slice(offset).trim().toLowerCase();
				if (!newPersona) {
					setMessages((prev) => [
						...prev,
						{
							role: "assistant",
							content:
								"⚠️ Usage: `/persona <id>` (e.g., `/persona senior-engineer`). Use `/persona` to list available personas.",
						},
					]);
					return { handled: true };
				}
				const available = listAvailablePersonas();
				const found = available.find((p) => p.id === newPersona);
				if (!found) {
					setMessages((prev) => [
						...prev,
						{
							role: "assistant",
							content: `❌ Unknown persona: \`${newPersona}\`. Use \`/persona\` to list available personas.`,
						},
					]);
					return { handled: true };
				}
				setRuntimePersona(newPersona);
				setCurrentPersona(newPersona);
				setMessages((prev) => [
					...prev,
					{
						role: "assistant",
						content: `🧑 Switched to persona: **${found.name}** — ${found.description}`,
					},
				]);
				return { handled: true };
			}

			// ── init ──
			if (cmd === "init") {
				setMessages((prev) => [
					...prev,
					{
						role: "assistant",
						content:
							"🔍 **Analyzing project to generate CLAUDE.md…**\n\n" +
							"I'll read key config files, explore the source code, and create a comprehensive reference " +
							"file that future AI assistants can use to quickly understand this codebase.",
					},
				]);
				return { handled: true, forwardInput: INIT_PROMPT };
			}

			// ── export ──
			if (cmd === "export" || cmd.startsWith("export ")) {
				const format = cmd === "export" ? "md" : cmd.slice(7).trim();
				if (format !== "md" && format !== "json") {
					setMessages((prev) => [
						...prev,
						{
							role: "assistant",
							content:
								"⚠️ Usage: `/export md` for Markdown or `/export json` for JSON.",
						},
					]);
					return { handled: true };
				}

				if (conversationHistory.length === 0) {
					setMessages((prev) => [
						...prev,
						{
							role: "assistant",
							content: "📭 Nothing to export — the conversation is empty.",
						},
					]);
					return { handled: true };
				}

				const sessionId = sessionIdRef.current;
				const outPath =
					format === "md"
						? exportMarkdown(conversationHistory, sessionId)
						: exportJSON(conversationHistory, sessionId);

				const ext = format === "md" ? "Markdown" : "JSON";
				setMessages((prev) => [
					...prev,
					{
						role: "assistant",
						content: `📄 Exported as ${ext}: \`${outPath}\``,
					},
				]);
				return { handled: true };
			}

			// ── sessions ──
			if (cmd === "sessions" || cmd === "history") {
				const sessions = listSessions();
				if (sessions.length === 0) {
					setMessages((prev) => [
						...prev,
						{
							role: "assistant",
							content:
								"📭 No saved sessions found. Start a conversation to create one.",
						},
					]);
					return { handled: true };
				}
				const currentId = sessionIdRef.current;
				const lines = [
					`📂 **Saved sessions** (${sessions.length} total, newest first):`,
					"",
					...sessions.map((s, i) => {
						const isCurrent = s.id === currentId;
						const prefix = isCurrent ? "★" : " ";
						const date = s.updatedAt.slice(0, 16).replace("T", " ");
						const msgs = `${s.messageCount} msg${s.messageCount !== 1 ? "s" : ""}`;
						const idShort = s.id.slice(-14);
						return `${prefix} **${i + 1}.** \`${idShort}\` — ${date} — ${msgs}`;
					}),
					"",
					"Use `/load <id>` to switch to a session (e.g., `/load " +
						sessions[0].id.slice(-14) +
						"`).",
					"★ = current session",
				];
				setMessages((prev) => [
					...prev,
					{ role: "assistant", content: lines.join("\n") },
				]);
				return { handled: true };
			}

			// ── load ──
			if (cmd.startsWith("load ")) {
				const offset = userInput.trim().startsWith("/") ? 6 : 5;
				const loadId = userInput.trim().slice(offset).trim();
				if (!loadId) {
					setMessages((prev) => [
						...prev,
						{
							role: "assistant",
							content:
								"⚠️ Usage: `/load <session-id>` (use `/sessions` to list saved sessions)",
						},
					]);
					return { handled: true };
				}

				let session = loadSession(loadId);
				if (!session) {
					const sessions = listSessions();
					const match = sessions.find((s) => s.id.endsWith(loadId));
					if (match) {
						session = loadSession(match.id);
					}
				}

				if (!session) {
					setMessages((prev) => [
						...prev,
						{
							role: "assistant",
							content: `❌ Session not found: \`${loadId}\`. Use \`/sessions\` to list available sessions.`,
						},
					]);
					return { handled: true };
				}

				sessionIdRef.current = session.meta.id;
				setConversationHistory(session.messages);
				setTokenUsage(null);
				setSessionCost(0);

				const displayMsgs: Message[] = [];
				for (const msg of session.messages) {
					if (msg.role === "user" && typeof msg.content === "string") {
						displayMsgs.push({ role: "user", content: msg.content });
					} else if (msg.role === "assistant") {
						const text = extractAssistantText(msg);
						if (text) displayMsgs.push({ role: "assistant", content: text });
					}
				}

				const date = session.meta.updatedAt.slice(0, 16).replace("T", " ");
				displayMsgs.push({
					role: "assistant",
					content: `📂 Loaded session **${session.meta.name || session.meta.id.slice(-14)}** (${date}, ${session.meta.messageCount} messages)`,
				});
				setMessages(displayMsgs);
				return { handled: true };
			}

			// ── not a command — forward to agent ──
			return { handled: false };
		},
		[
			exit,
			mode,
			markdownMode,
			currentModel,
			currentProvider,
			currentPersona,
			conversationHistory,
			setMode,
			setMarkdownMode,
			setCurrentModel,
			setCurrentProvider,
			setCurrentPersona,
			setMessages,
			setConversationHistory,
			setTokenUsage,
			setSessionCost,
			setStreamingText,
			setActiveToolCalls,
			sessionIdRef,
		],
	);
}
