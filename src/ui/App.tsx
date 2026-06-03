import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { ModelMessage } from "ai";
import { runAgent, setRuntimeModel, setRuntimeSummarizeModel, setRuntimeProvider, getCurrentModelName, getCurrentProvider } from "../agent/run.ts";
import { type ProviderType, getProviderInfo, getModelsForProvider, formatModelList, findModel, findProvidersForModel } from "../agent/providers/index.ts";
import { getConfig } from "../agent/config.ts";
import { Logo } from "./components/Logo.tsx";
import { Markdown } from "./components/Markdown.tsx";
import { MessageList, type Message } from "./components/MessageList.tsx";
import { ToolCall, type ToolCallProps } from "./components/ToolCall.tsx";
import { Spinner } from "./components/Spinner.tsx";
import { Input } from "./components/Input.tsx";
import { ToolApproval } from "./components/ToolApproval.tsx";
import { TokenUsage } from "./components/TokenUsage.tsx";
import {
  generateSessionId,
  saveSession,
  loadSession,
  listSessions,
} from "../agent/session/store.ts";
import { exportMarkdown, exportJSON } from "../agent/session/export.ts";
import type { ToolApprovalRequest, TokenUsageInfo, CostUpdateInfo } from "../types.ts";

interface ActiveToolCall extends ToolCallProps {
  id: string;
}

type ApprovalMode = "safe" | "auto";

function extractAssistantText(msg: ModelMessage): string {
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((p): p is { type: "text"; text: string } =>
        typeof p === "object" && p !== null && "type" in p && p.type === "text" && "text" in p
      )
      .map(p => p.text)
      .join("");
  }
  return "";
}

/**
 * Renders streaming markdown progressively.
 * Complete paragraphs (separated by \n\n) are rendered as styled markdown.
 * The in-progress paragraph is shown as raw text with a blinking cursor.
 */
function StreamingOutput({ text }: { text: string }) {
  const paragraphs = text.split("\n\n");

  // All paragraphs except the last are complete and ready to render
  const complete = paragraphs.slice(0, -1);
  const pending = paragraphs[paragraphs.length - 1] || "";

  return (
    <Box flexDirection="column">
      {complete.map((p, i) => (
        <Markdown key={i}>{p}</Markdown>
      ))}
      {pending !== "" && (
        <Box>
          <Text>{pending}</Text>
          <Text color="gray">▌</Text>
        </Box>
      )}
      {complete.length > 0 && pending === "" && (
        <Box>
          <Text color="gray">▌</Text>
        </Box>
      )}
    </Box>
  );
}

