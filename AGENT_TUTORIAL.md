# Build an AI Agent from Scratch — with Local LLM

A step-by-step tutorial for building a general-purpose AI agent in TypeScript, powered by
**Gemma 4** running locally via **LM Studio** (no cloud API keys required).

---

## What We're Building

By the end of this tutorial you will have built:

- A terminal-based AI agent CLI (`npx agi`)
- File-system tools (read, write, list, delete)
- A multi-turn agent loop that streams tokens and executes tools
- Context-window management (token estimation, compaction)
- A comprehensive evaluation suite (single-turn + multi-turn)
- Human-in-the-loop approval for sensitive operations
- Everything wired to a **local Gemma 4 model** on LM Studio

---

## Why Local?

Running an LLM locally gives you:

- **Zero API cost** — iterate as much as you want
- **Privacy** — your code and data never leave your laptop
- **Offline capability** — no internet required
- **Full control** — choose model quantisation, context length, temperature

LM Studio exposes an OpenAI-compatible HTTP API at `http://localhost:1234/v1`.
The Vercel AI SDK supports any OpenAI-compatible endpoint through `@ai-sdk/openai-compatible`,
so swapping DeepSeek for a local model is a one-file change.

---

## Prerequisites

- Node.js 20+ and TypeScript 5+
- [LM Studio](https://lmstudio.ai/) installed
- A Gemma model loaded in LM Studio (e.g. `gemma-3-4b-it` or `gemma-3-12b-it`)
- Comfortable with TypeScript, async/await, and the terminal

---

## Project Setup

Start with a clean Node project:

```bash
mkdir ai-agent && cd ai-agent
npm init -y
```

Install dependencies:

```bash
npm install ai zod @ai-sdk/openai-compatible dotenv
npm install -D typescript tsx @types/node
```

Note the difference from the original codebase:

| Original (DeepSeek) | Tutorial (LM Studio) |
|---|---|
| `@ai-sdk/deepseek` | `@ai-sdk/openai-compatible` |
| `createDeepSeek({ apiKey })` | `createOpenAICompatible({ baseURL })` |
| `deepseek.chat('deepseek-v4-pro')` | `lmstudio.chat('gemma-3-4b-it')` |

Create `tsconfig.json`:

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

Create the directory structure we'll fill in across the lessons:

```
src/
  agent/
    tools/
    system/
    context/
  ui/
    components/
evals/
  data/
  mocks/
```

---

## Lesson 1: The LLM Provider Layer

### Architecture Decision

We wrap the LLM provider in a dedicated module so every other part of the codebase calls
`getModel()` instead of importing a specific SDK directly. This makes it trivial to swap
providers, mock the model in tests, or add fallback logic.

### Code: `src/agent/model.ts`

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

// LM Studio runs at http://localhost:1234/v1 by default
const LMSTUDIO_BASE_URL = 'http://localhost:1234/v1';

const lmstudio = createOpenAICompatible({
  name: 'lmstudio',
  baseURL: LMSTUDIO_BASE_URL,
  // LM Studio does not require an API key, but the SDK expects one.
  // Pass a dummy value.
  apiKey: 'lm-studio-no-key',
});

// Change this to match the model loaded in LM Studio
const MODEL_NAME = 'gemma-3-4b-it';

export function getModel() {
  return lmstudio.chat(MODEL_NAME);
}
```

**What's happening:**

- `createOpenAICompatible` tells the Vercel AI SDK "talk to an OpenAI-shaped API at this URL".
- `baseURL` points at LM Studio's local server.
- LM Studio doesn't require auth, but the SDK still wants an `apiKey` field — any string works.
- `getModel()` returns a model instance that every other module can use.

**Sanity check:** Start LM Studio, load Gemma 4, then run:

```typescript
// src/smoke-test.ts
import { generateText } from 'ai';
import { getModel } from './agent/model.ts';

const { text } = await generateText({
  model: getModel(),
  prompt: 'Say hello in one sentence.',
});
console.log(text);
```

```bash
npx tsx src/smoke-test.ts
```

You should see a response from the local model.

---

## Lesson 2: The System Prompt

Every LLM call passes a system prompt that sets the tone and constraints.
Keep it simple — you can tune it later.

### Code: `src/agent/system/prompt.ts`

```typescript
export const SYSTEM_PROMPT = `You are a helpful AI assistant. You provide clear,
accurate, and concise responses to user questions.

Guidelines:
- Be direct and helpful
- If you don't know something, say so honestly
- Provide explanations when they add value
- Stay focused on the user's actual question`;
```

This file is referenced by both the agent loop and the eval executors.
Keeping it in one place means a single edit updates behavior everywhere.

---

## Lesson 3: Tool Definitions (No Execution Yet)

Tools are how the agent acts on the world. The Vercel AI SDK has a `tool()` helper
that takes a description, a Zod schema, and an `execute` function.

We'll define four file-system tools. For now, **only the schema and description** —
the execute functions come in Lesson 5.

### Code: `src/agent/tools/file.ts`

```typescript
import { tool } from 'ai';
import { z } from 'zod';

export const readFile = tool({
  description:
    'Read the full content of a file at a given path. Always use this to read a file.',
  inputSchema: z.object({
    path: z.string().describe('The absolute or relative path to the file to read'),
  }),
  // execute function added later
});

export const writeFile = tool({
  description:
    'Write content to a file at a specified path. Creates the file if it does not exist, overwrites if it does.',
  inputSchema: z.object({
    path: z.string().describe('The absolute or relative path to the file to write'),
    content: z.string().describe('The content to write to the file'),
  }),
});

export const listFiles = tool({
  description:
    'List all files and directories in the specified directory path.',
  inputSchema: z.object({
    directory: z.string().describe('The directory path to list').default('.'),
  }),
});

export const deleteFile = tool({
  description:
    'Delete a file at the specified path. Use with caution — this is irreversible.',
  inputSchema: z.object({
    path: z.string().describe('The absolute or relative path to the file to delete'),
  }),
});
```

### Code: `src/agent/tools/index.ts`

```typescript
import { readFile, writeFile, listFiles, deleteFile } from './file.ts';

export const tools = {
  readFile,
  writeFile,
  listFiles,
  deleteFile,
};
```

### Why separate schemas from execution?

The LLM only needs descriptions and parameter schemas to decide *which* tool to call.
The `execute` function runs locally on *our* machine. Sending the execute function to
the API would be pointless (and impossible — it's a function, not serialisable JSON).

In the agent loop we strip the `execute` key before passing tools to the model:

```typescript
const toolsWithoutExecute = Object.fromEntries(
  Object.entries(tools).map(([name, t]) => {
    const { execute, ...rest } = t;
    return [name, rest];
  }),
);
```

---

## Lesson 4: The Agent Loop

The agent loop is the heart of the system. Here's the algorithm:

```
1. Build messages array: [system, ...history, user]
2. Stream the LLM response
3. Collect text tokens → display in real time
4. Collect tool-call tokens → queue for execution
5. When streaming ends:
   a. If the finish reason is "stop" and no tool calls → done
   b. If there are tool calls → execute each one, append results to messages
   c. Go to step 2 (another iteration)
6. Return the full conversation history
```

### Types First: `src/types.ts`

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

export interface TokenUsageInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextWindow: number;
  threshold: number;
  percentage: number;
}
```

### The Agent Loop: `src/agent/run.ts`

```typescript
import { streamText, type ModelMessage } from 'ai';
import { getModel } from './model.ts';
import { SYSTEM_PROMPT } from './system/prompt.ts';
import { tools } from './tools/index.ts';
import type { AgentCallbacks, ToolCallInfo } from '../types.ts';
import { executeTool, type ToolName } from './executeTools.ts';
import { filterCompatibleMessages } from './system/filterMessages.ts';

export const runAgent = async (
  userMessage: string,
  conversationHistory: ModelMessage[],
  callbacks: AgentCallbacks,
): Promise<ModelMessage[]> => {
  // Filter history to only include compatible message formats
  const workingHistory = filterCompatibleMessages(conversationHistory);

  const messages: ModelMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...workingHistory,
    { role: 'user', content: userMessage },
  ];

  let fullResponse = '';

  // Strip execute functions — the LLM only needs schemas
  const toolsWithoutExecute = Object.fromEntries(
    Object.entries(tools).map(([name, t]) => {
      const { execute, ...rest } = t;
      return [name, rest];
    }),
  );

  while (true) {
    const result = streamText({
      model: getModel(),                          // ← local Gemma via LM Studio
      messages,
      tools: toolsWithoutExecute,
    });

    const toolCalls: ToolCallInfo[] = [];
    let currentText = '';
    let streamError: Error | null = null;

    // --- Phase 1: Stream tokens ---
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
            args: input as any,
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

    // --- Phase 2: Handle errors ---
    if (streamError && !currentText && toolCalls.length === 0) {
      fullResponse = 'Sorry, something went wrong. Please try again.';
      callbacks?.onToken?.(fullResponse);
      break;
    }

    if (streamError) {
      // Partial response case: push what we have
      const assistantMessage: any = {
        role: 'assistant',
        content: [{ type: 'text', text: currentText }],
      };
      messages.push(assistantMessage);
      if (toolCalls.length === 0) break;
    } else {
      const finishReason = await result.finishReason;

      // No tool calls → done
      if (finishReason !== 'tool-calls' || toolCalls.length === 0) {
        const responseMessages = await result.response;
        messages.push(...responseMessages.messages);
        break;
      }

      const responseMessages = await result.response;
      messages.push(...responseMessages.messages);
    }

    // --- Phase 3: Execute tools ---
    for (const tc of toolCalls) {
      const toolResult = await executeTool(tc.toolName as ToolName, tc.args);
      callbacks?.onToolCallEnd?.(tc.toolName, toolResult);

      messages.push({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            output: { type: 'text', value: toolResult },
          },
        ],
      });
    }

    // If we had a stream error but tools ran, provide a placeholder
    if (streamError && toolCalls.length > 0 && !currentText) {
      fullResponse = `[Tool execution completed. ${toolCalls.length} result(s) available.]`;
      callbacks?.onToken?.(fullResponse);
    }
  }

  callbacks?.onComplete?.(fullResponse);
  return messages;
};
```

### Tool Executor: `src/agent/executeTools.ts`

```typescript
import { tools } from './tools/index.ts';

export type ToolName = keyof typeof tools;

export const executeTool = async (name: ToolName, args: any) => {
  const tool = tools[name];
  if (!tool) {
    return 'Unknown tool — this tool does not exist.';
  }

  const result = await tool.execute(args, {
    toolCallId: '',
    messages: [],
  });

  return String(result);
};
```

### Message Filter: `src/agent/system/filterMessages.ts`

Not all message formats play nicely when passed back to the API. This filter keeps
only compatible messages — discarding anything that would cause a 400 error.

```typescript
import type { ModelMessage } from 'ai';

export const filterCompatibleMessages = (
  messages: ModelMessage[],
): ModelMessage[] => {
  return messages.filter((msg) => {
    if (msg.role === 'user' || msg.role === 'system') return true;

    if (msg.role === 'assistant') {
      const content = msg.content;
      if (typeof content === 'string' && content.trim()) return true;
      if (Array.isArray(content)) {
        return content.some((part: unknown) => {
          if (typeof part === 'string' && part.trim()) return true;
          if (typeof part === 'object' && part !== null && 'text' in part) {
            const textPart = part as { text?: string };
            return textPart.text && textPart.text.trim();
          }
          return false;
        });
      }
    }

    if (msg.role === 'tool') return true;

    return false;
  });
};
```

### Key Design Decisions

1. **Error resilience**: The agent doesn't crash on stream errors. If the LLM produces
   partial output, that partial output is still added to the conversation and tool calls
   are still executed.

2. **Infinite loop safety**: The loop terminates when `finishReason` is not `'tool-calls'`,
   meaning the model decided it's done. The SDK's step-count limit could also be added.

3. **Callback-driven**: The agent loop fires callbacks for every event (token, tool start,
   tool end, complete). This decouples the loop from the UI — the same loop works with
   a terminal UI, a web UI, or a headless eval runner.

---

## Lesson 5: File-System Tool Implementations

Now we fill in the `execute` functions for the four file tools.

### Code: Add to `src/agent/tools/file.ts`

Replace the stub tools with full implementations:

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import fs from 'node:fs/promises';
import nodePath from 'node:path';

export const readFile = tool({
  description:
    'Read the full content of a file at a given path. Always use this to read a file.',
  inputSchema: z.object({
    path: z.string().describe('The absolute or relative path to the file to read'),
  }),
  execute: async ({ path }) => {
    try {
      const content = await fs.readFile(path, 'utf8');
      return content;
    } catch (e) {
      return `Error reading file at ${path}: ${e}`;
    }
  },
});

export const writeFile = tool({
  description:
    'Write content to a file at a specified path. Creates the file if it does not exist, overwrites if it does.',
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
      return `Failed to write to ${path}: ${e}`;
    }
  },
});

