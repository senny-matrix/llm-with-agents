import type { ModelMessage } from "ai";
import { Box, Text, useApp, useInput } from "ink";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { getConfig } from "../agent/config.ts";
import {
	getModelsForProvider,
	type ProviderType,
} from "../agent/providers/index.ts";
import {
	getCurrentModelName,
	getCurrentPersonaId,
	getCurrentProvider,
	runAgent,
	setRuntimePersona,
} from "../agent/run.ts";
import { resolveFileReferences } from "./utils/fileCompletion.ts";
import {
	generateSessionId,
	listSessions,
	loadSession,
	saveSession,
} from "../agent/session/store.ts";
import type {
	CostUpdateInfo,
	TokenUsageInfo,
	ToolApprovalRequest,
} from "../types.ts";
import { Input } from "./components/Input.tsx";
import { Logo } from "./components/Logo.tsx";
import { Markdown } from "./components/Markdown.tsx";
import { type Message, MessageList } from "./components/MessageList.tsx";
import { Spinner } from "./components/Spinner.tsx";
import { TokenUsage } from "./components/TokenUsage.tsx";
import { ToolApproval } from "./components/ToolApproval.tsx";
import { ToolCall, type ToolCallProps } from "./components/ToolCall.tsx";
import { ThinkingBlock } from "./components/ThinkingBlock.tsx";
import {
	useCommands,
	type ApprovalMode,
} from "./hooks/useCommands.ts";
import { extractAssistantText, extractReasoning } from "./utils/messageUtils.ts";
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActiveToolCall extends ToolCallProps {
	id: string;
}

// ---------------------------------------------------------------------------
// Streaming markdown output
// ---------------------------------------------------------------------------

/**
 * Renders streaming markdown progressively.
 * Complete paragraphs (separated by \n\n) are rendered as styled markdown.
 * The in-progress paragraph is shown as raw text with a blinking cursor.
 */
