import { tool } from 'ai';
import { z } from 'zod';
import { runSubAgent } from '../subAgent.ts';

const ROLES = ['researcher', 'code-explorer', 'file-organizer', 'analyst', 'summarizer'] as const;

export const delegate = tool({
  description:
    'Spawn a sub-agent to handle a subtask independently. The sub-agent gets its own isolated context, ' +
    'can use all file/shell/search tools, and returns a text result. Use this to parallelize work, ' +
    'offload complex analysis, or use a different model for specialized tasks.\n\n' +
    'Available roles: ' +
    ROLES.map(r => `"${r}"`).join(', ') +
    ' (or omit for default).\n\n' +
    'Examples:\n' +
    '  delegate({ task: "Find all TODO comments in src/", role: "code-explorer" })\n' +
    '  delegate({ task: "Summarize the key findings from this codebase", role: "analyst", model: "google/gemma-4-e4b" })',
  inputSchema: z.object({
    task: z.string().describe('The task for the sub-agent to complete'),
    role: z
      .enum(ROLES)
      .optional()
      .describe('Specialized role: "researcher" (web search), "code-explorer" (codebase search), "file-organizer" (file ops), "analyst" (deep analysis), "summarizer" (concise summary)'),
    model: z
      .string()
      .optional()
      .describe('Optional model override (e.g., "google/gemma-4-e4b" for a local fast model, or "deepseek-v4-flash" for cheap cloud). Uses current model if omitted.'),
    maxSteps: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe('Max tool-calling iterations (default: 5, max: 10)'),
  }),
  execute: async ({ task, role, model, maxSteps }) => {
    return runSubAgent({ task, role, model, maxSteps });
  },
});