export const listFiles = tool({
  description:
    'List all files and directories in the specified directory path.',
  inputSchema: z.object({
    directory: z.string().describe('The directory path to list').default('.'),
  }),
  execute: async ({ directory }) => {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      const items = entries.map((entry) => {
        const type = entry.isDirectory() ? '[dir]' : '[file]';
        return `${type} ${entry.name}`;
      });
      return items.length > 0
        ? `Contents of ${directory}:\n${items.sort().join('\n')}`
        : `Directory ${directory} is empty.`;
    } catch (e) {
      return `Error listing ${directory}: ${e}`;
    }
  },
});

export const deleteFile = tool({
  description:
    'Delete a file at the specified path. Use with caution — this is irreversible.',
  inputSchema: z.object({
    path: z.string().describe('The absolute or relative path to the file to delete'),
  }),
  execute: async ({ path }) => {
    try {
      await fs.unlink(path);
      return `Successfully deleted ${path}`;
    } catch (e) {
      return `Error deleting ${path}: ${e}`;
    }
  },
});
```

### Design notes

- All tools return **structured plain text** — the LLM reads tool output as text,
  so format it to be easily parseable.
- `writeFile` creates intermediate directories with `recursive: true`.
- Errors are returned as strings rather than thrown — throwing would crash the loop;
  returning the error lets the LLM see what went wrong and try a different approach.

---

## Lesson 6: Context Management

LLMs have finite context windows. Gemma 4 models typically support 8K–128K tokens
depending on the variant. When conversation history grows too large, we need to:

1. **Estimate** how many tokens we're using
2. **Detect** when we're near the limit
3. **Compact** (summarise) the conversation to stay under the limit

### Token Estimator: `src/agent/context/tokenEstimator.ts`

Since we don't have access to the model's actual tokeniser, we approximate:
**1 token ≈ 3.75 characters** (empirically sound for English text).

```typescript
import type { ModelMessage } from 'ai';

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.75);
}

