import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { getConfig } from '../config.ts';

export type ProviderType = 'deepseek' | 'lmstudio';

export interface ProviderConfig {
  provider: ProviderType;
  /** LM Studio base URL, e.g. http://localhost:1234/v1 */
  lmstudioBaseURL?: string;
  /** LM Studio API key (usually empty for local) */
  lmstudioApiKey?: string;
  /** DeepSeek API key */
  deepseekApiKey?: string;
}

let _config: ProviderConfig = {
  provider: getConfig().defaultProvider,
  lmstudioBaseURL: getConfig().lmstudioUrl,
  lmstudioApiKey: process.env.LMSTUDIO_API_KEY || '',
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
};

// Cached provider instances
let _deepseekInstance: ReturnType<typeof createDeepSeek> | null = null;
let _lmstudioInstance: ReturnType<typeof createOpenAICompatible> | null = null;

export function getProviderConfig(): ProviderConfig {
  return { ..._config };
}

export function setProviderConfig(partial: Partial<ProviderConfig>): void {
  _config = { ..._config, ...partial };
  // Invalidate caches when config changes
  _deepseekInstance = null;
  _lmstudioInstance = null;
}

/**
 * Get a LanguageModelV3 for the given model ID using the current provider config.
 * Call this with the model name (e.g., 'openai/gpt-oss-20b') and it will
 * route to the correct provider.
 */
export function getModel(modelId: string): LanguageModel {
  const { provider, lmstudioBaseURL, lmstudioApiKey, deepseekApiKey } = _config;

  if (provider === 'lmstudio') {
    if (!_lmstudioInstance) {
      _lmstudioInstance = createOpenAICompatible({
        name: 'lmstudio',
        baseURL: lmstudioBaseURL || 'http://localhost:1234/v1',
        apiKey: lmstudioApiKey || undefined,
      });
    }
    return _lmstudioInstance.chatModel(modelId);
  }

  // Default: deepseek
  if (!_deepseekInstance) {
    _deepseekInstance = createDeepSeek({
      apiKey: deepseekApiKey,
    });
  }
  return _deepseekInstance.chat(modelId);
}

/**
 * Resolve model name: for LM Studio the model name is used as-is.
 * Returns the current model name from env or the override.
 */
export function resolveModelName(override?: string): string {
  if (override) return override;
  return getConfig().defaultModel;
}

export function resolveSummarizeModelName(override?: string): string {
  if (override) return override;
  return process.env.SUMMARIZE_MODEL || 'deepseek-v4-flash';
}
