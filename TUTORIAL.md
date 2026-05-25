# Tutorial: Understanding the AI Agent Codebase

This tutorial walks through the complete codebase of **"Build an AI Agent from Scratch"** — a two-day course that builds a general-purpose AI agent in TypeScript, from first principles.

---

## Chapter 0: Project Setup — From Zero to Working Agent

This chapter is a hands-on walkthrough. You'll create every file from scratch, install every dependency, and end with a working AI agent running in your terminal. Follow each step in order — every line of code is shown.

---

### 0.1 Prerequisites

You need:
- **Node.js 18+** and **npm** — [download from nodejs.org](https://nodejs.org)
- **A code editor** — VS Code recommended
- **A terminal** — Terminal.app (Mac), Windows Terminal, or your Linux terminal
- **A DeepSeek API key** — sign up at [platform.deepseek.com](https://platform.deepseek.com), create an API key, and add credits (minimum $2)

Verify your setup:
```bash
node --version   # should be v18 or higher
npm --version    # should be v9 or higher
```

---

### 0.2 Create the Project Directory

```bash
mkdir my-ai-agent
cd my-ai-agent
npm init -y
```

This creates a `package.json` with defaults. We'll modify it later.

---

### 0.3 Install All Dependencies

Run these two commands:

```bash
# Runtime dependencies (the agent needs these to run)
npm install ai @ai-sdk/deepseek dotenv ink ink-spinner react zod

# Development dependencies (only needed during development)
npm install -D typescript tsx @types/node @types/react
```

What each package does:

| Package | Purpose |
|---------|---------|
| `ai` | Vercel AI SDK — handles the LLM conversation loop (`generateText`, `streamText`) |
| `@ai-sdk/deepseek` | Connects the AI SDK to DeepSeek's models |
| `dotenv` | Loads API keys from a `.env` file |
| `ink` | React for the terminal — lets you build CLI apps with React components |
| `ink-spinner` | A loading spinner component for Ink |
| `react` | React itself (Ink is built on React) |
| `zod` | Schema validation — defines what arguments each tool expects |
| `typescript` | The TypeScript compiler (`tsc`) |
| `tsx` | Runs TypeScript files directly (no compile step needed) |
| `@types/node` | TypeScript type definitions for Node.js |
| `@types/react` | TypeScript type definitions for React |

---

### 0.4 Configure TypeScript

Create `tsconfig.json` in the project root:

```bash
touch tsconfig.json
```

Open it and write:

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "lib": ["ES2022"],
    "jsx": "react-jsx",
    "moduleResolution": "bundler",
    "types": ["node"],
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true,
    "moduleDetection": "force",
    "module": "Preserve",
    "resolveJsonModule": true,
    "allowJs": true
  }
}
```

Key settings explained:
- `"jsx": "react-jsx"` — enables JSX syntax (Ink uses React components)
- `"moduleResolution": "bundler"` — lets us import files with `.ts` extensions
- `"noEmit": true` — `tsx` runs TypeScript directly; we don't need compiled `.js` files
- `"strict": true` — catches bugs early with strict type checking
- `"allowImportingTsExtensions": true` — allows `import { foo } from './bar.ts'`

---

### 0.5 Create the Environment File

Create `.env` in the project root:

```bash
touch .env
```

Write your API key:

```env
OPENAI_API_KEY=sk-your-deepseek-api-key-here
```

> **Why `OPENAI_API_KEY`?** The `@ai-sdk/deepseek` provider reads this environment variable by convention — DeepSeek's API is OpenAI-compatible.

Also create `.gitignore` so you don't accidentally commit your API key:

```gitignore
node_modules/
dist/
.env
```

---

### 0.6 Create the File Structure

Create all the directories first:

```bash
mkdir -p src/agent/tools
mkdir -p src/agent/system
mkdir -p src/agent/context
mkdir -p src/ui/components
```

Your project should now look like this:

```
my-ai-agent/
├── .env
├── .gitignore
├── package.json
├── tsconfig.json
└── src/
    ├── agent/
    │   ├── tools/
    │   ├── system/
    │   └── context/
    └── ui/
        └── components/
```

Now we'll create each file, one at a time, from the inside out — starting with the simplest building blocks and working up to the entry point.

---

#### File 1: Shared Types (`src/types.ts`)

This file defines the interfaces that connect the agent logic to the UI. Create it first because other files import from it.

```typescript
export interface AgentCallbacks {
  onToken?: (token: string) => void;
  onToolCallStart?: (name: string, args: unknown) => void;
  onToolCallEnd?: (name: string, result: string) => void;
  onComplete?: (response: string) => void;
  onToolApproval?: (name: string, args: unknown) => Promise<boolean>;
  onTokenUsage?: (usage: TokenUsageInfo) => void;
}

export interface ToolApprovalRequest {
  toolName: string;
  args: unknown;
  resolve: (approved: boolean) => void;
}

export interface ToolCallInfo {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ModelLimits {
  inputLimit: number;
  outputLimit: number;
  contextWindow: number;
}

export interface TokenUsageInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextWindow: number;
  threshold: number;
  percentage: number;
}
```

**What this does**: `AgentCallbacks` is the contract between the agent loop and the UI. The agent calls `onToken` when text arrives, `onToolCallStart` when a tool begins, and so on. The UI implements these callbacks to update the screen.

---

#### File 2: The System Prompt (`src/agent/system/prompt.ts`)

This is the personality and behavior rules sent to the LLM at the start of every conversation.

```typescript
export const SYSTEM_PROMPT = `You are a helpful AI assistant. You provide clear, accurate, and concise responses to user questions.

Guidelines:
- Be direct and helpful
- If you don't know something, say so honestly
- Provide explanations when they add value
- Stay focused on the user's actual question`;
```

---

#### File 3: Message Filtering (`src/agent/system/filterMessages.ts`)

Not all message formats from tools or providers are compatible when fed back to the LLM. This filter keeps only clean messages.

```typescript
import type { ModelMessage } from "ai";

export const filterCompatibleMessages = (
  messages: ModelMessage[],
): ModelMessage[] => {
  return messages.filter((msg) => {
    if (msg.role === "user" || msg.role === "system") {
      return true;
    }

    if (msg.role === "assistant") {
      const content = msg.content;
      if (typeof content === "string" && content.trim()) {
        return true;
      }
      if (Array.isArray(content)) {
        const hasTextContent = content.some((part: unknown) => {
          if (typeof part === "string" && part.trim()) return true;
          if (typeof part === "object" && part !== null && "text" in part) {
            const textPart = part as { text?: string };
            return textPart.text && textPart.text.trim();
          }
          return false;
        });
        return hasTextContent;
      }
    }

    if (msg.role === "tool") {
      return true;
    }

    return false;
  });
};
```

---

#### File 4: The DateTime Tool (`src/agent/tools/dateTime.ts`)

Every tool has three parts: a description (tells the LLM *when* to use it), an input schema (what arguments it expects), and an execute function (what it actually does).

```typescript
import { tool } from "ai";
import { z } from "zod";