export function extractMessageText(message: ModelMessage): string {
  if (typeof message.content === 'string') return message.content;

  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part === 'string') return part;
        if ('text' in part && typeof part.text === 'string') return part.text;
        if ('value' in part && typeof part.value === 'string') return part.value;
        if ('output' in part && typeof part.output === 'object' && part.output) {
          const output = part.output as Record<string, unknown>;
          if ('value' in output && typeof output.value === 'string')
            return output.value;
        }
        return JSON.stringify(part);
      })
      .join(' ');
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

    if (message.role === 'assistant') {
      output += tokens;
    } else {
      input += tokens;
    }
  }

  return { input, output, total: input + output };
}
```

### Model Limits: `src/agent/context/modelLimits.ts`

```typescript
export const DEFAULT_THRESHOLD = 0.8;

const MODEL_LIMITS: Record<string, { inputLimit: number; outputLimit: number; contextWindow: number }> = {
  // Gemma 3 4B: 8192 context (conservative)
  'gemma-3-4b-it': {
    inputLimit: 7168,
    outputLimit: 1024,
    contextWindow: 8192,
  },
  // Gemma 3 12B: 32768 context
  'gemma-3-12b-it': {
    inputLimit: 30720,
    outputLimit: 2048,
    contextWindow: 32768,
  },
};

const DEFAULT_LIMITS = {
  inputLimit: 7168,
  outputLimit: 1024,
  contextWindow: 8192,
};

export function getModelLimits(model: string) {
  return MODEL_LIMITS[model] ?? DEFAULT_LIMITS;
}

export function isOverThreshold(
  totalTokens: number,
  contextWindow: number,
  threshold = DEFAULT_THRESHOLD,
): boolean {
  return totalTokens / contextWindow >= threshold;
}

