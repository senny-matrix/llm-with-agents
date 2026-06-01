// ---------------------------------------------------------------------------
// Cost tracking — pricing per 1M tokens for known models/providers
// ---------------------------------------------------------------------------

export interface CostBreakdown {
  /** Cost in USD for input tokens */
  inputCost: number;
  /** Cost in USD for output tokens */
  outputCost: number;
  /** Total cost in USD */
  totalCost: number;
}

interface Pricing {
  /** USD per 1M input tokens */
  input: number;
  /** USD per 1M output tokens */
  output: number;
}

// Pricing data (approximate, as of 2025-2026)
// Sources: provider docs, public pricing pages
const PRICING: Record<string, Pricing> = {
  // DeepSeek
  "deepseek-chat": { input: 0.14, output: 0.28 },
  "deepseek-v4-pro": { input: 0.14, output: 0.28 },
  "deepseek-v4-flash": { input: 0.07, output: 0.14 },

  // OpenAI / Azure (approximate)
  "gpt-4o": { input: 2.50, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "gpt-5": { input: 1.25, output: 10.0 },
  "gpt-5-mini": { input: 0.15, output: 0.60 },

  // Anthropic (approximate)
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-3-5-sonnet": { input: 3.0, output: 15.0 },
  "claude-3-5-haiku": { input: 0.80, output: 4.0 },
};

// Patterns to match local / free models
const FREE_MODEL_PATTERNS = [
  "lmstudio",
  "localhost",
  "ollama",
  "127.0.0.1",
  "gpt-oss",
  "llama",
  "mistral",
  "gemma",
  "phi-",
  "qwen",
];

/** Check if a model is local/free (0 cost) */
function isLocalFree(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return FREE_MODEL_PATTERNS.some((p) => lower.includes(p));
}

/** Find pricing for a model by partial match */
function findPricing(modelId: string): Pricing | null {
  const lower = modelId.toLowerCase();
  // Exact match
  if (PRICING[lower]) return PRICING[lower];
  // Prefix match (e.g., "deepseek-chat" matches "deepseek-chat-v2")
  for (const [key, price] of Object.entries(PRICING)) {
    if (lower.startsWith(key)) return price;
  }
  return null;
}

/**
 * Calculate cost for a model's token usage.
 * Returns zero cost for local/free models.
 */
export function calculateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): CostBreakdown {
  if (isLocalFree(modelId)) {
    return { inputCost: 0, outputCost: 0, totalCost: 0 };
  }

  const pricing = findPricing(modelId);
  if (!pricing) {
    // Unknown model — assume zero cost rather than guessing
    return { inputCost: 0, outputCost: 0, totalCost: 0 };
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
  };
}

/**
 * Format a USD cost for display.
 * Shows 4 decimal places for sub-cent costs, 2 for larger amounts.
 */
export function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}
