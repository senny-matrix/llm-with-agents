import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { streamText, type ModelMessage } from 'ai';
import { getTracer, Laminar } from '@lmnr-ai/lmnr';
import { getModel, resolveModelName, resolveSummarizeModelName, type ProviderType } from './providers/index.ts';
import { SYSTEM_PROMPT } from './system/prompt.ts';
import { gatherWorkspaceContext, buildSystemPrompt } from './system/workspace.ts';
import type { AgentCallbacks, ToolCallInfo } from '../types.ts';
import { tools } from './tools/index.ts';
import { executeTool, type ToolName } from './executeTools.ts';
import { filterCompatibleMessages } from './system/filterMessages.ts';
import {
  getModelLimits,
  isOverThreshold,
  calculateUsagePercentage,
  compactConversation,
  DEFAULT_THRESHOLD,
  estimateMessagesTokens,
} from './context/index.ts';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

/** Runtime model override (set via /model command in TUI) */
let _runtimeModelOverride: string | null = null;
let _runtimeSummarizeOverride: string | null = null;

export function setRuntimeModel(model: string): void {
  _runtimeModelOverride = model;
}

export function setRuntimeSummarizeModel(model: string): void {
  _runtimeSummarizeOverride = model;
}

export function getCurrentModelName(): string {
  return _runtimeModelOverride || process.env.AGENT_MODEL || 'deepseek-v4-pro';
}

export function getCurrentProvider(): ProviderType {
  return (process.env.PROVIDER as ProviderType) || 'deepseek';
}

const lmnrApiKey = process.env.LMNR_PROJECT_API_KEY;
if (lmnrApiKey) {
  Laminar.initialize({ projectApiKey: lmnrApiKey });
}

// Build the dynamic system prompt once per process
let _systemPromptCache: string | null = null;
function getSystemPrompt(): string {
  if (!_systemPromptCache) {
    const ctx = gatherWorkspaceContext();
    _systemPromptCache = buildSystemPrompt(SYSTEM_PROMPT, ctx);
  }
  return _systemPromptCache;
}

export const runAgent = async (
  userMessage: string,
  conversationHistory: ModelMessage[],
  callbacks: AgentCallbacks,
): Promise<ModelMessage[]> => {
  const effectiveModel = _runtimeModelOverride || resolveModelName();
  const modelLimits = getModelLimits(effectiveModel);
  const dynamicSystemPrompt = getSystemPrompt();

  const workingHistory = filterCompatibleMessages(conversationHistory);

  let messages: ModelMessage[] = [
    ...workingHistory,
    { role: 'user', content: userMessage },
  ];

  const preCheckTokens = estimateMessagesTokens(messages);
  if (isOverThreshold(preCheckTokens.total, modelLimits.contextWindow)) {
    messages = await compactConversation(workingHistory, resolveSummarizeModelName(_runtimeSummarizeOverride ?? undefined));
    // Re-add the user message after compaction
    messages.push({ role: 'user', content: userMessage });
  }

  let fullResponse = '';

  const toolsWithoutExecute = Object.fromEntries(
    Object.entries(tools).map(([name, t]) => {
      const { execute, ...rest } = t;
      return [name, rest];
    }),
  );

  while (true) {
    const result = streamText({
      model: getModel(resolveModelName(_runtimeModelOverride ?? undefined)),
      system: dynamicSystemPrompt,
      messages,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: toolsWithoutExecute as any,
      maxOutputTokens: modelLimits.outputLimit,
      experimental_telemetry: {
        isEnabled: true,
        tracer: getTracer(),
      },
    });

    const reportTokenUsage = () => {
      if (callbacks.onTokenUsage) {
        const usage = estimateMessagesTokens(messages);
        callbacks.onTokenUsage({
          inputTokens: usage.input,
          outputTokens: usage.output,
          totalTokens: usage.total,
          threshold: DEFAULT_THRESHOLD,
          contextWindow: modelLimits.contextWindow,
          percentage: calculateUsagePercentage(usage.total, modelLimits.contextWindow),
        });
      }
    };

    const toolCalls: ToolCallInfo[] = [];
    let currentText = '';
    let streamError: Error | null = null;

    try {
      for await (const chunk of result.fullStream) {
        if (chunk.type === 'text-delta') {
          currentText += chunk.text;
          callbacks?.onToken?.(chunk.text);
        }

        if (chunk.type === 'tool-call') {
          const input = 'input' in chunk ? chunk.input : {};
          toolCalls.push({
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            args: input as Record<string, unknown>,
          });
          callbacks?.onToolCallStart?.(chunk.toolName, input);
        }
      }
    } catch (e) {
      streamError = e as Error;
      const msg = streamError.message ?? '';
      if (!currentText && !msg.includes('No output generated') && streamError.name !== 'AI_NoOutputGeneratedError') {
        throw streamError;
      }
    }

    fullResponse += currentText;

    // No output at all — model produced nothing (empty input, context overflow, etc.)
    if (!currentText && toolCalls.length === 0) {
      fullResponse = 'The model returned nothing for this input. The pasted content may be too long or exceed the context window. Try a shorter message or break it into smaller parts.';
      callbacks?.onToken?.(fullResponse);
      break;
    }

    // Handle stream error with partial results
    if (streamError) {
      const content: Array<{ type: string; text?: string; toolCallId?: string; toolName?: string; input?: unknown }> = [];
      if (currentText) content.push({ type: 'text', text: currentText });

      for (const tc of toolCalls) {
        content.push({
          type: 'tool-call',
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          input: tc.args,
        });
      }
      messages.push({ role: 'assistant', content } as ModelMessage);
      if (toolCalls.length === 0) break;
    } else {
      const finishReason = await result.finishReason;
      if (finishReason !== 'tool-calls' || toolCalls.length === 0) {
        const responseMessage = await result.response;
        messages.push(...responseMessage.messages);
        reportTokenUsage();
        break;
      }

      const responseMessages = await result.response;
      messages.push(...responseMessages.messages);
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
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            output: {
              type: 'text',
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
