import { generateText, stepCountIs } from 'ai';
import { getModel, resolveModelName } from './providers/index.ts';
import { tools } from './tools/index.ts';

// ---------------------------------------------------------------------------
// Role-specific system prompts for sub-agents
// ---------------------------------------------------------------------------
const ROLE_PROMPTS: Record<string, string> = {
  researcher: `You are a research sub-agent. Your job is to investigate a topic thoroughly and report your findings.
- Use web search and file tools as needed.
- Be thorough but concise.
- Structure your final answer clearly with key findings.`,

  'code-explorer': `You are a code exploration sub-agent. Your job is to search and analyze code in the codebase.
- Use grep, readFile, and listFiles extensively.
- Report exact file paths and line numbers.
- If the task involves finding patterns, be systematic and exhaustive.`,

  'file-organizer': `You are a file organization sub-agent. Your job is to organize, rename, or restructure files as instructed.
- Use readFile, writeFile, editFile, deleteFile, and listFiles.
- Be careful and deliberate — check before deleting or overwriting.
- Report every action you took and why.`,

  analyst: `You are an analysis sub-agent. Your job is to analyze information deeply and provide insights.
- Think step by step and show your reasoning.
- Consider multiple angles and edge cases.
- Present your analysis clearly with logical structure.`,

  summarizer: `You are a summarization sub-agent. Your job is to read, digest, and summarize information.
- Be extremely concise while preserving key points.
- Focus on what's actionable or important.
- Output should be a tight summary, not a long report.`,

  default: `You are a sub-agent. Complete the given task efficiently and report your results.
- Use available tools as needed.
- Be concise and direct.
- Report exactly what you found or did.`,
};

export type SubAgentRole = keyof typeof ROLE_PROMPTS;

// ---------------------------------------------------------------------------
export interface SubAgentOptions {
  /** The task for the sub-agent to complete */
  task: string;
  /** Specialized role that determines the system prompt (default: "default") */
  role?: SubAgentRole;
  /** Override the model (uses AGENT_MODEL or runtime override if not set) */
  model?: string;
  /** Max tool-calling iterations (default: 5) */
  maxSteps?: number;
}

// ---------------------------------------------------------------------------
/**
 * Run a sub-agent with its own isolated context, model, and tools.
 *
 * The sub-agent:
 *   - Gets a fresh conversation (no parent history)
 *   - Can use all tools EXCEPT "delegate" (prevents infinite recursion)
 *   - Uses the specified model (or inherits from parent)
 *   - Is limited to maxSteps tool-calling iterations
 *   - Returns a single text result
 */
export async function runSubAgent(options: SubAgentOptions): Promise<string> {
  const {
    task,
    role = 'default',
    model: modelOverride,
    maxSteps = 5,
  } = options;

  const systemPrompt = ROLE_PROMPTS[role] ?? ROLE_PROMPTS.default;
  const model = getModel(resolveModelName(modelOverride));

  // Exclude the delegate tool to prevent infinite sub-agent recursion
  const { delegate: _, ...subAgentTools } = tools;

  try {
    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: task,
      tools: subAgentTools,
      maxOutputTokens: 16000,
      stopWhen: stepCountIs(maxSteps),
    });

    // Include step metadata for transparency
    const steps = result.steps?.length ?? 0;
    const prefix =
      steps > 0
        ? `[Sub-agent "${role}" completed in ${steps} step${steps > 1 ? 's' : ''}]\n\n`
        : '';

    return prefix + result.text;
  } catch (error) {
    return `Sub-agent "${role}" failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}
