import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useApp } from "ink";
import type { ModelMessage } from "ai";
import { runAgent } from "../agent/run.ts";
import { Logo } from "./components/Logo.tsx";
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
  const sessionIdRef = useRef<string>(generateSessionId());

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

  const handleSubmit = useCallback(
    async (userInput: string) => {
      const input = userInput.trim().toLowerCase();
      if (input === "exit" || input === "quit") {
        exit();
        return;
      }
      // Mode switching commands (not sent to agent)
      if (input === "auto") {
        setMode("auto");
        setMessages((prev) => [...prev, { role: "assistant", content: "🟢 Auto-approve mode enabled. All tool calls will run without confirmation." }]);
        return;
      }
      if (input === "safe") {
        setMode("safe");
        setMessages((prev) => [...prev, { role: "assistant", content: "🛡️ Safe mode enabled. Tool calls will require your approval." }]);
        return;
      }
      if (input === "clear") {
        setConversationHistory([]);
        setMessages([]);
        setTokenUsage(null);
        sessionIdRef.current = generateSessionId();
        return;
      }

      setMessages((prev) => [...prev, { role: "user", content: userInput }]);
      setIsLoading(true);
      setStreamingText("");
      setActiveToolCalls([]);

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
        });

        setConversationHistory(newHistory);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${errorMessage}` },
        ]);
        setStreamingText("");
      } finally {
        setIsLoading(false);
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
        <Text dimColor> ("auto"/"safe" to switch | "clear" to reset)</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <MessageList messages={messages} />

        {streamingText && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="green" bold>
              › Assistant
            </Text>
            <Box marginLeft={2}>
              <Text>{streamingText}</Text>
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
        <Input onSubmit={handleSubmit} disabled={isLoading} />
      )}

      <TokenUsage usage={tokenUsage} />
    </Box>
  );
}