export const dateTime = tool({
    description: "Returns the current time and date. Use this tool before any time related task",
    inputSchema: z.object({}),
    execute: async () => {
        return `The current date and time in ISO format is: ${new Date().toISOString()}`;
    }
});
```

---

#### File 5: The File Tools (`src/agent/tools/file.ts`)

These give the agent the ability to read, write, list, and delete files on your computer.

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import fs from 'node:fs/promises';
import nodePath from 'node:path';

export const readFile = tool({
    description: 'Read the full content of the file at a given path, always use this to read a file',
    inputSchema: z.object({
        path: z.string().describe('The absolute or relative path to the file to read'),
    }),
    execute: async ({ path }) => {
        try {
            const content = await fs.readFile(path, 'utf8');
            return content.toString();
        } catch (e) {
            return `There was an error reading the file. Here is the native error from node.js: ${e}`;
        }
    }
});

export const writeFile = tool({
    description: 'Write content to a file at a specified given path. Create the file if it does not exist and will overwrite if it does.',
    inputSchema: z.object({
        path: z.string().describe('The absolute or relative path to the file to write'),
        content: z.string().describe('The content to write to the file'),
    }),
    execute: async ({ path, content }) => {
        try {
            const dir = nodePath.dirname(path);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(path, content, { encoding: 'utf8' });
            return `Successfully wrote ${content.length} characters to ${path}`;
        } catch (e) {
            return `Was not able to write the content at ${path}. Here is the node.js error: ${e}`;
        }
    }
});

export const listFiles = tool({
    description: 'List all the files and directories in the specified directory path',
    inputSchema: z.object({
        directory: z
            .string()
            .describe('The directory path to list the contents of')
            .default('.'),
    }),
    execute: async ({ directory }) => {
        try {
            const entries = await fs.readdir(directory, { withFileTypes: true });
            const items = entries.map(entry => {
                const type = entry.isDirectory() ? '[dir]' : '[file]';
                return `${type} ${entry.name}`;
            });
            return items.length > 0
                ? `The following items are in ${directory}:\n${items.sort().join('\n')}`
                : `The directory ${directory} appears to be empty.`;
        } catch (e) {
            return `There was an error listing the contents of ${directory}. Here is the node.js error: ${e}`;
        }
    }
});

export const deleteFile = tool({
    description: 'Delete the file at the specified given path. Use with caution as this is very destructive and can not be undone.',
    inputSchema: z.object({
        path: z.string().describe('The absolute or relative path to the file you want to delete'),
    }),
    execute: async ({ path }) => {
        try {
            await fs.unlink(path);
            return `Successfully deleted the file at ${path}`;
        } catch (e) {
            return `There was an error deleting the file at ${path}. Here is the node.js error: ${e}`;
        }
    }
});
```

---

#### File 6: Tool Registry (`src/agent/tools/index.ts`)

This file collects all tools into a single object. The agent loop references this registry — add a new tool here, and the agent can use it.

```typescript
import { dateTime } from "./dateTime.ts";
import { deleteFile, listFiles, readFile, writeFile } from "./file.ts";

export const tools = {
    dateTime,
    deleteFile,
    listFiles,
    readFile,
    writeFile,
};

export { readFile, writeFile, deleteFile, listFiles } from "./file.ts";
```

---

#### File 7: Tool Executor (`src/agent/executeTools.ts`)

When the LLM says "call the `dateTime` tool," this function looks up the tool by name and runs its `execute` function.

```typescript
import { tools } from "./tools/index.ts";

export type ToolName = keyof typeof tools;

export const executeTool = async (name: ToolName, args: any) => {
    const tool = tools[name];
    if (!tool) {
        return 'Unknown tool, this does not exist';
    }
    const execute = tool.execute;

    if (!execute) {
        return 'This tool does not have an execute function and is not a registered tool';
    }

    const result = await tool.execute(args, {
        toolCallId: '',
        messages: [],
    });

    return String(result);
};
```

---

#### File 8: Token Estimation (`src/agent/context/tokenEstimator.ts`)

LLMs have limited context windows. This module estimates how many tokens the conversation has consumed.

```typescript
import type { ModelMessage } from "ai";

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.75);
}

export function extractMessageText(message: ModelMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part === "string") return part;
        if ("text" in part && typeof part.text === "string") return part.text;
        if ("value" in part && typeof part.value === "string") return part.value;
        if ("output" in part && typeof part.output === "object" && part.output) {
          const output = part.output as Record<string, unknown>;
          if ("value" in output && typeof output.value === "string") {
            return output.value;
          }
        }
        return JSON.stringify(part);
      })
      .join(" ");
  }

  return JSON.stringify(message.content);
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export function estimateMessagesTokens(messages: ModelMessage[]): TokenUsage {
  let input = 0;
  let output = 0;

  for (const message of messages) {
    const text = extractMessageText(message);
    const tokens = estimateTokens(text);

    if (message.role === "assistant") {
      output += tokens;
    } else {
      input += tokens;
    }
  }

  return {
    input,
    output,
    total: input + output,
  };
}
```

---

#### File 9: Model Limits (`src/agent/context/modelLimits.ts`)

Defines context window sizes for different models and checks if usage exceeds thresholds.

```typescript
import type { ModelLimits } from "../../types.ts";

export const DEFAULT_THRESHOLD = 0.8;

const MODEL_LIMITS: Record<string, ModelLimits> = {
  "gpt-5": {
    inputLimit: 272000,
    outputLimit: 128000,
    contextWindow: 400000,
  },
  "gpt-5-mini": {
    inputLimit: 272000,
    outputLimit: 128000,
    contextWindow: 400000,
  },
};

const DEFAULT_LIMITS: ModelLimits = {
  inputLimit: 128000,
  outputLimit: 16000,
  contextWindow: 128000,
};

export function getModelLimits(model: string): ModelLimits {
  if (MODEL_LIMITS[model]) {
    return MODEL_LIMITS[model];
  }

  if (model.startsWith("gpt-5")) {
    return MODEL_LIMITS["gpt-5"];
  }

  return DEFAULT_LIMITS;
}

export function isOverThreshold(
  totalTokens: number,
  contextWindow: number,
  threshold: number = DEFAULT_THRESHOLD,
): boolean {
  return false;
}

export function calculateUsagePercentage(
  totalTokens: number,
  contextWindow: number,
): number {
  return 0;
}
```

---

#### File 10: Compaction (`src/agent/context/compaction.ts`)

When the conversation gets too long, this summarizes earlier messages. This is a stub — the full implementation is covered in later lessons.

```typescript
import { generateText, type ModelMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { extractMessageText } from "./tokenEstimator.ts";

const SUMMARIZATION_PROMPT = ``;

function messagesToText(messages: ModelMessage[]): string {
  return messages
    .map((msg) => {
      const role = msg.role.toUpperCase();
      const content = extractMessageText(msg);
      return `[${role}]: ${content}`;
    })
    .join("\n\n");
}

export async function compactConversation(
  messages: ModelMessage[],
  model: string = "gpt-5-mini",
): Promise<any> {
  // Stub — full implementation in later chapters
}
```

---

#### File 11: Context Barrel Export (`src/agent/context/index.ts`)

Re-exports everything from the context sub-modules so other files can import from a single path.

```typescript
export {
  estimateTokens,
  estimateMessagesTokens,
  extractMessageText,
  type TokenUsage,
} from "./tokenEstimator.ts";

export {
  DEFAULT_THRESHOLD,
  getModelLimits,
  isOverThreshold,
  calculateUsagePercentage,
} from "./modelLimits.ts";

export { compactConversation } from "./compaction.ts";
```

---

#### File 12: The Agent Loop (`src/agent/run.ts`)

This is the heart of the agent. It takes a user message and conversation history, sends them to DeepSeek with all available tools, streams the response token-by-token, executes any tool calls, feeds results back to the LLM, and repeats until the LLM produces a final text response.