export function calculateUsagePercentage(
  totalTokens: number,
  contextWindow: number,
): number {
  return (totalTokens / contextWindow) * 100;
}
```

### Compaction: `src/agent/context/compaction.ts`

When the conversation grows too large, summarise it with a separate LLM call:

```typescript
import { generateText, type ModelMessage } from 'ai';
import { getModel } from '../model.ts';
import { extractMessageText } from './tokenEstimator.ts';

function messagesToText(messages: ModelMessage[]): string {
  return messages
    .map((msg) => {
      const role = msg.role.toUpperCase();
      const content = extractMessageText(msg);
      return `[${role}]: ${content}`;
    })
    .join('\n\n');
}

export async function compactConversation(
  messages: ModelMessage[],
): Promise<ModelMessage[]> {
  const nonSystem = messages.filter((m) => m.role !== 'system');
  const conversationText = messagesToText(nonSystem);

  const { text } = await generateText({
    model: getModel(),
    system:
      'Summarise the following conversation. Keep all key facts, decisions, file paths, and code snippets. Output only the summary, no preamble.',
    prompt: `Summarise this conversation:\n\n${conversationText}`,
  });

  return [
    {
      role: 'user',
      content: `[Conversation summary from earlier in the session]\n${text}`,
    },
    {
      role: 'assistant',
      content: 'Understood. I have the context from the earlier conversation.',
    },
  ];
}
```

### Context Index: `src/agent/context/index.ts`

```typescript
export {
  estimateTokens,
  estimateMessagesTokens,
  extractMessageText,
  type TokenUsage,
} from './tokenEstimator.ts';

export {
  DEFAULT_THRESHOLD,
  getModelLimits,
  isOverThreshold,
  calculateUsagePercentage,
} from './modelLimits.ts';

export { compactConversation } from './compaction.ts';
```

---

## Lesson 7: The Terminal UI (Ink + React)

The CLI uses [Ink](https://github.com/vadimdemedes/ink) — React for terminals.
Ink components render to ANSI escape codes instead of DOM.

### Component Tree

```
App
├── Header ("🤖 AI Agent")
├── MessageList (scrollable chat history)
├── Streaming text (live token display)
├── ToolCall (active tool status with spinner)
├── ToolApproval (yes/no prompt)
├── Input (keyboard-driven text input)
└── TokenUsage (context window bar)
```

### Entry Point: `src/index.ts`

```typescript
import React from 'react';
import { render } from 'ink';
import { App } from './ui/App.tsx';

render(React.createElement(App));
```

### CLI Entry: `src/cli.ts`

```typescript
#!/usr/bin/env node
import 'dotenv/config';
import React from 'react';
import { render } from 'ink';
import { App } from './ui/App.tsx';

render(React.createElement(App));
```

### Main App: `src/ui/App.tsx`

This component orchestrates the entire UI. Key state:

| State | Purpose |
|---|---|
| `messages` | Chat history for display |
| `conversationHistory` | Full ModelMessage[] for the agent loop |
| `isLoading` | Whether we're waiting on the LLM |
| `streamingText` | Partial response being typed out |
| `activeToolCalls` | Tools currently executing |
| `pendingApproval` | HITL approval waiting for user input |
| `tokenUsage` | Context window consumption |

```typescript
import React, { useState, useCallback } from 'react';
import { Box, Text, useApp } from 'ink';
import type { ModelMessage } from 'ai';
import { runAgent } from '../agent/run.ts';
import { MessageList, type Message } from './components/MessageList.tsx';
import { ToolCall, type ToolCallProps } from './components/ToolCall.tsx';
import { Spinner } from './components/Spinner.tsx';
import { Input } from './components/Input.tsx';
import { ToolApproval } from './components/ToolApproval.tsx';
import { TokenUsage } from './components/TokenUsage.tsx';
import type { ToolApprovalRequest, TokenUsageInfo } from '../types.ts';

interface ActiveToolCall extends ToolCallProps {
  id: string;
}