function StreamingOutput({ text }: { text: string }) {
	const paragraphs = text.split("\n\n");
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

// ---------------------------------------------------------------------------
// Main App component
// ---------------------------------------------------------------------------

export function App() {
	const { exit } = useApp();
	const cfg = getConfig();
	const [mode, setMode] = useState<ApprovalMode>(cfg.mode);
	const [messages, setMessages] = useState<Message[]>([]);
	const [conversationHistory, setConversationHistory] = useState<
		ModelMessage[]
	>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [streamingReasoning, setStreamingReasoning] = useState("");
	const [expandedBlocks, setExpandedBlocks] = useState<Record<string, boolean>>({});
	const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
	const [streamingText, setStreamingText] = useState("");
	const [activeToolCalls, setActiveToolCalls] = useState<ActiveToolCall[]>([]);
	const [pendingApproval, setPendingApproval] =
		useState<ToolApprovalRequest | null>(null);
	const [tokenUsage, setTokenUsage] = useState<TokenUsageInfo | null>(null);
	const [sessionCost, setSessionCost] = useState(0);
	const [markdownMode, setMarkdownMode] = useState(cfg.markdown);
	const [currentModel, setCurrentModel] = useState(getCurrentModelName());
	const [currentProvider, setCurrentProvider] = useState<ProviderType>(
		getCurrentProvider(),
	);
	const [currentPersona, setCurrentPersona] = useState(getCurrentPersonaId());
	// Set default persona on mount
	useEffect(() => {
		setRuntimePersona("senior-engineer");
		setCurrentPersona("senior-engineer");
	}, []);
	const sessionIdRef = useRef<string>(generateSessionId());
	const abortRef = useRef<AbortController | null>(null);
	const pendingQueueRef = useRef<string[]>([]);
	const isRunningRef = useRef(false);
	const [inputHistory, setInputHistory] = useState<string[]>([]);

	// ── Command handler (extracted hook) ──
	const handleCommand = useCommands({
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
	});

	// ── Load last session on startup ──
	useEffect(() => {
		const sessions = listSessions();
		const latest = sessions[0];
		if (latest) {
			const session = loadSession(latest.id);
			if (session) {
				sessionIdRef.current = latest.id;
				setConversationHistory(session.messages);
				const displayMsgs: Message[] = [];
				for (const msg of session.messages) {
					if (msg.role === "user" && typeof msg.content === "string") {
						displayMsgs.push({ role: "user", content: msg.content });
					} else if (msg.role === "assistant") {
						const text = extractAssistantText(msg);
						const reasoning = extractReasoning(msg);
						if (text) displayMsgs.push({ role: "assistant", content: text, reasoning });
					}
				}
				const date = latest.updatedAt.slice(0, 16).replace("T", " ");
				displayMsgs.push({
					role: "assistant",
					content: `📋 **Session restored** (${date}, ${latest.messageCount} messages). Use \`/clear\` or \`/new\` to start fresh.`,
				});
				setMessages(displayMsgs);
			}
		}
	}, []);

	// ── Debounced session save ──
	const debouncedHistoryRef = useRef(conversationHistory);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	debouncedHistoryRef.current = conversationHistory;

	const doSaveSession = useCallback((history: ModelMessage[]) => {
		if (history.length === 0) return;
		const modelName = process.env.AGENT_MODEL || "deepseek-v4-pro";
		saveSession({
			meta: {
				id: sessionIdRef.current,
				name: `Session ${sessionIdRef.current.slice(-8)}`,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				modelName,
				messageCount: history.length,
			},
			messages: history,
		});
	}, []);

	useEffect(() => {
		if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
		saveTimerRef.current = setTimeout(() => {
			doSaveSession(debouncedHistoryRef.current);
		}, 2000);
		return () => {
			if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
			doSaveSession(debouncedHistoryRef.current);
		};
	}, [conversationHistory, doSaveSession]);

	// ── Global keyboard shortcuts ──
	useInput((_input, key) => {
		if (key.ctrl && _input === "d") {
			exit();
			return;
		}
		if (key.ctrl && _input === "l") {
			setConversationHistory([]);
			setMessages([]);
			setTokenUsage(null);
			setSessionCost(0);
			setStreamingText("");
			setStreamingReasoning("");
			setActiveToolCalls([]);
			setExpandedBlocks({});
			setFocusedBlockId(null);
			sessionIdRef.current = generateSessionId();
			return;
		}

		// Collect all thinking block IDs in display order
		const getBlockIds = (): string[] => {
			const ids: string[] = [];
			for (let i = 0; i < messages.length; i++) {
				if (messages[i].role === "assistant" && messages[i].reasoning) {
					ids.push(`msg-${i}`);
				}
			}
			if (streamingReasoning) ids.push("streaming");
			return ids;
		};

		if (key.ctrl && _input === "t") {
			const ids = getBlockIds();
			if (ids.length === 0) return;
			const allExpanded = ids.every((id) => expandedBlocks[id]);
			setExpandedBlocks((prev) => {
				const next = { ...prev };
				for (const id of ids) {
					if (allExpanded) delete next[id];
					else next[id] = true;
				}
				return next;
			});
			return;
		}

		if (_input === "\t") {
			const ids = getBlockIds();
			if (ids.length === 0) return;
			const shift = key.shift || false;
			const currentIdx = focusedBlockId ? ids.indexOf(focusedBlockId) : -1;
			let nextIdx: number;
			if (shift) {
				nextIdx = currentIdx <= 0 ? ids.length - 1 : currentIdx - 1;
			} else {
				nextIdx = currentIdx >= ids.length - 1 ? 0 : currentIdx + 1;
			}
			setFocusedBlockId(ids[nextIdx]);
			// Auto-expand focused block
			setExpandedBlocks((prev) => ({ ...prev, [ids[nextIdx]]: true }));
			return;
		}

		if (_input === "\r" && focusedBlockId) {
			setExpandedBlocks((prev) => {
				if (prev[focusedBlockId]) {
					const next = { ...prev };
					delete next[focusedBlockId];
					return next;
				}
				return { ...prev, [focusedBlockId]: true };
			});
			return;
		}

		if (_input === " " && focusedBlockId) {
			setExpandedBlocks((prev) => {
				if (prev[focusedBlockId]) {
					const next = { ...prev };
					delete next[focusedBlockId];
					return next;
				}
				return { ...prev, [focusedBlockId]: true };
			});
			return;
		}

		if (key.escape) {
			setFocusedBlockId(null);
			if (abortRef.current && !abortRef.current.signal.aborted) {
				abortRef.current.abort();
				setMessages((prev) => [
					...prev,
					{ role: "assistant", content: "⏹️ Interrupted." },
				]);
			}
			return;
		}
		if (key.ctrl && _input === "c") {
			if (abortRef.current && !abortRef.current.signal.aborted) {
				abortRef.current.abort();
				setMessages((prev) => [
					...prev,
					{ role: "assistant", content: "⏹️ Interrupted." },
				]);
				return;
			}
			exit();
		}
	});

	// ── Agent dispatch ──
	const handleSubmit = useCallback(
		async (userInput: string) => {
			// Ref-based guard: prevents concurrent dispatches regardless of closure freshness
			if (isLoading || isRunningRef.current) {
				pendingQueueRef.current.push(userInput);
				setMessages((prev) => [
					...prev,
					{ role: "assistant", content: `📥 **Queued** (${pendingQueueRef.current.length}) — will process after the current task finishes.` },
				]);
				return;
			}
			// 1. Try to handle as a slash command
			const cmdResult = handleCommand(userInput);
			if (cmdResult.handled) {
				// Some commands transform the input (e.g. /init)
				if (cmdResult.forwardInput) {
					userInput = cmdResult.forwardInput;
					// Fall through to agent dispatch
				} else {
					return;
				}
			}

			// 2. Dispatch to agent
			setMessages((prev) => [...prev, { role: "user", content: userInput }]);
			setIsLoading(true);
			setStreamingText("");
			setStreamingReasoning("");
			setActiveToolCalls([]);

			setInputHistory((prev) =>
				prev[0] === userInput ? prev : [userInput, ...prev].slice(0, 100),
			);

			const controller = new AbortController();
			abortRef.current = controller;

			// Build callbacks
		const makeCallbacks = (): Parameters<typeof runAgent>[2] => ({
				onToken: (token) => {
					setStreamingText((prev) => prev + token);
				},
				onReasoning: (token) => {
					setStreamingReasoning((prev) => prev + token);
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
				onComplete: (response, meta) => {
					if (response) {
						setMessages((prev) => [
							...prev,
							{ role: "assistant", content: response, reasoning: meta?.reasoning },
						]);
					}
					setStreamingText("");
					setStreamingReasoning("");
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

			// Truncate helper for retry
			const truncate = (msg: string, maxLen = 3000): string => {
				if (msg.length <= maxLen) return msg;
				const head = msg.slice(0, Math.floor(maxLen * 0.8));
				const tail = msg.slice(-Math.floor(maxLen * 0.2));
				return `${head}\n\n... [${msg.length - maxLen} characters truncated] ...\n\n${tail}`;
			};
			// Resolve @file references so the agent gets file content
			const resolvedInput = resolveFileReferences(userInput);
			if (resolvedInput !== userInput) {
				userInput = resolvedInput;
				setMessages((prev) => [
					...prev,
					{ role: "assistant", content: "📎 Inlined file references from `@` paths." },
				]);
			}
			let newHistory: ModelMessage[];
			let attempt = 0;
			const MAX_ATTEMPTS = 2;
			let currentInput = userInput;

			isRunningRef.current = true;
			while (true) {
				attempt++;
				try {
					newHistory = await runAgent(
						currentInput,
						conversationHistory,
						makeCallbacks(),
						controller.signal,
					);
					break;
				} catch (error) {
					const errMsg = error instanceof Error ? error.message : String(error);

					if (errMsg === "This operation was aborted") {
						newHistory = conversationHistory;
						break;
					}

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

					if (
						attempt < MAX_ATTEMPTS &&
						currentInput.length > 1500 &&
						(isNoOutput || isTooLarge)
					) {
						const truncated = truncate(currentInput);
						setMessages((prev) => [
							...prev.slice(0, -1),
							{ role: "user", content: userInput },
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
			isRunningRef.current = false;
			abortRef.current = null;
		},
		[conversationHistory, isLoading, exit, mode, markdownMode, currentModel, currentProvider, handleCommand],
	);

	// ── Dequeue next request when loading finishes ──
	const handleSubmitRef = useRef(handleSubmit);
	handleSubmitRef.current = handleSubmit;

	useEffect(() => {
		if (!isLoading && pendingQueueRef.current.length > 0) {
			const next = pendingQueueRef.current.shift()!;
			handleSubmitRef.current(next);
		}
	}, [isLoading]);

	// ── Render ──
	return (
		<Box flexDirection="column" padding={1}>
			<Logo />
			<Box marginBottom={1}>
				<Text dimColor>Type "exit" to quit | Mode: </Text>
				<Text color={mode === "auto" ? "green" : "yellow"} bold>
					{mode === "auto" ? "🟢 AUTO" : "🛡️ SAFE"}
				</Text>
				<Text dimColor>
					{" "}
					("auto"/"safe" | "md"/"raw" | "persona" | "clear" | "init" | "Tab thinking" | "Enter toggle")
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
				<Text dimColor>Status: </Text>
				{isLoading ? (
					<>
						{streamingText ? (
							<Text color="green" dimColor={false}>
								◇ Streaming {streamingText.length > 0 ? `(${(streamingText.length / 4).toFixed(0)} tok)` : ""}
							</Text>
						) : activeToolCalls.length > 0 ? (
							<Text color="yellow">
								⚙️ Running tools ({activeToolCalls.length})
							</Text>
						) : (
							<Text color="cyan" dimColor={false}>
								● Processing
							</Text>
						)}
						{pendingQueueRef.current.length > 0 && (
							<Text dimColor> · 📦 {pendingQueueRef.current.length} queued</Text>
						)}
					</>
				) : (
					<Text dimColor>Idle</Text>
				)}
			</Box>
			<Box marginBottom={1}>
				<Text dimColor>Models: </Text>
				{getModelsForProvider(currentProvider)
					.slice(0, 4)
					.map((m, i) => (
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
								{msg.role === "assistant" && msg.reasoning && (
									<ThinkingBlock reasoning={msg.reasoning} expanded={!!expandedBlocks[`msg-${i}`]} isFocused={focusedBlockId === `msg-${i}`} />
								)}
							</Box>
						))}
					</Box>
				) : (
					<MessageList messages={messages} expandedBlocks={expandedBlocks} focusedBlockId={focusedBlockId} />
				)}

				{streamingReasoning && (
					<Box flexDirection="column" marginTop={1}>
						<ThinkingBlock reasoning={streamingReasoning} expanded={!!expandedBlocks["streaming"]} isFocused={focusedBlockId === "streaming"} />
					</Box>
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
			</Box>
			{isLoading && (
				<Box marginTop={1} marginBottom={1}>
					<Text bold>
						{streamingText ? (
							<Text color="green">◇ Streaming ({(streamingText.length / 4).toFixed(0)} tok)</Text>
						) : activeToolCalls.length > 0 ? (
							<Text color="yellow">⚙️ Running tools ({activeToolCalls.length})</Text>
						) : (
							<Text color="cyan">● Processing...</Text>
						)}
						{pendingQueueRef.current.length > 0 && (
							<Text dimColor> · 📦 {pendingQueueRef.current.length} queued</Text>
						)}
					</Text>
					<Text dimColor> · Esc to cancel</Text>
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

			{!pendingApproval && (
				<Input
					onSubmit={handleSubmit}
					disabled={false}
					history={inputHistory}
				/>
			)}

			<TokenUsage usage={tokenUsage} sessionCost={sessionCost} />
		</Box>
	);
}