```typescript
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { streamText, type ModelMessage } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { SYSTEM_PROMPT } from './system/prompt.ts';
import type { AgentCallbacks, ToolCallInfo } from '../types.ts';
import { tools } from './tools/index.ts';
import { executeTool, type ToolName } from './executeTools.ts';
import { filterCompatibleMessages } from "./system/filterMessages.ts";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

const MODEL_NAME = 'deepseek-chat';

const deepseek = createDeepSeek({
  apiKey: process.env.OPENAI_API_KEY,
});

export const runAgent = async (
  userMessage: string,
  conversationHistory: ModelMessage[],
  callbacks: AgentCallbacks,
): Promise<ModelMessage[]> => {
  const workingHistory = filterCompatibleMessages(conversationHistory);

  const messages: ModelMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...workingHistory,
    { role: 'user', content: userMessage }
  ];

  let fullResponse = "";

  const toolsWithoutExecute = Object.fromEntries(
    Object.entries(tools).map(([name, t]) => {
      const { execute, ...rest } = t;
      return [name, rest];
    })
  );

  let iteration = 0;
  while (true) {
    iteration++;
    const result = streamText({
      model: deepseek.chat(MODEL_NAME),
      messages,
      tools: toolsWithoutExecute,
    });

    const toolCalls: ToolCallInfo[] = [];
    let currentText = "";
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
            args: input as any
          });
          callbacks?.onToolCallStart?.(chunk.toolName, input);
        }
      }
    } catch (e) {
      streamError = e as Error;
      if (!currentText && !streamError.message.includes('No output generated')) {
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
    }

    if (streamError && toolResults.length > 0 && !currentText) {
      fullResponse = `[Tool execution completed. ${toolResults.length} result(s) available. The agent will respond in the next message.]`;
      callbacks?.onToken?.(fullResponse);
    }
  }
  callbacks?.onComplete?.(fullResponse);
  return messages;
};
```

**What's happening here**, step by step:

1. Load the `.env` file to get the API key
2. Create a DeepSeek client using that key
3. Build the message array: system prompt → conversation history → user's new message
4. Strip the `execute` functions from tools (the LLM doesn't need them — only the descriptions and schemas)
5. **Enter the loop**: call `streamText()` which sends everything to DeepSeek
6. **Stream the response**: as tokens arrive, call `onToken` so the UI updates in real-time
7. **Handle tool calls**: if the LLM says "call `dateTime`," extract the tool name and arguments
8. **Execute tools**: run each tool, collect results
9. **Feed results back**: add tool results to the message array and loop again
10. **Exit**: when the LLM produces text (not a tool call), we're done

---

#### File 13: The Input Component (`src/ui/components/Input.tsx`)

Captures keystrokes, builds the input string, handles Enter and Backspace.

```typescript
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface InputProps {
  onSubmit: (value: string) => void;
  disabled?: boolean;
}

export function Input({ onSubmit, disabled = false }: InputProps) {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (disabled) return;

    if (key.return) {
      if (value.trim()) {
        onSubmit(value);
        setValue('');
      }
      return;
    }

    if (key.backspace || key.delete) {
      setValue((prev) => prev.slice(0, -1));
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      setValue((prev) => prev + input);
    }
  });

  return (
    <Box>
      <Text color="blue" bold>
        {'> '}
      </Text>
      <Text>{value}</Text>
      {!disabled && <Text color="gray">▌</Text>}
    </Box>
  );
}
```

---

#### File 14: The Message List Component (`src/ui/components/MessageList.tsx`)

Renders past messages — blue for the user, green for the assistant.

```typescript
import React from 'react';
import { Box, Text } from 'ink';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface MessageListProps {
  messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <Box flexDirection="column" gap={1}>
      {messages.map((message, index) => (
        <Box key={index} flexDirection="column">
          <Text color={message.role === 'user' ? 'blue' : 'green'} bold>
            {message.role === 'user' ? '› You' : '› Assistant'}
          </Text>
          <Box marginLeft={2}>
            <Text>{message.content}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}
```

---

#### File 15: The Spinner Component (`src/ui/components/Spinner.tsx`)

Shows "Thinking..." with an animated spinner while the LLM is processing.

```typescript
import React from 'react';
import { Text } from 'ink';
import InkSpinner from 'ink-spinner';

interface SpinnerProps {
  label?: string;
}

export function Spinner({ label = 'Thinking...' }: SpinnerProps) {
  return (
    <Text>
      <Text color="cyan">
        <InkSpinner type="dots" />
      </Text>
      {' '}
      <Text dimColor>{label}</Text>
    </Text>
  );
}
```

---

#### File 16: The Tool Call Component (`src/ui/components/ToolCall.tsx`)

Shows a tool being executed — ⚡ icon, spinner while pending, ✓ when done.

```typescript
import React from 'react';
import { Box, Text } from 'ink';
import InkSpinner from 'ink-spinner';

export interface ToolCallProps {
  name: string;
  args?: unknown;
  status: 'pending' | 'complete';
  result?: string;
}

export function ToolCall({ name, status, result }: ToolCallProps) {
  const previewLength = 500;
  const truncated = result && result.length > previewLength;
  const displayResult = result ? (truncated ? result.slice(0, previewLength) : result) : '';

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box>
        <Text color="yellow">⚡ </Text>
        <Text color="yellow" bold>
          {name}
        </Text>
        {status === 'pending' ? (
          <Text>
            {' '}
            <Text color="cyan">
              <InkSpinner type="dots" />
            </Text>
          </Text>
        ) : (
          <Text color="green"> ✓</Text>
        )}
      </Box>
      {status === 'complete' && displayResult && (
        <Box flexDirection="column" marginLeft={2}>
          <Text dimColor>→ {displayResult}</Text>
          {truncated && (
            <Text dimColor>
              ... (showing first {previewLength} of {result.length} characters)
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
```

---

#### File 17: The Tool Approval Component (`src/ui/components/ToolApproval.tsx`)

Asks "Approve this tool? Yes/No" for sensitive operations. This is HITL (Human In The Loop).

```typescript
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface ToolApprovalProps {
  toolName: string;
  args: unknown;
  onResolve: (approved: boolean) => void;
}

const MAX_PREVIEW_LINES = 5;

function formatArgs(args: unknown): { preview: string; extraLines: number } {
  const formatted = JSON.stringify(args, null, 2);
  const lines = formatted.split("\n");

  if (lines.length <= MAX_PREVIEW_LINES) {
    return { preview: formatted, extraLines: 0 };
  }

  const preview = lines.slice(0, MAX_PREVIEW_LINES).join("\n");
  const extraLines = lines.length - MAX_PREVIEW_LINES;
  return { preview, extraLines };
}

function getArgsSummary(args: unknown): string {
  if (typeof args !== "object" || args === null) {
    return String(args);
  }

  const obj = args as Record<string, unknown>;
  const meaningfulKeys = ["path", "filePath", "command", "query", "code", "content"];
  for (const key of meaningfulKeys) {
    if (key in obj && typeof obj[key] === "string") {
      const value = obj[key] as string;
      if (value.length > 50) {
        return value.slice(0, 50) + "...";
      }
      return value;
    }
  }

  const keys = Object.keys(obj);
  if (keys.length > 0 && typeof obj[keys[0]] === "string") {
    const value = obj[keys[0]] as string;
    if (value.length > 50) {
      return value.slice(0, 50) + "...";
    }
    return value;
  }

  return "";
}

export function ToolApproval({ toolName, args, onResolve }: ToolApprovalProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const options = ["Yes", "No"];

  useInput(
    (input, key) => {
      if (key.upArrow || key.downArrow) {
        setSelectedIndex((prev) => (prev === 0 ? 1 : 0));
        return;
      }

      if (key.return) {
        onResolve(selectedIndex === 0);
      }
    },
    { isActive: true }
  );

  const argsSummary = getArgsSummary(args);
  const { preview, extraLines } = formatArgs(args);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow" bold>
        Tool Approval Required
      </Text>
      <Box marginLeft={2} flexDirection="column">
        <Text>
          <Text color="cyan" bold>{toolName}</Text>
          {argsSummary && (
            <Text dimColor>({argsSummary})</Text>
          )}
        </Text>
        <Box marginLeft={2} flexDirection="column">
          <Text dimColor>{preview}</Text>
          {extraLines > 0 && (
            <Text color="gray">... +{extraLines} more lines</Text>
          )}
        </Box>
      </Box>
      <Box marginTop={1} marginLeft={2} flexDirection="row" gap={2}>
        {options.map((option, index) => (
          <Text
            key={option}
            color={selectedIndex === index ? "green" : "gray"}
            bold={selectedIndex === index}
          >
            {selectedIndex === index ? "› " : "  "}
            {option}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
```

---

#### File 18: The Token Usage Component (`src/ui/components/TokenUsage.tsx`)

Shows context window fullness as a percentage — green when safe, yellow when approaching limit, red when full.

```typescript
import React from "react";
import { Box, Text } from "ink";
import type { TokenUsageInfo } from "../../types.ts";

interface TokenUsageProps {
  usage: TokenUsageInfo | null;
}

export function TokenUsage({ usage }: TokenUsageProps) {
  if (!usage) {
    return null;
  }

  const thresholdPercent = Math.round(usage.threshold * 100);
  const usagePercent = usage.percentage.toFixed(1);

  let color: string = "green";
  if (usage.percentage >= usage.threshold * 100) {
    color = "red";
  } else if (usage.percentage >= usage.threshold * 100 * 0.75) {
    color = "yellow";
  }

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Text>
        Tokens:{" "}
        <Text color={color} bold>
          {usagePercent}%
        </Text>
        <Text dimColor> (threshold: {thresholdPercent}%)</Text>
      </Text>
    </Box>
  );
}
```

---

#### File 19: UI Barrel Export (`src/ui/index.tsx`)

Re-exports the App component and all UI components.

```typescript
export { App } from './App.tsx';
export { MessageList, type Message } from './components/MessageList.tsx';
export { ToolCall, type ToolCallProps } from './components/ToolCall.tsx';
export { Spinner } from './components/Spinner.tsx';
export { Input } from './components/Input.tsx';
```

---

#### File 20: The Main App Component (`src/ui/App.tsx`)

This is the main UI component — it manages all state, connects the agent loop to the display, and renders the component tree.

```typescript
import React, { useState, useCallback } from "react";
import { Box, Text, useApp } from "ink";
import type { ModelMessage } from "ai";
import { runAgent } from "../agent/run.ts";
import { MessageList, type Message } from "./components/MessageList.tsx";
import { ToolCall, type ToolCallProps } from "./components/ToolCall.tsx";
import { Spinner } from "./components/Spinner.tsx";
import { Input } from "./components/Input.tsx";
import { ToolApproval } from "./components/ToolApproval.tsx";
import { TokenUsage } from "./components/TokenUsage.tsx";
import type { ToolApprovalRequest, TokenUsageInfo } from "../types.ts";

interface ActiveToolCall extends ToolCallProps {
  id: string;
}

export function App() {
  const { exit } = useApp();
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

  const handleSubmit = useCallback(
    async (userInput: string) => {
      if (
        userInput.toLowerCase() === "exit" ||
        userInput.toLowerCase() === "quit"
      ) {
        exit();
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
    [conversationHistory, exit],
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="magenta">
          🤖 AI Agent
        </Text>
        <Text dimColor> (type "exit" to quit)</Text>
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
```

---

#### File 21: Entry Point (`src/index.ts`)

This is what runs when you type `npm start`. It renders the App component using Ink.

```typescript
import React from 'react';
import { render } from 'ink';
import { App } from './ui/index.tsx';

render(React.createElement(App));
```

---

### 0.7 Add Scripts to package.json

Open `package.json` and make sure it includes these settings:

```json
{
  "name": "my-ai-agent",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "tsx --env-file=.env src/index.ts",
    "dev": "tsx watch --env-file=.env src/index.ts"
  }
}
```

Two important settings:
- `"type": "module"` — tells Node.js to use ES module syntax (`import`/`export`)
- `--env-file=.env` — loads environment variables from `.env` automatically

---

### 0.8 Verify Your File Structure

Before running, verify everything is in place:

```
my-ai-agent/
├── .env
├── .gitignore
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── types.ts
    ├── agent/
    │   ├── run.ts
    │   ├── executeTools.ts
    │   ├── system/
    │   │   ├── prompt.ts
    │   │   └── filterMessages.ts
    │   ├── tools/
    │   │   ├── index.ts
    │   │   ├── dateTime.ts
    │   │   └── file.ts
    │   └── context/
    │       ├── index.ts
    │       ├── tokenEstimator.ts
    │       ├── modelLimits.ts
    │       └── compaction.ts
    └── ui/
        ├── index.tsx
        ├── App.tsx
        └── components/
            ├── Input.tsx
            ├── MessageList.tsx
            ├── Spinner.tsx
            ├── ToolCall.tsx
            ├── ToolApproval.tsx
            └── TokenUsage.tsx
```

That's 21 files total — not counting `package.json`, `tsconfig.json`, `.env`, and `.gitignore`.

---

### 0.9 Run the Agent

```bash
npm start
```

You should see:

```
🤖 AI Agent (type "exit" to quit)

>
```

Type a question and press Enter. Try these:

- `What time is it?` — the agent should call the `dateTime` tool
- `Read the package.json file` — calls the `readFile` tool
- `Write a file called hello.txt with "Hello, world!" in it` — calls `writeFile`

To quit, type `exit` and press Enter.

---

### 0.10 Development Mode

For development, use the watch command so the agent restarts automatically when you change a file:

```bash
npm run dev
```

---

### 0.11 What You've Built

You now have a working AI agent that can:
- Answer questions using an LLM (DeepSeek)
- Tell you the current time (tool: `dateTime`)
- Read files on your computer (tool: `readFile`)
- Write files (tool: `writeFile`)
- List directory contents (tool: `listFiles`)
- Delete files (tool: `deleteFile`)
- Stream responses token-by-token in the terminal
- Track token usage and warn when the context window is full
- Pause for human approval before running risky tools

The remaining chapters of this tutorial explain **how** each piece works, covering the architecture, the agent loop, tool design, context management, evals, and the Ink UI framework.

---

## Chapter 1: What Is an AI Agent?

In one sentence: **an AI agent is a program that can use tools.**

A regular chatbot:
```
You: "What's the time?"
Bot: "I don't know, I can't access a clock."
```

An AI agent:
```
You: "What's the time?"
Agent: [calls the dateTime tool] → "It's 2026-05-11T14:30:00.000Z."
```

The agent *doesn't know the answer itself*. It knows *which tool to call*, calls it, gets the result, and reports back. That's the core idea. Everything else — multiple tools, file operations, web search, shell commands, evaluations — is building on that foundation.

---

## Chapter 2: The Architecture at a Glance

```
src/
├── index.ts              ← Entry point (renders the UI)
├── cli.ts                ← CLI binary ("agi" command)
├── types.ts              ← Shared TypeScript types
├── agent/                ← The brain
│   ├── run.ts            ← Core agent loop
│   ├── executeTools.ts   ← Tool dispatcher
│   ├── tools/            ← Individual tool definitions
│   │   ├── index.ts
│   │   └── dateTime.ts
│   ├── system/           ← System prompt & message filtering
│   │   ├── prompt.ts
│   │   └── filterMessages.ts
│   └── context/          ← Token counting & compaction
│       ├── index.ts
│       ├── compaction.ts
│       ├── modelLimits.ts
│       └── tokenEstimator.ts
└── ui/                   ← Terminal UI (built with Ink/React)
    ├── index.tsx
    ├── App.tsx           ← Main app component
    └── components/       ← UI pieces
        ├── Input.tsx
        ├── MessageList.tsx
        ├── ToolCall.tsx
        ├── ToolApproval.tsx
        ├── Spinner.tsx
        └── TokenUsage.tsx
```

The flow:
```
User types → UI captures input → runAgent() → LLM decides tool/response →
executeTool() → result goes back to LLM → final answer → UI displays it
```

---

## Chapter 3: The Technology Stack

| Library | Purpose |
|---------|---------|
| `ai` (Vercel AI SDK) | Handles talking to AI models. Provides `generateText()` — you give it a prompt + tools, it returns text and tool calls |
| `@ai-sdk/deepseek` | Connects the AI SDK to DeepSeek's models |
| `zod` | Schema validation. Used to define what arguments each tool expects |
| `ink` | React for the terminal. Lets you build CLI apps with React components |
| `lmnr` (Laminar) | Telemetry/observability — traces what the agent does |
| `dotenv` | Loads `.env` file for API keys |

---

## Chapter 4: Step-by-Step Walkthrough

### Step 1 — The Simplest Possible Tool (`src/agent/tools/dateTime.ts`)

```typescript
export const dateTime = tool({
    description: "Returns the current time and date. Use this tool before any time related task",
    inputSchema: z.object({}),           // expects no arguments
    execute: async () => {
        return `The current date and time in ISO format is: ${new Date().toISOString()}`;
    }
})
```

Every tool has exactly three parts:
- **`description`**: tells the LLM *when* to use this tool
- **`inputSchema`**: defines what arguments the tool accepts (Zod schema)
- **`execute`**: the actual function that runs when called

This is the *only* tool implemented in the current codebase, but the architecture supports adding many more. `src/agent/tools/index.ts` collects all tools:

```typescript
export const tools = { dateTime };
```

Add more tools here, and they become available to the agent.

---

### Step 2 — How a Tool Gets Executed (`src/agent/executeTools.ts`)

```typescript
export const executeTool = async (name: ToolName, args: any) => {
    const tool = tools[name];
    if (!tool) return 'Unknown tool, this does not exists';
    const result = await tool.execute(args, { toolCallId: '', messages: [] });
    return String(result);
};
```

It's a simple lookup: the LLM says "call `dateTime` with args `{}`", and this function finds that tool, runs its `execute` function, and returns the result as a string.

---

### Step 3 — The Agent Loop (`src/agent/run.ts`)


```typescript
const { text, toolCalls } = await generateText({
    model: deepseek.chat(MODEL_NAME),
    prompt: userMessage,
    system: SYSTEM_PROMPT,
    tools,                    // ← the tools object from above
});
```

Here's what happens, step by step:

1. **User types a message** (e.g., "What time is it?")
2. **`runAgent()` calls `generateText()`** from the Vercel AI SDK
3. **The SDK sends to DeepSeek**: the system prompt, the user's message, and the list of available tools
4. **DeepSeek decides**: "I need to call the `dateTime` tool" — it returns `toolCalls: [{ toolName: 'dateTime', input: {} }]`
5. **Your code executes the tool**: `executeTool('dateTime', {})` → returns the current time
6. **The result goes back to the LLM**, which then generates a natural-language response like "The current time is..."

The SDK's `generateText()` handles the loop internally — it automatically feeds tool results back to the model until the model produces a final text response. You don't write the loop yourself; the SDK does it.

---

### Step 4 — The System Prompt (`src/agent/system/prompt.ts`)

```typescript
export const SYSTEM_PROMPT = `You are a helpful AI assistant. You provide clear, accurate, and concise responses to user questions.

Guidelines:
- Be direct and helpful
- If you don't know something, say so honestly
- Provide explanations when they add value
- Stay focused on the user's actual question`;
```

This is sent to the LLM at the start of every conversation. It sets the agent's personality and behavior rules. In a real agent, this might include instructions about which tools to prefer, safety rules, or output formatting requirements.

---

### Step 5 — The Terminal UI

The UI is built with **Ink** (React for the terminal). Let's trace what the user sees:

**`App.tsx`** is the main component. It manages state:
- `messages` — the conversation displayed on screen
- `streamingText` — text that's arriving token-by-token from the LLM
- `activeToolCalls` — tools currently being executed
- `tokenUsage` — how full the context window is
- `pendingApproval` — when a tool needs human approval before running

When you type and hit Enter:
1. Your message gets added to `messages`
2. `runAgent()` is called with callbacks for every event
3. As tokens arrive: `onToken` updates `streamingText` in real-time
4. When a tool is called: `onToolCallStart` shows a spinner
5. When a tool finishes: `onToolCallEnd` shows the result
6. When done: `onComplete` adds the final response to `messages`

**Component breakdown:**

- **`Input.tsx`** — captures keystrokes, builds the input string, handles Enter/Backspace
- **`MessageList.tsx`** — renders past messages (blue for user, green for assistant)
- **`ToolCall.tsx`** — shows a tool being called (⚡ icon, spinner while pending, ✓ when done)
- **`ToolApproval.tsx`** — asks "Approve this tool? Yes/No" for sensitive operations (HITL = Human In The Loop)
- **`Spinner.tsx`** — the "Thinking..." animation
- **`TokenUsage.tsx`** — shows context window fullness (green/yellow/red)

---

### Step 6 — Context Management (Token Budget)

LLMs have a limited "context window" — they can only "remember" so much conversation. This project tracks that.

**`tokenEstimator.ts`**: Since exact token counting requires the model's tokenizer, this uses an approximation:

```typescript
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.75);  // rough: ~3.75 chars per token
}
```

It also separates tokens into "input" (system, user, tool messages) and "output" (assistant messages).

**`modelLimits.ts`**: Defines context window sizes for different models and checks if usage exceeds a threshold (default 80%).

**`compaction.ts`**: When the conversation gets too long, this *summarizes* earlier messages into a shorter form — trading detail for token space.

---

### Step 7 — HITL (Human In The Loop)

Some tools are risky. You wouldn't want the agent to run `rm -rf /` without asking. The **approval system** works like this:

1. Before executing a high-risk tool, the agent calls `onToolApproval(name, args)`
2. This returns a **Promise** that doesn't resolve until the human answers
3. The UI shows a `ToolApproval` component with Yes/No options
4. The human picks, the Promise resolves, and the tool either runs or is skipped

In `App.tsx`:

```typescript
onToolApproval: (name, args) => {
    return new Promise<boolean>((resolve) => {
        setPendingApproval({ toolName: name, args, resolve });
    });
},
```

The `resolve` function is stored and called when the user presses Enter on Yes/No. This is a clean pattern — the agent loop *pauses* on a Promise, and the UI *unpauses* it.

---

### Step 8 — Message Filtering (`src/agent/system/filterMessages.ts`)

Not all message formats from tools are compatible with all LLM APIs. Some tools might return messages that DeepSeek (or whichever model) can't process. The filter keeps only clean, well-formed messages before sending history back to the API.

---

## Chapter 5: The Course Structure

The course is designed to be studied **lesson by lesson, forward**. Each lesson adds one concept:

| # | Lesson | What You Learn |
|---|--------|----------------|
| 1 | Intro to Agents | Basic agent structure, calling an LLM |
| 2 | Tool Calling | Defining tools, the `tool()` function, Zod schemas |
| 3 | Single Turn Evals | Testing one-shot agent responses |
| 4 | The Agent Loop | The `generateText` cycle, tool → result → response |
| 5 | Multi-turn Evals | Testing conversations across multiple turns |
| 6 | File System Tools | `read_file`, `write_file`, `list_dir` tools |
| 7 | Web Search + Context | Web search tool, token tracking, summarization |
| 8 | Shell Tool | Running shell commands as a tool |
| 9 | HITL | Human approval for sensitive operations |

---

## Chapter 6: The Eval System

Evaluations ("evals") are automated tests that verify your agent behaves correctly. Without evals, every change you make to a tool or the system prompt risks silently breaking the agent's behavior. The `evals/` directory implements a testing framework that asks: *"given this user prompt, did the agent pick the right tools?"*

### The Two Types of Evals

| Type | What it tests | Stops after |
|------|--------------|-------------|
| **Single-turn** | Does the LLM pick the correct tool(s) for a given prompt? | One LLM call (`stopWhen: stepCountIs(1)`) |
| **Multi-turn** | Does the agent execute multi-step tasks correctly across tool calls? | Configurable max steps (e.g., 5 or 10) |

A single-turn eval asks: *"User says 'Read package.json' — did the LLM select `readFile`?"*

A multi-turn eval asks: *"User says 'List src/ then read the entry point' — did the agent call `listFiles` first, then `readFile`, and produce a sensible final answer?"*

---

### 6.1 The Type System (`evals/types.ts`)

Every eval has two halves: **data** (the input scenario) and **target** (the expected outcome).

**For single-turn evals:**

```typescript
interface EvalData {
  prompt: string;            // "Read the contents of package.json"
  tools: string[];           // ["readFile", "writeFile", "listFiles"]
  systemPrompt?: string;
}