export function App() {
  const { exit } = useApp();
  const cfg = getConfig();
  const [mode, setMode] = useState<ApprovalMode>(cfg.mode);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationHistory, setConversationHistory] = useState<
    ModelMessage[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [activeToolCalls, setActiveToolCalls] = useState<ActiveToolCall[]>([]);
  const [pendingApproval, setPendingApproval] =
    useState<ToolApprovalRequest | null>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsageInfo | null>(null);
  const [sessionCost, setSessionCost] = useState(0);
  const [markdownMode, setMarkdownMode] = useState(cfg.markdown);
  const [currentModel, setCurrentModel] = useState(getCurrentModelName());
  const [currentProvider, setCurrentProvider] = useState<ProviderType>(getCurrentProvider());
  const sessionIdRef = useRef<string>(generateSessionId());
  const abortRef = useRef<AbortController | null>(null);
  const [inputHistory, setInputHistory] = useState<string[]>([]);

  // Load last session on startup
  useEffect(() => {
    const sessions = listSessions();
    const latest = sessions[0];
    if (latest) {
      const session = loadSession(latest.id);
      if (session) {
        sessionIdRef.current = latest.id;
        setConversationHistory(session.messages);
        // Reconstruct display messages from session
        const displayMsgs: Message[] = [];
        for (const msg of session.messages) {
          if (msg.role === "user" && typeof msg.content === "string") {
            displayMsgs.push({ role: "user", content: msg.content });
          } else if (msg.role === "assistant") {
            const text = extractAssistantText(msg);
            if (text) displayMsgs.push({ role: "assistant", content: text });
          }
        }
        // Show a subtle session restoration notice
        const date = latest.updatedAt.slice(0, 16).replace("T", " ");
        displayMsgs.push({
          role: "assistant",
          content: `📋 **Session restored** (${date}, ${latest.messageCount} messages). Use \`/clear\` or \`/new\` to start fresh.`,
        });
        setMessages(displayMsgs);
      }
    }
  }, []);

  // Save session after conversation history changes
  useEffect(() => {
    if (conversationHistory.length > 0) {
      const modelName = process.env.AGENT_MODEL || "deepseek-v4-pro";
      saveSession({
        meta: {
          id: sessionIdRef.current,
          name: `Session ${sessionIdRef.current.slice(-8)}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          modelName,
          messageCount: conversationHistory.length,
        },
        messages: conversationHistory,
      });
    }
  }, [conversationHistory]);

  // Global keyboard shortcuts (independent of Input focus)
  useInput((_input, key) => {
    // Ctrl+D → exit
    if (key.ctrl && _input === "d") {
      exit();
      return;
    }

    // Ctrl+L → clear screen
    if (key.ctrl && _input === "l") {
      setConversationHistory([]);
      setMessages([]);
      setTokenUsage(null);
      setSessionCost(0);
      setStreamingText("");
      setActiveToolCalls([]);
      sessionIdRef.current = generateSessionId();
      return;
    }

    // Ctrl+C → interrupt running agent (first press), exit if idle
    if (key.ctrl && _input === "c") {
      if (abortRef.current && !abortRef.current.signal.aborted) {
        abortRef.current.abort();
        setMessages((prev) => [...prev, { role: "assistant", content: "⏹️ Interrupted." }]);
        return;
      }
      // Nothing running — exit
      exit();
    }
  });

  const handleSubmit = useCallback(
    async (userInput: string) => {
      const input = userInput.trim().toLowerCase();
      // Normalize: strip optional leading "/" so both "/model" and "model" work
      const cmd = input.startsWith("/") ? input.slice(1) : input;
      if (cmd === "exit" || cmd === "quit") {
        exit();
        return;
      }
      // Mode switching commands (not sent to agent)
      if (cmd === "auto") {
        setMode("auto");
        setMessages((prev) => [...prev, { role: "assistant", content: "🟢 Auto-approve mode enabled. All tool calls will run without confirmation." }]);
        return;
      }
      if (cmd === "safe") {
        setMode("safe");
        setMessages((prev) => [...prev, { role: "assistant", content: "🛡️ Safe mode enabled. Tool calls will require your approval." }]);
        return;
      }
      if (cmd === "clear" || cmd === "new") {
        setConversationHistory([]);
        setMessages([]);
        setTokenUsage(null);
        setSessionCost(0);
        setStreamingText("");
        setActiveToolCalls([]);
        sessionIdRef.current = generateSessionId();
        setMessages((prev) => [...prev, { role: "assistant", content: "🔄 Fresh session started." }]);
        return;
      }
      if (cmd === "md" || cmd === "raw") {
        const nextMode = !markdownMode;
        setMarkdownMode(nextMode);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: nextMode ? "📝 Rendered mode — markdown will be styled." : "📄 Raw mode — showing markdown as plain text." },
        ]);
        return;
      }
      // Model switching at runtime
      if (cmd === "model") {
        const found = findModel(currentModel);
        const providers = findProvidersForModel(currentModel);
        const providerHints = providers.length > 0
          ? `\nProvider${providers.length > 1 ? 's' : ''} that support this model: ${providers.map(p => getProviderInfo(p).label).join(', ')}`
          : '';
        const registryInfo = found
          ? `\nRegistry: ${found.model.label} [${getProviderInfo(found.provider).label}]`
          : '\n⚠️ This model is not in the known registry.';
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `📋 Current model: **${currentModel}** on **${getProviderInfo(currentProvider).label}** ${getProviderInfo(currentProvider).emoji}.${registryInfo}${providerHints}\n\nTo switch: \`/model <name>\` (e.g., \`/model deepseek-chat\`)\nKnown models for ${getProviderInfo(currentProvider).label}:\n${formatModelList(getModelsForProvider(currentProvider))}` },
        ]);
        return;
      }
      if (cmd.startsWith("model ")) {
        // Extract model name after "model " or "/model " (handles both)
        const offset = userInput.trim().startsWith("/") ? 7 : 6;
        const newModel = userInput.trim().slice(offset).trim();
        if (!newModel) {
          setMessages((prev) => [...prev, { role: "assistant", content: "⚠️ Usage: `/model <model-name>` (e.g., `/model deepseek-chat`)" }]);
          return;
        }
        // Check if model is known and which providers support it
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

        setMessages((prev) => [...prev, { role: "assistant", content: feedback }]);
        return;
      }
      if (cmd === "provider") {
        const info = getProviderInfo(currentProvider);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `📋 Current provider: **${info.label}** ${info.emoji} — ${info.description}.\n\nKnown models for ${info.label}:\n${formatModelList(info.models)}\n\nTo switch: \`/provider deepseek\` or \`/provider lmstudio\`\n💡 Switching provider will auto-update your model to a compatible one.` },
        ]);
        return;
      }
      if (cmd.startsWith("provider ")) {
        const offset = userInput.trim().startsWith("/") ? 10 : 9;
        const newProvider = userInput.trim().slice(offset).trim().toLowerCase() as ProviderType;
        if (newProvider !== "deepseek" && newProvider !== "lmstudio") {
          setMessages((prev) => [...prev, { role: "assistant", content: "⚠️ Usage: `/provider deepseek` or `/provider lmstudio`" }]);
          return;
        }
        // Use setRuntimeProvider which auto-switches model to a compatible one
        const suggestion = setRuntimeProvider(newProvider);
        setCurrentProvider(newProvider);
        // Update currentModel state to reflect the potentially auto-switched model
        setCurrentModel(getCurrentModelName());

        const info = getProviderInfo(newProvider);
        const updatedModel = getCurrentModelName();
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `🔁 Switched provider to: **${info.label}** ${info.emoji} — ${info.description}.\n\n${suggestion}\n\nAvailable models for ${info.label}:\n${formatModelList(info.models)}\n\nCurrent: **${updatedModel}**\n\nTo switch model: \`/model <name>\` (e.g., \`/model ${info.models[0]?.id}\`)` },
        ]);
        return;
      }

      // Init — analyze project and generate/update CLAUDE.md
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

        userInput = `Please analyze this project thoroughly and create (or update) the CLAUDE.md file at the project root with a comprehensive project reference. Use writeFile to create/update it.

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

        // Fall through to agent dispatch below with the init prompt as user input
      }

      // Conversation export
      if (cmd === "export" || cmd.startsWith("export ")) {
        const format = cmd === "export" ? "md" : cmd.slice(7).trim();
        if (format !== "md" && format !== "json") {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "⚠️ Usage: `/export md` for Markdown or `/export json` for JSON." },
          ]);
          return;
        }

        if (conversationHistory.length === 0) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "📭 Nothing to export — the conversation is empty." },
          ]);
          return;
        }

        const sessionId = sessionIdRef.current;
        const outPath =
          format === "md"
            ? exportMarkdown(conversationHistory, sessionId)
            : exportJSON(conversationHistory, sessionId);

        const ext = format === "md" ? "Markdown" : "JSON";
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `📄 Exported as ${ext}: \`${outPath}\`` },
        ]);
        return;
      }

      // Session management
      if (cmd === "sessions" || cmd === "history") {
        const sessions = listSessions();
        if (sessions.length === 0) {
          setMessages((prev) => [...prev, { role: "assistant", content: "📭 No saved sessions found. Start a conversation to create one." }]);
          return;
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
            const idShort = s.id.slice(-14); // last 14 chars of ID
            return `${prefix} **${i + 1}.** \`${idShort}\` — ${date} — ${msgs}`;
          }),
          "",
          "Use `/load <id>` to switch to a session (e.g., `/load " + sessions[0].id.slice(-14) + "`).",
          "★ = current session",
        ];
        setMessages((prev) => [...prev, { role: "assistant", content: lines.join("\n") }]);
        return;
      }

      if (cmd.startsWith("load ")) {
        const offset = userInput.trim().startsWith("/") ? 6 : 5;
        const loadId = userInput.trim().slice(offset).trim();
        if (!loadId) {
          setMessages((prev) => [...prev, { role: "assistant", content: "⚠️ Usage: `/load <session-id>` (use `/sessions` to list saved sessions)" }]);
          return;
        }

        // Try exact match first, then partial suffix match
        let session = loadSession(loadId);
        if (!session) {
          const sessions = listSessions();
          const match = sessions.find(s => s.id.endsWith(loadId));
          if (match) {
            session = loadSession(match.id);
          }
        }

        if (!session) {
          setMessages((prev) => [...prev, { role: "assistant", content: `❌ Session not found: \`${loadId}\`. Use \`/sessions\` to list available sessions.` }]);
          return;
        }

        // Load the session
        sessionIdRef.current = session.meta.id;
        setConversationHistory(session.messages);
        setTokenUsage(null);
        setSessionCost(0);

        // Reconstruct display messages from loaded session
        const displayMsgs: Message[] = [];
        for (const msg of session.messages) {
          if (msg.role === "user" && typeof msg.content === "string") {
            displayMsgs.push({ role: "user", content: msg.content });
          } else if (msg.role === "assistant") {
            const text = extractAssistantText(msg);
            if (text) displayMsgs.push({ role: "assistant", content: text });
          }
        }

        // Add a system message about the session switch
        const date = session.meta.updatedAt.slice(0, 16).replace("T", " ");
        displayMsgs.push({
          role: "assistant",
          content: `📂 Loaded session **${session.meta.name || session.meta.id.slice(-14)}** (${date}, ${session.meta.messageCount} messages)`,
        });
        setMessages(displayMsgs);
        return;
      }

      // Conversation export
      if (cmd === "export" || cmd.startsWith("export ")) {
        const format = cmd === "export" ? "md" : cmd.slice(7).trim();
        if (format !== "md" && format !== "json") {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "⚠️ Usage: `/export md` for Markdown or `/export json` for JSON." },
          ]);
          return;
        }

        if (conversationHistory.length === 0) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "📭 Nothing to export — the conversation is empty." },
          ]);
          return;
        }

        const sessionId = sessionIdRef.current;
        const outPath =
          format === "md"
            ? exportMarkdown(conversationHistory, sessionId)
            : exportJSON(conversationHistory, sessionId);

        const ext = format === "md" ? "Markdown" : "JSON";
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `📄 Exported as ${ext}: \`${outPath}\`` },
        ]);
        return;
      }

      setMessages((prev) => [...prev, { role: "user", content: userInput }]);
      setIsLoading(true);
      setStreamingText("");
      setActiveToolCalls([]);

      // Track input history (deduplicate consecutive identical entries)
      setInputHistory((prev) =>
        prev[0] === userInput ? prev : [userInput, ...prev].slice(0, 100),
      );

      // Create abort controller for Ctrl+C interrupt
      const controller = new AbortController();
      abortRef.current = controller;

      // Build callbacks (reused across retry attempts)
      const makeCallbacks = (): Parameters<typeof runAgent>[2] => ({
        onToken: (token) => {
          setStreamingText((prev) => prev + token);
        },
        onToolCallStart: (name, args) => {
          setActiveToolCalls((prev) => [
            ...prev,
            {
              id: `${name}-${Date.now()}`,
              name,
              args,
              status: "pending",
            },
          ]);
        },
        onToolCallEnd: (name, result) => {
          setActiveToolCalls((prev) =>
            prev.map((tc) =>
              tc.name === name && tc.status === "pending"
                ? { ...tc, status: "complete", result }
                : tc,
            ),
          );
        },
        onComplete: (response) => {
          if (response) {
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: response },
            ]);
          }
          setStreamingText("");
          setActiveToolCalls([]);
        },
        onToolApproval: (name, args) => {
          if (mode === "auto") return Promise.resolve(true);
          return new Promise<boolean>((resolve) => {
            setPendingApproval({ toolName: name, args, resolve });
          });
        },
        onTokenUsage: (usage) => {
          setTokenUsage(usage);
        },
        onCostUpdate: (cost: CostUpdateInfo) => {
          setSessionCost((prev) => prev + cost.addedCost);
        },
      });

      // Truncate a message to fit within a reasonable size, keeping the
      // first portion (the question) and the tail (error summary / final lines).
      const truncate = (msg: string, maxLen = 3000): string => {
        if (msg.length <= maxLen) return msg;
        const head = msg.slice(0, Math.floor(maxLen * 0.8));
        const tail = msg.slice(-Math.floor(maxLen * 0.2));
        return `${head}\n\n... [${msg.length - maxLen} characters truncated] ...\n\n${tail}`;
      };

      let newHistory: ModelMessage[];
      let attempt = 0;
      const MAX_ATTEMPTS = 2;
      let currentInput = userInput;

      while (true) {
        attempt++;
        try {
          newHistory = await runAgent(
            currentInput,
            conversationHistory,
            makeCallbacks(),
            controller.signal,
          );
          break; // Success — exit retry loop
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);

          // Aborted by user — stop immediately
          if (errMsg === "This operation was aborted") {
            newHistory = conversationHistory;
            break;
          }

          // Check if we should retry with truncated input
          const isNoOutput =
            errMsg.includes("No output generated") ||
            (error as Error).name === "AI_NoOutputGeneratedError";
          const isTooLarge =
            errMsg.includes("too large") ||
            errMsg.includes("context length") ||
            errMsg.includes("maximum context") ||
            errMsg.includes("token") ||
            errMsg.includes("413") ||
            errMsg.includes("400");

          if (attempt < MAX_ATTEMPTS && currentInput.length > 1500 && (isNoOutput || isTooLarge)) {
            // Retry with truncated input
            const truncated = truncate(currentInput);
            setMessages((prev) => [
              ...prev.slice(0, -1), // Remove the user message (will re-add below)
              { role: "user", content: userInput }, // Keep original displayed
              {
                role: "assistant",
                content: `⚠️ The input may be too long (${currentInput.length} chars). Retrying with ${truncated.length} chars…`,
              },
            ]);
            setStreamingText("");
            setActiveToolCalls([]);
            currentInput = truncated;
            continue;
          }

          // Final failure — show error
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Error: ${errMsg}` },
          ]);
          setStreamingText("");
          newHistory = conversationHistory;
          break;
        }
      }

      setConversationHistory(newHistory);
      setIsLoading(false);
      abortRef.current = null;
    },
    [conversationHistory, exit, mode, markdownMode, currentModel, currentProvider],
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Logo />
      <Box marginBottom={1}>
        <Text dimColor>
          Type "exit" to quit | Mode:{" "}
        </Text>
        <Text color={mode === "auto" ? "green" : "yellow"} bold>
          {mode === "auto" ? "🟢 AUTO" : "🛡️ SAFE"}
        </Text>
        <Text dimColor>
          {" "}("auto"/"safe" | "md"/"raw" | "clear"/"new" | "init")
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>Model: </Text>
        <Text color="cyan">{currentModel}</Text>
        <Text dimColor> on </Text>
        <Text color={currentProvider === "lmstudio" ? "magenta" : "cyan"} bold>
          {currentProvider === "lmstudio" ? "🏠 LM Studio" : "☁️ DeepSeek"}
        </Text>
        <Text dimColor> (/model /provider)</Text>
      </Box>
      <Box marginBottom={1}>
        <Text dimColor>Models: </Text>
        {getModelsForProvider(currentProvider).slice(0, 4).map((m, i) => (
          <React.Fragment key={m.id}>
            {i > 0 && <Text dimColor>, </Text>}
            <Text dimColor>{m.id}</Text>
          </React.Fragment>
        ))}
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        {markdownMode ? (
          <Box flexDirection="column">
            {messages.map((msg, i) => (
              <Box key={i} flexDirection="column" marginBottom={1}>
                <Text color={msg.role === "user" ? "blue" : "green"} bold>
                  {msg.role === "user" ? "› You" : "› Assistant"}
                </Text>
                <Box marginLeft={2}>
                  {msg.role === "assistant" ? (
                    <Markdown>{msg.content}</Markdown>
                  ) : (
                    <Text>{msg.content}</Text>
                  )}
                </Box>
              </Box>
            ))}
          </Box>
        ) : (
          <MessageList messages={messages} />
        )}

        {streamingText && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="green" bold>
              › Assistant
            </Text>
            <Box marginLeft={2} flexDirection="column">
              {markdownMode ? (
                <StreamingOutput text={streamingText} />
              ) : (
                <Box>
                  <Text>{streamingText}</Text>
                  <Text color="gray">▌</Text>
                </Box>
              )}
            </Box>
          </Box>
        )}

        {activeToolCalls.length > 0 && !pendingApproval && (
          <Box flexDirection="column" marginTop={1}>
            {activeToolCalls.map((tc) => (
              <ToolCall
                key={tc.id}
                name={tc.name}
                args={tc.args}
                status={tc.status}
                result={tc.result}
              />
            ))}
          </Box>
        )}

        {isLoading && !streamingText && activeToolCalls.length === 0 && !pendingApproval && (
          <Box marginTop={1}>
            <Spinner />
          </Box>
        )}

        {pendingApproval && (
          <ToolApproval
            toolName={pendingApproval.toolName}
            args={pendingApproval.args}
            onResolve={(approved) => {
              pendingApproval.resolve(approved);
              setPendingApproval(null);
            }}
          />
        )}
      </Box>

      {!pendingApproval && (
        <Input onSubmit={handleSubmit} disabled={isLoading} history={inputHistory} />
      )}

      <TokenUsage usage={tokenUsage} sessionCost={sessionCost} />
    </Box>
  );
}
