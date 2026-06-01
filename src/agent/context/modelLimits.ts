import type { ModelLimits } from "../../types.ts";

/**
 * Default threshold for context window usage (80%)
 */
export const DEFAULT_THRESHOLD = 0.8;

/**
 * Model limits registry
 * Currently only includes GPT-5 models
 */
const MODEL_LIMITS: Record<string, ModelLimits> = {
  "deepseek-v4-pro": {
    inputLimit: 128000,
    outputLimit: 32000,
    contextWindow: 262144, // 256K
  },
  "deepseek-v4-flash": {
    inputLimit: 96000,
    outputLimit: 32000,
    contextWindow: 131072, // 128K
  },
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

/**
 * Default limits used when model is not found in registry
 */
const DEFAULT_LIMITS: ModelLimits = {
  inputLimit: 128000,
  outputLimit: 16000,
  contextWindow: 128000,
};

/**
 * Default limits for common local / self-hosted models.
 * LM Studio and similar tools use model IDs like "openai/gpt-oss-20b"
 * or "meta-llama/llama-4-maverick". We match against known prefixes/patterns.
 */
const LOCAL_MODEL_PATTERNS: Record<string, ModelLimits> = {
  // 20B class models — typically 16K–32K context
  'gpt-oss-20b': { inputLimit: 32000, outputLimit: 8000, contextWindow: 32768 },
  // Mistral small models — 32K context
  'mistral-nemo': { inputLimit: 32000, outputLimit: 8000, contextWindow: 32768 },
  // Llama 3 / 4 8B — 128K context
  'llama-3': { inputLimit: 128000, outputLimit: 16000, contextWindow: 131072 },
  'llama-4': { inputLimit: 128000, outputLimit: 16000, contextWindow: 131072 },
  // Phi-3/4 models — 128K context
  'phi-3': { inputLimit: 128000, outputLimit: 16000, contextWindow: 131072 },
  'phi-4': { inputLimit: 128000, outputLimit: 16000, contextWindow: 131072 },
  // Qwen 2.5 — 128K context
  'qwen2': { inputLimit: 128000, outputLimit: 16000, contextWindow: 131072 },
  // Gemma models
  'gemma-2': { inputLimit: 8000, outputLimit: 4000, contextWindow: 8192 },
  'gemma-4': { inputLimit: 128000, outputLimit: 16000, contextWindow: 131072 },
  // DeepSeek local models — 128K
  'deepseek-coder': { inputLimit: 128000, outputLimit: 16000, contextWindow: 131072 },
  'deepseek-r1': { inputLimit: 128000, outputLimit: 16000, contextWindow: 131072 },
};

/**
 * Get token limits for a specific model.
 * Falls back to default limits if model not found.
 * Matches GPT-5 variants (gpt-5, gpt-5-mini, etc.)
 */
export function getModelLimits(model: string): ModelLimits {
  // Direct match
  if (MODEL_LIMITS[model]) {
    return MODEL_LIMITS[model];
  }

  // Check for gpt-5 variants
  if (model.startsWith("gpt-5")) {
    return MODEL_LIMITS["gpt-5"];
  }

  // Check local-model patterns (case-insensitive substring match)
  const modelLower = model.toLowerCase();
  for (const [pattern, limits] of Object.entries(LOCAL_MODEL_PATTERNS)) {
    if (modelLower.includes(pattern)) {
      return limits;
    }
  }

  return DEFAULT_LIMITS;
}

/**
 * Check if token usage exceeds the threshold
 */
export function isOverThreshold(
  totalTokens: number,
  contextWindow: number,
  threshold: number = DEFAULT_THRESHOLD,
): boolean {
  return totalTokens >= contextWindow * threshold;
}

/**
 * Calculate usage percentage
 */
export function calculateUsagePercentage(
  totalTokens: number,
  contextWindow: number,
): number {
  return ( totalTokens / contextWindow ) * 100;
}