interface EvalTarget {
  expectedTools?: string[];  // Tools that MUST be selected
  forbiddenTools?: string[]; // Tools that MUST NOT be selected
  category: "golden" | "secondary" | "negative";
}
```

Three categories of test:
- **`golden`**: The agent MUST use specific tools. High-confidence, deterministic expectation. Example: "Read package.json" → must use `readFile`.
- **`secondary`**: The agent will *likely* use certain tools, but ambiguity is acceptable. Scored differently (softer). Example: "Show me around the project" → probably `listFiles`, maybe also `readFile`.
- **`negative`**: The agent MUST NOT use any listed tools. These test that the agent doesn't over-call tools for general-knowledge questions. Example: "What is the capital of France?" → forbidden to use file tools.

**For multi-turn evals**, the data includes mock tools (fixed return values for deterministic testing) and the target includes expected tool *ordering*:

```typescript
interface MultiTurnTarget {
  expectedToolOrder?: string[];   // ["listFiles", "readFile"]
  forbiddenTools?: string[];
  mockToolResults: Record<string, string>;  // What each tool returns
  category: "task-completion" | "conversation-continuation" | "negative";
}
```

Multi-turn categories:
- **`task-completion`**: Fresh conversation, user gives a complete task.
- **`conversation-continuation`**: Mid-conversation context — pre-filled `messages` simulate an ongoing chat.
- **`negative`**: The agent should avoid certain tools (e.g., use `listFiles` instead of `shell ls`).

---

### 6.2 The Executor (`evals/executors.ts`)

The executor is the function that actually *runs* the LLM call for an eval. It's deliberately simple — it builds mock tools from definitions, calls `generateText()`, and returns what happened.

```typescript
export const singleTurnExecutorWithMocks = async (data: EvalData) => {
  // Build tools from TOOL_DEFINITIONS registry
  const tools: ToolSet = {};
  for (const toolName of data.tools) {
    const def = TOOL_DEFINITIONS[toolName];
    tools[toolName] = tool({
      description: def.description,
      inputSchema: zodSchema(def.parameters),
      // No execute function — we only care about selection, not execution
    });
  }

  const { toolCalls } = await generateText({
    model: deepseek.chat("deepseek-v4-pro"),
    system: systemMessage,
    messages: userMessages,
    tools,
    stopWhen: stepCountIs(1),  // ← CRITICAL: only one LLM call
  });

  return {
    toolCalls,           // Full tool call objects with args
    toolNames,           // Just the tool name strings
    selectedAny: toolCalls.length > 0,
  };
};
```

The key decisions here:
- **`stopWhen: stepCountIs(1)`** — prevents the agent loop from continuing. We only want one decision, not a full conversation.
- **No `execute` function** — the tools have schemas and descriptions, but no implementation. We're testing *selection*, not *execution*.
- **Tool registry** — `TOOL_DEFINITIONS` is a lookup table of tool metadata (description + Zod schema). The executor creates live tool objects from this registry dynamically.

---

### 6.3 The Evaluator (`evals/evaluators.ts`)

Once the executor returns results, the evaluator scores them against the target.

```typescript
export function toolSelectionScore(
  output: SingleTurnResult,
  target: EvalTarget,
): number {
  const expected = new Set(target.expectedTools);
  const selected = new Set(output.toolNames);

  const hits = output.toolNames.filter((t) => expected.has(t)).length;
  const precision = selected.size > 0 ? hits / selected.size : 0;
  const recall = expected.size > 0 ? hits / expected.size : 0;

  // F1 score: harmonic mean of precision and recall
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}
```

This uses the **F1 score** (harmonic mean of precision and recall):

- **Precision**: "Of the tools the agent selected, how many were correct?" (Was it over-selecting?)
- **Recall**: "Of the tools we expected, how many did the agent select?" (Was it missing tools?)
- **F1**: balances both. A perfect score is 1.0.

For example, if the expected tool is `["readFile"]` and the agent selects `["readFile", "writeFile"]`:
- Precision = 1/2 = 0.5 (half its selections were wrong)
- Recall = 1/1 = 1.0 (it found the right one)
- F1 = 2 × 0.5 × 1.0 / (0.5 + 1.0) = 0.67

For **negative** prompts (where no tools should be selected), the eval file uses a custom evaluator that returns 1.0 (perfect) if forbidden tools are absent, and 0 otherwise.

---

### 6.4 The Datasets (`evals/data/*.json`)

Real test data — these JSON files define what to test. An example from `file-tools.json`:

```json
{
  "data": {
    "prompt": "Read the contents of package.json",
    "tools": ["readFile", "writeFile", "listFiles", "deleteFile"]
  },
  "target": {
    "expectedTools": ["readFile"],
    "category": "golden"
  },
  "metadata": {
    "description": "Direct file read request - should use readFile"
  }
}
```

And a negative test:

```json
{
  "data": {
    "prompt": "What is the capital of France?",
    "tools": ["readFile", "writeFile", "listFiles", "deleteFile"]
  },
  "target": {
    "forbiddenTools": ["readFile", "writeFile", "listFiles", "deleteFile"],
    "category": "negative"
  }
}
```

The `shell-tools.json` dataset follows the same pattern for the `runCommand` tool. The `agent-multiturn.json` dataset tests multi-step scenarios — for example, verifying that an agent asked to "list files then read the entry point" calls `listFiles` *before* `readFile`.

---

### 6.5 Wiring It Together (`evals/file-tool.eval.ts`)

The eval file connects everything into a single runnable test suite:

```typescript
import { evaluate } from "@lmnr-ai/lmnr";
import dataSet from "./data/file-tools.json" with { type: "json" };
import { singleTurnExecutorWithMocks } from './executors.ts';
import { toolSelectionScore } from "./evaluators.ts";

evaluate({
  data: dataSet,
  executor: async (data) => await singleTurnExecutorWithMocks(data),
  evaluators: {
    selectionScore: (output, target) => {
      if (target?.category === 'secondary') return 1;     // skip scoring secondary
      return toolSelectionScore(output, target);
    }
  }
});
```

The `evaluate()` function from Laminar (`@lmnr-ai/lmnr`) iterates over every entry in the dataset:
1. Calls `executor(data)` — runs the LLM
2. Calls `evaluators.selectionScore(output, target)` — scores the result
3. Aggregates scores across all entries

Run it with:
```bash
npm run eval:file-tools    # npx lmnr eval evals/file-tools.eval.ts
npm run eval:shell-tools   # npx lmnr eval evals/shell-tools.eval.ts
npm run eval:agent         # npx lmnr eval evals/agent-multiturn.eval.ts
```

---

### 6.6 Mock Tools (`evals/mocks/tools.ts`)

For multi-turn evals, you don't want the agent to actually read real files or run real shell commands — that would be non-deterministic and dangerous. Mock tools return fixed values:

```typescript
export const createMockReadFile = (mockContent: string) =>
  tool({
    description: "Read the contents of a file at the specified path...",
    inputSchema: z.object({ path: z.string() }),
    execute: async ({ path }) => mockContent,  // Always returns the same string
  });
```

Each mock factory takes a fixed return value and wraps it in a compliant tool object. The mock tools are used in multi-turn dataset entries via `mockTools` and `mockToolResults` fields — the dataset defines both the tool's behavior and the expected output.

---

### 6.7 The Eval Mental Model

```
┌─────────────────────────────────────────────────────┐
│                    EVAL PIPELINE                      │
│                                                       │
│  Dataset (JSON)                                       │
│  ┌──────────────────────────────────────────┐        │
│  │ { prompt, tools, expectedTools, category }│        │
│  └──────────────────┬───────────────────────┘        │
│                     │                                  │
│                     ▼                                  │
│  Executor (LLM call)                                  │
│  ┌──────────────────────────────────────────┐        │
│  │ generateText({ tools, stopWhen: 1 })     │        │
│  │ → { toolCalls: [...] }                   │        │
│  └──────────────────┬───────────────────────┘        │
│                     │                                  │
│                     ▼                                  │
│  Evaluator (scoring)                                  │
│  ┌──────────────────────────────────────────┐        │
│  │ toolSelectionScore(output, target)        │        │
│  │ → score between 0.0 and 1.0              │        │
│  └──────────────────┬───────────────────────┘        │
│                     │                                  │
│                     ▼                                  │
│  Aggregator (Laminar evaluate())                      │
│  ┌──────────────────────────────────────────┐        │
│  │ Average score across all dataset entries  │        │
│  │ Report: pass/fail per entry               │        │
│  └──────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────┘
```

The eval system is **orthogonal** to the agent — it uses the same `generateText()` function and `tool()` definitions, but with mock implementations and a scoring layer. This means you can change the agent's tools or prompt and immediately see if anything broke.

---

## Chapter 7: How Ink Works (Terminal UI Framework)

Ink is a library that lets you write terminal UIs using React — components, state, hooks, the whole model — rendered to the terminal instead of a browser DOM.

### 7.1 The Core Idea: React → Terminal

In a browser, React renders to the DOM:
```
React Component → Virtual DOM → Real DOM → Browser pixels
```

In Ink, React renders to the terminal:
```
React Component → Virtual DOM → Terminal output (ANSI strings)
```

Ink provides its own set of "host" components that map to terminal concepts:
- `<Box>` → a flexbox container (layout)
- `<Text>` → styled text (colors, bold, dim)
- `useInput()` → keyboard event hook
- `useApp()` → app-level actions like `exit()`

Everything else — state management, hooks, component lifecycles — is standard React.

---

### 7.2 The Component Tree

Trace the full component hierarchy from entry to leaves:

```
render(React.createElement(App))
  └── <App>                          ← manages all agent state
        ├── <Text>                   ← "🤖 AI Agent" header
        ├── <MessageList>            ← displays chat history
        │     └── <Box> × N          ← one per message
        │           ├── <Text>       ← role label ("› You" / "› Assistant")
        │           └── <Text>       ← message content
        ├── <Text>                   ← streaming response (token by token)
        ├── <ToolCall> × N           ← active tool invocations
        │     ├── <Text> + <InkSpinner>  ← ⚡ toolName (spinner if pending)
        │     └── <Text>             ← tool result (when complete)
        ├── <ToolApproval>           ← HITL approval prompt
        │     ├── <Text>             ← "Tool Approval Required"
        │     └── <Text> × 2         ← "› Yes" / "  No" selector
        ├── <Spinner>                ← "Thinking..." when waiting
        │     └── <InkSpinner> + <Text>
        ├── <Input>                  ← captures keystrokes
        │     └── <Text>             ← "> " + user's typed text
        └── <TokenUsage>             ← context window indicator
              └── <Box borderStyle="single">
                    └── <Text>       ← "Tokens: 45.2% (threshold: 80%)"
```

---

### 7.3 State Architecture (`App.tsx`)

The App component holds six pieces of state:

```typescript
const [messages, setMessages] = useState<Message[]>([]);
// Chat history: [{ role: "user", content: "hi" }, { role: "assistant", content: "..." }]

const [conversationHistory, setConversationHistory] = useState<ModelMessage[]>([]);
// Raw messages for the LLM API (includes tool messages, system prompt)

const [isLoading, setIsLoading] = useState(false);
// Whether the agent is currently processing

const [streamingText, setStreamingText] = useState("");
// Text arriving token-by-token from the LLM (shown in real-time)

const [activeToolCalls, setActiveToolCalls] = useState<ActiveToolCall[]>([]);
// Tools currently being executed (shown with spinners)

const [pendingApproval, setPendingApproval] = useState<ToolApprovalRequest | null>(null);
// When non-null, blocks input and shows approval prompt

const [tokenUsage, setTokenUsage] = useState<TokenUsageInfo | null>(null);
// Context window usage stats (shown in footer)
```

These states control what's visible at any moment:

| State combination | What the user sees |
|---|---|
| `isLoading && !streamingText && activeToolCalls.length === 0` | Spinner ("Thinking...") |
| `streamingText !== ""` | Live token stream |
| `activeToolCalls.length > 0` | Tool list with spinners/checkmarks |
| `pendingApproval !== null` | Approval prompt, input disabled |
| `!isLoading && messages.length > 0` | Message history |
| Always (if `tokenUsage` set) | Token usage bar |

---

### 7.4 The Input Component

```typescript
export function Input({ onSubmit, disabled }: InputProps) {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (disabled) return;

    if (key.return) {                    // Enter pressed
      if (value.trim()) {
        onSubmit(value);                 // Fire the callback
        setValue('');                    // Clear input
      }
      return;
    }

    if (key.backspace || key.delete) {   // Backspace
      setValue((prev) => prev.slice(0, -1));
      return;
    }

    if (input && !key.ctrl && !key.meta) { // Regular character
      setValue((prev) => prev + input);
    }
  });

  return (
    <Box>
      <Text color="blue" bold>{'> '}</Text>
      <Text>{value}</Text>
      {!disabled && <Text color="gray">▌</Text>}  {/* Blinking cursor */}
    </Box>
  );
}
```

`useInput()` is Ink's keyboard hook. It fires on every keystroke and gives you:
- `input`: the character typed (empty string for special keys)
- `key`: an object with booleans like `key.return`, `key.backspace`, `key.ctrl`, `key.meta`

The component builds the input string character by character in local state, then fires `onSubmit` when Enter is pressed. The `disabled` prop blocks input during loading or approval.

---

### 7.5 The ToolCall Component

```typescript
export function ToolCall({ name, status, result }: ToolCallProps) {
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box>
        <Text color="yellow">⚡ </Text>
        <Text color="yellow" bold>{name}</Text>
        {status === 'pending' ? (
          <Text> <InkSpinner type="dots" /></Text>
        ) : (
          <Text color="green"> ✓</Text>
        )}
      </Box>
      {status === 'complete' && result && (
        <Box marginLeft={2}>
          <Text dimColor>→ {result.slice(0, 100)}...</Text>
        </Box>
      )}
    </Box>
  );
}
```

Two states:
- **`pending`**: Shows ⚡ toolName with an animated spinner — the tool is running
- **`complete`**: Shows ⚡ toolName ✓ with the result (truncated to 100 chars)

The `InkSpinner` component from the `ink-spinner` package renders animated dots (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏) using ANSI escape codes in the terminal.

---

### 7.6 The ToolApproval Component

This handles the HITL (Human In The Loop) flow at the UI level:

```typescript
export function ToolApproval({ toolName, args, onResolve }: ToolApprovalProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);  // 0 = Yes, 1 = No

  useInput((input, key) => {
    if (key.upArrow || key.downArrow) {
      setSelectedIndex((prev) => (prev === 0 ? 1 : 0));   // Toggle 0↔1
    }
    if (key.return) {
      onResolve(selectedIndex === 0);  // Pass boolean to the Promise resolver
    }
  }, { isActive: true });

  const argsSummary = getArgsSummary(args);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow" bold>Tool Approval Required</Text>
      <Text>
        <Text color="cyan" bold>{toolName}</Text>
        <Text dimColor>({argsSummary})</Text>
      </Text>
      <Box flexDirection="row" gap={2}>
        <Text color={selectedIndex === 0 ? "green" : "gray"}>
          {selectedIndex === 0 ? "› " : "  "}Yes
        </Text>
        <Text color={selectedIndex === 1 ? "green" : "gray"}>
          {selectedIndex === 1 ? "› " : "  "}No
        </Text>
      </Box>
    </Box>
  );
}
```

Key details:
- **`{ isActive: true }`** — this `useInput` listener takes priority over the Input component's listener. When approval is pending, the main input is disabled.
- **`getArgsSummary(args)`** — extracts a preview of the tool arguments (e.g., the file path or command string) so the user can quickly assess risk without reading raw JSON.
- **`formatArgs(args)`** — truncates long JSON to 5 lines with a "+N more lines" indicator.
- The `onResolve(boolean)` call directly resolves the Promise that `onToolApproval` created — this is how the UI unblocks the agent loop.

---

### 7.7 The Data Flow: Callbacks Layer

The bridge between the Agent (backend) and the UI (frontend) is the `AgentCallbacks` interface:

```typescript
interface AgentCallbacks {
  onToken?: (token: string) => void;                         // Streaming
  onToolCallStart?: (name: string, args: unknown) => void;   // Tool started
  onToolCallEnd?: (name: string, result: string) => void;    // Tool finished
  onComplete?: (response: string) => void;                   // Done
  onToolApproval?: (name: string, args: unknown) => Promise<boolean>; // HITL
  onTokenUsage?: (usage: TokenUsageInfo) => void;            // Context stats
}
```

Each callback updates a specific piece of state in App, which triggers React re-renders:

```
Agent loop             Callback              State update            UI effect
──────────             ────────              ────────────            ─────────
LLM emits token   →    onToken         →    setStreamingText    →    Text updates live
Tool starts       →    onToolCallStart →    setActiveToolCalls  →    Spinner appears
Tool finishes     →    onToolCallEnd   →    setActiveToolCalls  →    ✓ + result shown
Agent done        →    onComplete      →    setMessages         →    Message added to history
Tool needs OK     →    onToolApproval  →    setPendingApproval  →    Approval prompt shown
Usage updated     →    onTokenUsage    →    setTokenUsage       →    Usage bar updates
```

This is a clean separation: the agent code (`run.ts`) has no knowledge of React or Ink. It just calls callbacks. The UI code has no knowledge of LLMs or tools. It just reacts to state changes.

---

### 7.8 Ink-Specific Patterns

**Flexbox layout**: Ink's `<Box>` component uses Yoga (the same layout engine as React Native). You get:
- `flexDirection="column"` — vertical stacking (default is row)
- `gap={1}` — spacing between children
- `marginLeft={2}` — indentation for nested content
- `padding={1}` — inner spacing around the box
- `borderStyle="single"` — draws a single-line border

**Color system**: Ink supports basic terminal colors via named props:
```typescript
<Text color="green">success</Text>
<Text color="yellow" bold>warning</Text>
<Text dimColor>subtle text</Text>
<Text color="cyan"><InkSpinner type="dots" /></Text>
```

**No CSS, no className** — all styling is done via props. This keeps the component surface small and predictable.

**Exit**: `const { exit } = useApp()` gives you a function to cleanly terminate the process.

---

## Chapter 8: How to Learn From This Codebase

Recommendation for first-time readers:

1. **Start with Lesson 4 (The Agent Loop)** — it's the core. Read `run.ts` carefully. Understand that `generateText()` is doing the heavy lifting of the tool-calling loop.

2. **Then Lesson 2 (Tool Calling)** — read `dateTime.ts` and `executeTools.ts`. Understand the `tool()` function pattern.

3. **Then Lessons 6–9** — the tools and safety patterns. These are variations on the same pattern: define a tool, add it to `tools/index.ts`, wire up approval if needed.

4. **Context management (Lesson 7)** — understand how token counting and compaction keep the agent from running out of memory.

5. **The UI** — once you understand the agent logic, the Ink/React UI is just a display layer with callbacks.

The `notes/` directory contains lecture notes for each lesson. The `evals/` directory contains automated tests (evaluations). But stick to the source code first — it's the ground truth.

---

## Summary: The Mental Model

```
┌─────────────────────────────────────────────┐
│                   THE AGENT                  │
│                                              │
│  User: "What time is it?"                    │
│           │                                   │
│           ▼                                   │
│  ┌─────────────────┐                         │
│  │   runAgent()     │  sends prompt + tools   │
│  │                  │ ──────────────────────► │
│  │  generateText()  │                         │  DeepSeek
│  │                  │ ◄────────────────────── │  (or any LLM)
│  │  "call dateTime" │   returns tool call     │
│  └────────┬────────┘                         │
│           │                                   │
│           ▼                                   │
│  ┌─────────────────┐                         │
│  │  executeTool()   │  runs dateTime.execute()│
│  │  "2026-05-11T..."│                         │
│  └────────┬────────┘                         │
│           │                                   │
│           ▼                                   │
│  Feed result back to LLM → it writes answer   │
│                                              │
│  Agent: "It's 2:30 PM on May 11, 2026."      │
└─────────────────────────────────────────────┘
```

The agent is a **router**: it doesn't *know* answers, it *routes* questions to tools that do. The LLM is the decision-maker; your code is the executor. That's the whole game.
