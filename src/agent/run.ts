import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { streamText, type ModelMessage } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { getTracer, Laminar } from '@lmnr-ai/lmnr';
import { SYSTEM_PROMPT } from './system/prompt.ts';
import type {AgentCallbacks, ToolCallInfo} from '../types.ts';
import { tools } from './tools/index.ts';
import { executeTool, type ToolName } from './executeTools.ts';
import { filterCompatibleMessages} from "./system/filterMessages.ts";
import {
  estimateTokens,
  getModelLimits,
  isOverThreshold,
  calculateUsagePercentage,
  compactConversation,
  DEFAULT_THRESHOLD,
  estimateMessagesTokens
} from './context/index.ts';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

const MODEL_NAME = 'deepseek-v4-pro';

const deepseek = createDeepSeek({
  apiKey: process.env.OPENAI_API_KEY,
});

const lmnrApiKey = process.env.LMNR_PROJECT_API_KEY;
if (lmnrApiKey) {
  Laminar.initialize({ projectApiKey: lmnrApiKey });
}

export const runAgent = async (
  userMessage: string,
  conversationHistory: ModelMessage[],
  callbacks: AgentCallbacks,
): Promise<ModelMessage[]> => {
  const modelLimits = getModelLimits(MODEL_NAME);

  const workingHistory = filterCompatibleMessages(conversationHistory);

  let messages: ModelMessage[] = [
  ...workingHistory,
  { role: 'user', content: userMessage }
];

  let preCheckTokens = estimateMessagesTokens(messages);
  if(isOverThreshold(preCheckTokens.total, modelLimits.contextWindow)) {
    messages = await compactConversation(workingHistory, MODEL_NAME);
  }

  let fullResponse = "";

  const toolsWithoutExecute = Object.fromEntries(
    Object.entries(tools).map(([name, t]) => {
      const { execute, ...rest } = t;
      return [name, rest];
    })
  );

  let iteration = 0;
  while(true) {
    iteration++;
    const result = streamText({
      model: deepseek.chat(MODEL_NAME),
      system: SYSTEM_PROMPT,
      messages,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: toolsWithoutExecute as any,
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
          percentage: calculateUsagePercentage(
            usage.total,
            modelLimits.contextWindow
          )
        });
      }
    }

    const toolCalls: ToolCallInfo[] = [];
    let currentText = "";
    let streamError: Error | null = null;

    try {
      for await (const chunk of result.fullStream) {
        if (chunk.type === 'text-delta'){
          currentText += chunk.text;
          callbacks?.onToken?.(chunk.text);
        }

        if (chunk.type === 'tool-call') {
          const input = 'input' in chunk ? chunk.input : {};
          toolCalls.push({
            toolCallId: chunk.toolCallId,
            toolName: chunk.toolName,
            args: input as any
          });
          callbacks?.onToolCallStart?.(chunk.toolName, input);
        }
      }
    }catch(e){
      streamError = e as Error;
      if(!currentText && !streamError.message.includes('No output generated')) {
        throw streamError;
      }
    }

    fullResponse += currentText;

    if (streamError && !currentText && toolCalls.length === 0) {
      fullResponse = 'Sorry about that, I am working on it!!';
      callbacks?.onToken?.(fullResponse);
      break;
    }

    if (streamError) {
      const content: any[] = [];
      if (currentText) content.push({ type: 'text', text: currentText });
      const toolCallsForMessage: any[] = [];
      for (const tc of toolCalls) {
        const toolCallPart = {
          type: 'tool-call',
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          input: tc.args,
        };
        content.push(toolCallPart);
        toolCallsForMessage.push({
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          args: tc.args,
        });
      }
      const assistantMessage: any = {
        role: 'assistant',
        content,
      };
      if (toolCallsForMessage.length > 0) {
        assistantMessage.toolCalls = toolCallsForMessage;
      }
      messages.push(assistantMessage);
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
      const toolResult = await executeTool(tc.toolName as ToolName, tc.args);

      callbacks?.onToolCallEnd?.(tc.toolName, toolResult);
      toolResults.push(toolResult);

      messages.push({
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          output: {
            type: 'text',
            value: toolResult,
          },
        }],
      });
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
