import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { ModelMessage } from "ai";
import { runAgent, setRuntimeModel, setRuntimeSummarizeModel, getCurrentModelName, getCurrentProvider } from "../agent/run.ts";
import { setProviderConfig, type ProviderType } from "../agent/providers/index.ts";
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
import type { ToolApprovalRequest, TokenUsageInfo } from "../types.ts";

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

export function App() {
  const { exit } = useApp();
  const [mode, setMode] = useState<ApprovalMode>("safe");
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
  const [markdownMode, setMarkdownMode] = useState(false);
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
      if (cmd === "clear") {
        setConversationHistory([]);
        setMessages([]);
        setTokenUsage(null);
        sessionIdRef.current = generateSessionId();
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
      // Model switching at runtime (supports both "model" and "/model")
      if (cmd === "model") {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `📋 Current model: **${currentModel}** on **${currentProvider}**.\nTo switch: \`/model <name>\` (e.g., \`/model openai/gpt-oss-20b\`)` },
        ]);
        return;
      }
      if (cmd.startsWith("model ")) {
        // Extract model name after "model " or "/model " (handles both)
        const offset = userInput.trim().startsWith("/") ? 7 : 6;
        const newModel = userInput.trim().slice(offset).trim();
        if (!newModel) {
          setMessages((prev) => [...prev, { role: "assistant", content: "⚠️ Usage: `/model <model-name>` (e.g., `/model openai/gpt-oss-20b`)" }]);
          return;
        }
        setRuntimeModel(newModel);
        setRuntimeSummarizeModel(newModel);
        setCurrentModel(newModel);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `🔁 Switched to model: **${newModel}** (provider: ${currentProvider})` },
        ]);
        return;
      }
      if (cmd === "provider") {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `📋 Current provider: **${currentProvider}**.\nTo switch: \`/provider deepseek\` or \`/provider lmstudio\`` },
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
        setProviderConfig({ provider: newProvider });
        setCurrentProvider(newProvider);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `🔁 Switched provider to: **${newProvider}** (model: ${currentModel})` },
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

      try {
        const newHistory = await runAgent(userInput, conversationHistory, {
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
        }, controller.signal);

        setConversationHistory(newHistory);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        // Don't show error if it was an intentional abort
        if (errorMessage !== "This operation was aborted") {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Error: ${errorMessage}` },
          ]);
        }
        setStreamingText("");
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [conversationHistory, exit, mode],
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
          {" "}("auto"/"safe" | "md"/"raw" to toggle markdown | "clear")
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
            <Box marginLeft={2}>
              {markdownMode ? (
                <Box flexDirection="column">
                  <Markdown>{streamingText}</Markdown>
                </Box>
              ) : (
                <Text>{streamingText}</Text>
              )}
              <Text color="gray">▌</Text>
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

      <TokenUsage usage={tokenUsage} />
    </Box>
  );
}
