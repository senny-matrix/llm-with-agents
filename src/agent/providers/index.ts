import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { getConfig } from '../config.ts';

export type ProviderType = 'deepseek' | 'lmstudio';

// ── Model Registry ──
// Maps each provider to its known models with metadata.
// This is the single source of truth for provider↔model relationships.

export interface ModelInfo {
  id: string;
  /** Display name / label */
  label: string;
  /** Whether this model supports reasoning / extended thinking */
  reasoning?: boolean;
  /** Whether this is the recommended default for this provider */
  default?: boolean;
}

export interface ProviderInfo {
  id: ProviderType;
  label: string;
  emoji: string;
  description: string;
  models: ModelInfo[];
}

/** Registry of all known providers and their models */
export const PROVIDER_REGISTRY: Record<ProviderType, ProviderInfo> = {
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    emoji: '☁️',
    description: 'DeepSeek cloud API',
    models: [
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', reasoning: true, default: true },
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash (summarize)' },
      { id: 'deepseek-chat', label: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner (R1)', reasoning: true },
    ],
  },
  lmstudio: {
    id: 'lmstudio',
    label: 'LM Studio',
    emoji: '🏠',
    description: 'Local models via LM Studio (OpenAI-compatible API)',
    models: [
      { id: 'google/gemma-4-31b', label: 'Gemma 4 31B (Local)', default: true },
      { id: 'google/gemma-4-e4b', label: 'Gemma 4 4B (Local)', reasoning: true },
      // Common local models — user can add more via /model <id>
    ],
  },
};

// ── Helpers ──

/** Get provider info by ID */
export function getProviderInfo(provider: ProviderType): ProviderInfo {
  return PROVIDER_REGISTRY[provider];
}

/** Get models for a specific provider */
export function getModelsForProvider(provider: ProviderType): ModelInfo[] {
  return PROVIDER_REGISTRY[provider]?.models ?? [];
}

/** Find a model by ID across all providers */
export function findModel(modelId: string): { provider: ProviderType; model: ModelInfo } | null {
  for (const [provider, info] of Object.entries(PROVIDER_REGISTRY)) {
    const model = info.models.find((m) => m.id === modelId);
    if (model) {
      return { provider: provider as ProviderType, model };
    }
  }
  return null;
}

/** Get the default model for a provider */
export function getDefaultModelForProvider(provider: ProviderType): string {
  const models = getModelsForProvider(provider);
  const defaultModel = models.find((m) => m.default);
  return defaultModel?.id ?? models[0]?.id ?? 'deepseek-v4-pro';
}

/** Check if a model exists in a provider's registry */
export function isModelKnownForProvider(modelId: string, provider: ProviderType): boolean {
  return getModelsForProvider(provider).some((m) => m.id === modelId);
}

/** Get all providers that support a given model */
export function findProvidersForModel(modelId: string): ProviderType[] {
  return (Object.keys(PROVIDER_REGISTRY) as ProviderType[]).filter((p) =>
    isModelKnownForProvider(modelId, p),
  );
}

/** Suggest a model when switching to a provider */
export function suggestModelForProviderSwap(
  currentModel: string,
  newProvider: ProviderType,
): { model: string; isKnown: boolean; suggestion: string } {
  const known = isModelKnownForProvider(currentModel, newProvider);
  if (known) {
    return {
      model: currentModel,
      isKnown: true,
      suggestion: `Model "${currentModel}" is known for ${getProviderInfo(newProvider).label}. Keeping it.`,
    };
  }
  const defaultModel = getDefaultModelForProvider(newProvider);
  const defaultLabel =
    getModelsForProvider(newProvider).find((m) => m.id === defaultModel)?.label ?? defaultModel;
  return {
    model: defaultModel,
    isKnown: false,
    suggestion: `"${currentModel}" is not known for ${getProviderInfo(newProvider).label}. Switched to default: "${defaultLabel}"`,
  };
}

/** Format a list of models for display */
export function formatModelList(models: ModelInfo[]): string {
  return models
    .map((m) => {
      const tags: string[] = [];
      if (m.default) tags.push('default');
      if (m.reasoning) tags.push('reasoning');
      const tagStr = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
      return `  • \`${m.id}\` — ${m.label}${tagStr}`;
    })
    .join('\n');
}

// ── Provider Config ──

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
 * Get a LanguageModel for the given model ID using the current provider config.
 * Routes to the correct provider based on _config.provider.
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
 * Resolve model name: returns runtime override, config default, or
 * provider-specific default.
 */
export function resolveModelName(override?: string): string {
  if (override) return override;
  return getConfig().defaultModel;
}

export function resolveSummarizeModelName(override?: string): string {
  if (override) return override;
  return process.env.SUMMARIZE_MODEL || 'deepseek-v4-flash';
}