export function App() {
  const { exit } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationHistory, setConversationHistory] = useState<ModelMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [activeToolCalls, setActiveToolCalls] = useState<ActiveToolCall[]>([]);
  const [pendingApproval, setPendingApproval] = useState<ToolApprovalRequest | null>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsageInfo | null>(null);

  const handleSubmit = useCallback(
    async (userInput: string) => {
      if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
        exit();
        return;
      }

      setMessages((prev) => [...prev, { role: 'user', content: userInput }]);
      setIsLoading(true);
      setStreamingText('');
      setActiveToolCalls([]);

      try {
        const newHistory = await runAgent(userInput, conversationHistory, {
          onToken: (token) => setStreamingText((prev) => prev + token),
          onToolCallStart: (name, args) => {
            setActiveToolCalls((prev) => [
              ...prev,
              { id: `${name}-${Date.now()}`, name, args, status: 'pending' },
            ]);
          },
          onToolCallEnd: (name, result) => {
            setActiveToolCalls((prev) =>
              prev.map((tc) =>
                tc.name === name && tc.status === 'pending'
                  ? { ...tc, status: 'complete', result }
                  : tc,
              ),
            );
          },
          onComplete: (response) => {
            if (response) {
              setMessages((prev) => [...prev, { role: 'assistant', content: response }]);
            }
            setStreamingText('');
            setActiveToolCalls([]);
          },
          onToolApproval: (name, args) => {
            return new Promise<boolean>((resolve) => {
              setPendingApproval({ toolName: name, args, resolve });
            });
          },
          onTokenUsage: (usage) => setTokenUsage(usage),
        });

        setConversationHistory(newHistory);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Error: ${errorMessage}` },
        ]);
        setStreamingText('');
      } finally {
        setIsLoading(false);
      }
    },
    [conversationHistory, exit],
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="magenta">🤖 AI Agent</Text>
        <Text dimColor> (type "exit" to quit)</Text>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <MessageList messages={messages} />

        {streamingText && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="green" bold>› Assistant</Text>
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
          <Box marginTop={1}><Spinner /></Box>
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

      {!pendingApproval && <Input onSubmit={handleSubmit} disabled={isLoading} />}
      <TokenUsage usage={tokenUsage} />
    </Box>
  );
}
```

### UI Components

**`src/ui/components/MessageList.tsx`** — Renders chat history:

```typescript
import React from 'react';
import { Box, Text } from 'ink';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function MessageList({ messages }: { messages: Message[] }) {
  return (
    <Box flexDirection="column" gap={1}>
      {messages.map((msg, i) => (
        <Box key={i} flexDirection="column">
          <Text color={msg.role === 'user' ? 'blue' : 'green'} bold>
            {msg.role === 'user' ? '› You' : '› Assistant'}
          </Text>
          <Box marginLeft={2}>
            <Text>{msg.content}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}
```

**`src/ui/components/Input.tsx`** — Keyboard-driven text input:

```typescript
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export function Input({
  onSubmit,
  disabled = false,
}: {
  onSubmit: (value: string) => void;
  disabled?: boolean;
}) {
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
      <Text color="blue" bold>{'> '}</Text>
      <Text>{value}</Text>
      {!disabled && <Text color="gray">▌</Text>}
    </Box>
  );
}
```

**`src/ui/components/Spinner.tsx`** — Loading indicator:

```typescript
import React from 'react';
import { Text } from 'ink';
import InkSpinner from 'ink-spinner';

export function Spinner({ label = 'Thinking...' }: { label?: string }) {
  return (
    <Text>
      <Text color="cyan"><InkSpinner type="dots" /></Text>
      {' '}<Text dimColor>{label}</Text>
    </Text>
  );
}
```

**`src/ui/components/ToolCall.tsx`** — Tool execution status:

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
  const displayResult = result
    ? result.length > previewLength
      ? result.slice(0, previewLength)
      : result
    : '';

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box>
        <Text color="yellow">⚡ </Text>
        <Text color="yellow" bold>{name}</Text>
        {status === 'pending' ? (
          <Text> <Text color="cyan"><InkSpinner type="dots" /></Text></Text>
        ) : (
          <Text color="green"> ✓</Text>
        )}
      </Box>
      {status === 'complete' && displayResult && (
        <Box flexDirection="column" marginLeft={2}>
          <Text dimColor>→ {displayResult}</Text>
          {result && result.length > previewLength && (
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

**`src/ui/components/TokenUsage.tsx`** — Context window consumption bar:

```typescript
import React from 'react';
import { Box, Text } from 'ink';
import type { TokenUsageInfo } from '../../types.ts';

export function TokenUsage({ usage }: { usage: TokenUsageInfo | null }) {
  if (!usage) return null;

  const thresholdPercent = Math.round(usage.threshold * 100);
  const usagePercent = usage.percentage.toFixed(1);

  let color = 'green';
  if (usage.percentage >= usage.threshold * 100) color = 'red';
  else if (usage.percentage >= usage.threshold * 100 * 0.75) color = 'yellow';

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Text>
        Tokens: <Text color={color} bold>{usagePercent}%</Text>
        <Text dimColor> (threshold: {thresholdPercent}%)</Text>
      </Text>
    </Box>
  );
}
```

### UI Index: `src/ui/index.tsx`

```typescript
export { App } from './App.tsx';
```

### `package.json` scripts

```json
{
  "name": "agi",
  "version": "1.0.0",
  "type": "module",
  "bin": { "agi": "./dist/cli.js" },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "eval": "npx lmnr eval",
    "eval:file-tools": "npx lmnr eval evals/file-tools.eval.ts",
    "eval:agent": "npx lmnr eval evals/agent-multiturn.eval.ts"
  }
}
```

Install UI dependencies:

```bash
npm install ink ink-spinner react
npm install -D @types/react
```

Run the agent:

```bash
npm run dev
```

---

## Lesson 8: Evaluations

We test the agent at two levels:

1. **Single-turn**: Does the model pick the right tool for a given prompt?
2. **Multi-turn**: Does the agent complete a task using tools correctly across multiple steps?

We use [Laminar](https://lmnr.ai) (`@lmnr-ai/lmnr`) as the eval framework, but the
evaluators and executors are framework-agnostic.

> **For LM Studio users**: The eval code in the original codebase uses DeepSeek via
> `@ai-sdk/deepseek`. Replace those imports with our `getModel()` from `src/agent/model.ts`
> or with a direct `createOpenAICompatible` call.

### Eval Types: `evals/types.ts`

```typescript
import type { ModelMessage } from 'ai';

export interface EvalData {
  prompt: string;
  systemPrompt?: string;
  tools: string[];
  config?: { model?: string; temperature?: number };
}

export interface EvalTarget {
  expectedTools?: string[];
  forbiddenTools?: string[];
  category: 'golden' | 'secondary' | 'negative';
}

export interface SingleTurnResult {
  toolCalls: Array<{ toolName: string; args: unknown }>;
  toolNames: string[];
  selectedAny: boolean;
}

export interface MockToolConfig {
  description: string;
  parameters: Record<string, string>;
  mockReturn: string;
}

export interface MultiTurnEvalData {
  prompt?: string;
  messages?: ModelMessage[];
  mockTools: Record<string, MockToolConfig>;
  config?: { model?: string; maxSteps?: number };
}

export interface MultiTurnTarget {
  originalTask: string;
  expectedToolOrder?: string[];
  forbiddenTools?: string[];
  mockToolResults: Record<string, string>;
  category: 'task-completion' | 'conversation-continuation' | 'negative';
}

export interface MultiTurnResult {
  text: string;
  steps: Array<{
    toolCalls?: Array<{ toolName: string; args: unknown }>;
    toolResults?: Array<{ toolName: string; result: unknown }>;
    text?: string;
  }>;
  toolsUsed: string[];
  toolCallOrder: string[];
}
```

### Executors: `evals/executors.ts`

**Single-turn executor** — uses `generateText` with `stopWhen: stepCountIs(1)` to get
exactly one set of tool calls:

```typescript
import { generateText, stepCountIs, tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { getModel } from '../src/agent/model.ts';
import { SYSTEM_PROMPT } from '../src/agent/system/prompt.ts';
import type { EvalData, MultiTurnEvalData, MultiTurnResult } from './types.ts';
import { buildMessages, buildMockedTools } from './utils.ts';

const TOOL_DEFINITIONS: Record<string, { description: string; parameters: z.ZodObject<any> }> = {
  readFile: {
    description: 'Reads the content of a file at a given path.',
    parameters: z.object({ path: z.string() }),
  },
  writeFile: {
    description: 'Writes content to a file at a given path.',
    parameters: z.object({ path: z.string(), content: z.string() }),
  },
  listFiles: {
    description: 'Lists all files in a given directory.',
    parameters: z.object({ path: z.string() }),
  },
  deleteFile: {
    description: 'Deletes a file at a given path.',
    parameters: z.object({ path: z.string() }),
  },
};

export const singleTurnExecutorWithMocks = async (data: EvalData) => {
  const messages = buildMessages(data);
  const tools: ToolSet = {};

  for (const toolName of data.tools) {
    const def = TOOL_DEFINITIONS[toolName];
    if (def) {
      tools[toolName] = tool({
        description: def.description,
        inputSchema: def.parameters,
      });
    }
  }

  const { toolCalls } = await generateText({
    model: getModel(),
    system: typeof messages[0].content === 'string' ? messages[0].content : '',
    messages: messages.slice(1) as any,
    tools,
    stopWhen: stepCountIs(1),
    temperature: data.config?.temperature,
  });

  const calls = toolCalls.map((tc) => ({
    toolName: tc.toolName,
    args: 'input' in tc ? tc.input : {},
  }));

  return {
    toolCalls: calls,
    toolNames: calls.map((c) => c.toolName),
    selectedAny: calls.length > 0,
  };
};

export const multiTurnWithMocks = async (data: MultiTurnEvalData): Promise<MultiTurnResult> => {
  const tools = buildMockedTools(data.mockTools);

  const messages = data.messages ?? [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: data.prompt! },
  ];

  const result = await generateText({
    model: getModel(),
    messages,
    tools,
    stopWhen: stepCountIs(data.config?.maxSteps ?? 23),
  });

  const allToolCalls: string[] = [];
  const steps = result.steps?.map((step) => {
    const stepToolCalls = (step.toolCalls ?? []).map((tc) => {
      allToolCalls.push(tc.toolName);
      return { toolName: tc.toolName, args: 'input' in tc ? tc.input : {} };
    });
    const stepToolResults = (step.toolResults ?? []).map((tr) => ({
      toolName: tr.toolName,
      result: 'result' in tr ? tr.result : tr,
    }));
    return {
      toolCalls: stepToolCalls.length > 0 ? stepToolCalls : undefined,
      toolResults: stepToolResults.length > 0 ? stepToolResults : undefined,
      text: step.text || undefined,
    };
  }) ?? [];

  return {
    text: result.text,
    steps,
    toolsUsed: [...new Set(allToolCalls)],
    toolCallOrder: allToolCalls,
  };
};
```

### Evaluators: `evals/evaluators.ts`

```typescript
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { getModel } from '../src/agent/model.ts';
import type { EvalTarget, SingleTurnResult, MultiTurnTarget, MultiTurnResult } from './types.ts';

/** F1-style precision/recall for tool selection */
export function toolSelectionScore(output: SingleTurnResult, target: EvalTarget): number {
  if (!target.expectedTools?.length) return output.selectedAny ? 0.5 : 1;

  const expected = new Set(target.expectedTools);
  const selected = new Set(output.toolNames);

  const hits = output.toolNames.filter((t) => expected.has(t)).length;
  const precision = selected.size > 0 ? hits / selected.size : 0;
  const recall = hits / expected.size;

  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

/** Check if tools were called in expected sequence */
export function toolOrderCorrect(output: MultiTurnResult, target: MultiTurnTarget): number {
  if (!target.expectedToolOrder?.length) return 1;

  let expectedIdx = 0;
  for (const toolName of output.toolCallOrder) {
    if (toolName === target.expectedToolOrder[expectedIdx]) {
      expectedIdx++;
      if (expectedIdx === target.expectedToolOrder.length) break;
    }
  }
  return expectedIdx / target.expectedToolOrder.length;
}

/** Returns 1 if NO forbidden tools used, 0 otherwise */
export function toolsAvoided(
  output: SingleTurnResult | MultiTurnResult,
  target: EvalTarget | MultiTurnTarget,
): number {
  if (!target.forbiddenTools?.length) return 1;
  const selected = new Set('toolNames' in output ? output.toolNames : output.toolsUsed);
  return target.forbiddenTools.some((t) => selected.has(t)) ? 0 : 1;
}

/** LLM-as-judge for multi-turn output quality */
export async function llmJudge(output: MultiTurnResult, target: MultiTurnTarget): Promise<number> {
  const result = await generateText({
    model: getModel(),
    output: Output.object({
      schema: z.object({
        score: z.number().min(1).max(10),
        reason: z.string(),
      }),
    }),
    messages: [
      {
        role: 'system',
        content:
          'You are an evaluation judge. Score the agent response 1-10. 10 = fully correct, using tool results properly.',
      },
      {
        role: 'user',
        content: `Task: ${target.originalTask}
Tools called: ${JSON.stringify(output.toolCallOrder)}
Tool results: ${JSON.stringify(target.mockToolResults)}
Agent answer: ${output.text}

Evaluate whether the response correctly uses the tool results.`,
      },
    ],
  });
  return result.output.score / 10;
}
```

### Utilities: `evals/utils.ts`

```typescript
import { tool, type ModelMessage, type ToolSet } from 'ai';
import { z } from 'zod';
import { SYSTEM_PROMPT } from '../src/agent/system/prompt.ts';
import type { MultiTurnEvalData } from './types.ts';

export function buildMockedTools(mockTools: MultiTurnEvalData['mockTools']): ToolSet {
  const tools: ToolSet = {};
  for (const [name, config] of Object.entries(mockTools)) {
    const paramSchema: Record<string, z.ZodString> = {};
    for (const paramName of Object.keys(config.parameters)) {
      paramSchema[paramName] = z.string();
    }
    tools[name] = tool({
      description: config.description,
      inputSchema: z.object(paramSchema),
      execute: async () => config.mockReturn,
    });
  }
  return tools;
}

export function buildMessages(data: { prompt?: string; systemPrompt?: string }): ModelMessage[] {
  return [
    { role: 'system', content: data.systemPrompt ?? SYSTEM_PROMPT },
    { role: 'user', content: data.prompt! },
  ];
}
```

### Dataset: `evals/data/file-tools.json` (excerpt)

```json
[
  {
    "data": { "prompt": "Read the contents of package.json", "tools": ["readFile", "writeFile", "listFiles", "deleteFile"] },
    "target": { "expectedTools": ["readFile"], "category": "golden" },
    "metadata": { "description": "Direct file read request" }
  },
  {
    "data": { "prompt": "What is the capital of France?", "tools": ["readFile", "writeFile", "listFiles", "deleteFile"] },
    "target": { "forbiddenTools": ["readFile", "writeFile", "listFiles", "deleteFile"], "category": "negative" },
    "metadata": { "description": "General knowledge — should NOT use tools" }
  }
]
```

**Golden prompts** require specific tools. **Negative prompts** must NOT use tools. **Secondary prompts**
are ambiguous — the evaluator scores them leniently.

### Eval Runner: `evals/file-tool.eval.ts`

```typescript
import { evaluate } from '@lmnr-ai/lmnr';
import { toolSelectionScore } from './evaluators.ts';
import type { EvalData } from './types.ts';
import dataSet from './data/file-tools.json' with { type: 'json' };
import { singleTurnExecutorWithMocks } from './executors.ts';

evaluate({
  data: dataSet as any,
  executor: async (data: EvalData) => singleTurnExecutorWithMocks(data),
  evaluators: {
    selectionScore: (output: any, target: any) => {
      if (target?.category === 'secondary') return 1;
      return toolSelectionScore(output, target);
    },
  },
});
```

Run: `npm run eval:file-tools`

---

## Lesson 9: Human-in-the-Loop (HITL)

Some tools are dangerous — file deletion, shell commands, bulk writes. Before executing
them, the agent pauses and asks the user for approval.

### Tool Approval Component: `src/ui/components/ToolApproval.tsx`

```typescript
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface ToolApprovalProps {
  toolName: string;
  args: unknown;
  onResolve: (approved: boolean) => void;
}

function formatArgs(args: unknown): { preview: string; extraLines: number } {
  const formatted = JSON.stringify(args, null, 2);
  const lines = formatted.split('\n');
  if (lines.length <= 5) return { preview: formatted, extraLines: 0 };
  return {
    preview: lines.slice(0, 5).join('\n'),
    extraLines: lines.length - 5,
  };
}

function getArgsSummary(args: unknown): string {
  if (typeof args !== 'object' || args === null) return String(args);
  const obj = args as Record<string, unknown>;
  const meaningfulKeys = ['path', 'command', 'query', 'content'];
  for (const key of meaningfulKeys) {
    if (key in obj && typeof obj[key] === 'string') {
      const value = obj[key] as string;
      return value.length > 50 ? value.slice(0, 50) + '...' : value;
    }
  }
  return '';
}

export function ToolApproval({ toolName, args, onResolve }: ToolApprovalProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const options = ['Yes', 'No'];
  const { preview, extraLines } = formatArgs(args);
  const argsSummary = getArgsSummary(args);

  useInput(
    (input, key) => {
      if (key.upArrow || key.downArrow) {
        setSelectedIndex((prev) => (prev === 0 ? 1 : 0));
        return;
      }
      if (key.return) onResolve(selectedIndex === 0);
    },
    { isActive: true },
  );

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow" bold>Tool Approval Required</Text>
      <Box marginLeft={2} flexDirection="column">
        <Text>
          <Text color="cyan" bold>{toolName}</Text>
          {argsSummary && <Text dimColor>({argsSummary})</Text>}
        </Text>
        <Box marginLeft={2} flexDirection="column">
          <Text dimColor>{preview}</Text>
          {extraLines > 0 && <Text color="gray">... +{extraLines} more lines</Text>}
        </Box>
      </Box>
      <Box marginTop={1} marginLeft={2} flexDirection="row" gap={2}>
        {options.map((option, index) => (
          <Text
            key={option}
            color={selectedIndex === index ? 'green' : 'gray'}
            bold={selectedIndex === index}
          >
            {selectedIndex === index ? '› ' : '  '}{option}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
```

### Wiring HITL into the Loop

The `onToolApproval` callback in `runAgent` is the integration point. In `App.tsx`:

```typescript
onToolApproval: (name, args) => {
  return new Promise<boolean>((resolve) => {
    setPendingApproval({ toolName: name, args, resolve });
  });
},
```

When the agent wants to execute a tool, it calls this callback. The UI sets `pendingApproval`,
renders the `ToolApproval` component, and blocks until the user presses Yes or No. The
`resolve(boolean)` call unblocks the loop.

---

## Full Project Structure

```
ai-agent/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # Entry point
│   ├── cli.ts                      # CLI entry (with dotenv)
│   ├── types.ts                    # Shared type definitions
│   └── agent/
│       ├── model.ts                # LLM provider (LM Studio)
│       ├── run.ts                  # Core agent loop
│       ├── executeTools.ts         # Tool dispatcher
│       ├── tools/
│       │   ├── index.ts            # Tool registry
│       │   ├── file.ts             # File read/write/list/delete
│       │   └── dateTime.ts         # (Optional) date/time tool
│       ├── system/
│       │   ├── prompt.ts           # System prompt
│       │   └── filterMessages.ts   # Message compatibility filter
│       └── context/
│           ├── index.ts            # Barrel export
│           ├── tokenEstimator.ts   # Token counting
│           ├── modelLimits.ts      # Per-model capacity
│           └── compaction.ts       # Conversation summarisation
├── src/ui/
│   ├── index.tsx                   # Barrel export
│   ├── App.tsx                     # Main terminal UI
│   └── components/
│       ├── Input.tsx               # Keyboard input
│       ├── MessageList.tsx         # Chat history
│       ├── Spinner.tsx             # Loading indicator
│       ├── ToolCall.tsx            # Tool execution status
│       ├── ToolApproval.tsx        # HITL approval prompt
│       └── TokenUsage.tsx          # Context bar
└── evals/
    ├── types.ts                    # Eval type definitions
    ├── executors.ts                # Single/multi-turn executors
    ├── evaluators.ts               # Scoring functions
    ├── utils.ts                    # Mock builders
    ├── data/
    │   ├── file-tools.json         # Tool selection dataset
    │   └── agent-multiturn.json    # Full agent dataset
    ├── mocks/
    │   └── tools.ts                # Mock tool factories
    ├── file-tool.eval.ts           # Single-turn eval runner
    └── agent-multiturn.eval.ts     # Multi-turn eval runner
```

---

## Running the Agent

1. **Start LM Studio** and load a Gemma model (e.g. `gemma-3-4b-it`).
2. **Start the agent:**

```bash
npm run dev
```

3. **Try it out:**

```
> List the files in the current directory
> Read package.json and tell me the project name
> Create a file called test.txt with "hello world"
> Delete test.txt
```

4. **Run the evals:**

```bash
npm run eval:file-tools
npm run eval:agent
```

---

## Adapting the Original Codebase for LM Studio

The original codebase uses DeepSeek. The key change is replacing the provider layer.

**Original (`src/agent/run.ts`):**

```typescript
import { createDeepSeek } from '@ai-sdk/deepseek';

const deepseek = createDeepSeek({ apiKey: process.env.OPENAI_API_KEY });
const MODEL_NAME = 'deepseek-v4-pro';

// Later...
model: deepseek.chat(MODEL_NAME),
```

**Tutorial version (`src/agent/model.ts` + `src/agent/run.ts`):**

```typescript
// src/agent/model.ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const lmstudio = createOpenAICompatible({
  name: 'lmstudio',
  baseURL: 'http://localhost:1234/v1',
  apiKey: 'lm-studio-no-key',
});

export function getModel() {
  return lmstudio.chat('gemma-3-4b-it');
}

// src/agent/run.ts
import { getModel } from './model.ts';

// Later...
model: getModel(),
```

Everything else — the agent loop, tool definitions, UI, evals — remains structurally identical.
This is the power of the AI SDK's provider abstraction.

---

## Key Takeaways

1. **An agent is an LLM in a loop** — the model decides what tool to call, we execute it,
   feed the result back, and repeat until the model decides to stop.

2. **Separate schemas from execution** — the LLM only sees tool descriptions and parameter
   types. Execution happens locally in a controlled environment.

3. **Callbacks decouple the loop from the UI** — the same agent loop works in a terminal,
   a web app, or a headless eval harness.

4. **Evals at two levels** — single-turn checks that the model picks the right tool;
   multi-turn checks that the agent completes tasks correctly end-to-end.

5. **Local LLMs are practical for development** — LM Studio + Gemma 4 gives you zero-cost
   iteration with full privacy. The same code works with cloud models by changing one provider file.

6. **HITL is a callback, not a framework** — human approval is just a Promise that resolves
   when the user clicks Yes/No. The loop doesn't care whether "the user" is a terminal prompt
   or a web UI button.

---

## Next Steps

- Add a **shell tool** that executes commands and returns output
- Add a **web search tool** using a search API
- Implement **streaming token usage** in the UI so the context bar updates live
- Add **tool-specific approval rules** (auto-approve reads, require approval for writes/deletes)
- Experiment with different Gemma model sizes (4B vs 12B) and compare quality
- Package the agent as an npm binary (`npx agi`)
