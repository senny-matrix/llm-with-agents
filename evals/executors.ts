import {
  generateText,
  stepCountIs,
  tool,
  zodSchema,
  type ToolSet,
  type ModelMessage,
} from "ai";
import { z } from "zod";
import type {
  EvalData,
  SingleTurnResult,
  MultiTurnEvalData,
  MultiTurnResult,
} from "./types.ts";
import {buildMessages, buildMockedTools} from "./utils.ts";
import { deepseek } from "@ai-sdk/deepseek";
import {SYSTEM_PROMPT} from "../src/agent/system/prompt.ts";

const TOOL_DEFINITIONS = {
  readFile: {
    description: "Reads the content of a file at a given path.",
    parameters: z.object({
      path: z.string().describe("The path to the file to read."),
    }),
  },
  writeFile: {
    description: "Writes given content to a file at a given path.",
    parameters: z.object({
      path: z.string().describe("The path to the file to write."),
      content: z.string().describe("The content to write to the file."),
    }),
  },
  listFiles: {
    description: "Lists all files in a given directory.",
    parameters: z.object({
      path: z.string().describe("The path to the directory to list."),
    }),
  },
  deleteFile: {
    description: "Deletes a file at a given path.",
    parameters: z.object({
      path: z.string().describe("The path to the file to delete."),
    }),
  },
  runCommand: {
    description: "Runs a shell command in the terminal and returns its output.",
    parameters: z.object({
      command: z.string().describe("The shell command to run in the terminal."),
    }),
  },
};

export const singleTurnExecutorWithMocks = async (data: EvalData) => {
  const messages = buildMessages(data);

  const tools: ToolSet = {};
  for (const toolName of data.tools) {
    const def = TOOL_DEFINITIONS[toolName as keyof typeof TOOL_DEFINITIONS];
    if (def) {
      tools[toolName] = tool({
        description: def.description,
        inputSchema: zodSchema(def.parameters as any),
        // We can add an implementation here if we want
        // to actually execute the tools during the evaluation,
        // but for now we'll just return the tool calls without executing them.
      });
    } else {
      console.warn(`Tool definition for ${toolName} not found.`);
    }
  };

  const systemMessage = messages[0];
  const userMessages = messages.slice(1);

  const { toolCalls } = await generateText({
    // model: openai.chat("gpt-4o-mini"),
    model: deepseek.chat(data.config?.model ?? "deepseek-v4-pro"),
    system: typeof messages[0].content === "string"
    ? messages[0].content
    : JSON.stringify(messages[0].content),
    messages:  messages.slice(1) as any,
    tools,
    stopWhen: stepCountIs(1),
    temperature: data.config?.temperature ?? undefined,
  });

  const calls = toolCalls.map((tc) => ({
    toolName: tc.toolName,
    args: 'input' in tc ? tc.input : {},
  }));

  const toolNames = toolCalls.map((tc) => tc.toolName);

  return {
    toolCalls,
    toolNames,
    selectedAny: toolCalls.length > 0,
  };
};

/**
 * Multi-turn executor with mocked tools.
 * Run a complete agent loop with tools returning fixed values.
 */
export const multiTurnWithMocks = async (
    data: MultiTurnEvalData
) => {
  const tools = buildMockedTools(data.mockTools);

  const messages: ModelMessage[] = data.messages ?? [
    {role: 'system', content: SYSTEM_PROMPT},
    {role: 'user', content: data.prompt!},
  ];

  const result = await generateText({
    model: deepseek.chat(data.config?.model ?? "deepseek-v4-pro"),
    messages,
    tools,
    stopWhen: stepCountIs(data.config?.maxSteps ?? 23),
  });

  const allToolCalls: string[] = [];
  const steps = result?.steps.map((step) => {
    const stepToolCalls = (step.toolCalls ?? []).map((tc) => {
      allToolCalls.push(tc.toolName);
      return {
        toolName: tc.toolName,
        args: 'input' in tc ? tc.input : {},
      };
    });
    const stepToolResults = (step.toolResults ?? [])
        .map((tr) => ({
      toolName: tr.toolName,
      result: 'result' in tr ? tr.result : tr,
    }))

    return {
      toolCalls: stepToolCalls.length > 0 ? stepToolCalls : undefined,
      toolResults: stepToolResults.length > 0 ? stepToolResults : undefined,
      text: step.text || undefined,
    }
    });

  const toolsUsed = [ new Set(allToolCalls) ];

  return {
    text: result.text,
    steps,
    toolsUsed,
    toolCallOrder: allToolCalls,
  }
}

