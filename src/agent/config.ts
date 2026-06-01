import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { ProviderType } from "./providers/index.ts";
import type { MCPServerConfig } from "./mcp/client.ts";

export interface AgiConfig {
  /** Default model name (overridden by AGENT_MODEL env var) */
  defaultModel: string;
  /** Default provider (overridden by PROVIDER env var) */
  defaultProvider: ProviderType;
  /** Default tool-approval mode */
  mode: "safe" | "auto";
  /** Start with markdown rendering enabled */
  markdown: boolean;
  /** LM Studio base URL */
  lmstudioUrl: string;
  /** MCP server configurations */
  mcpServers: MCPServerConfig[];
}

const DEFAULTS: AgiConfig = {
  defaultModel: "deepseek-v4-pro",
  defaultProvider: "deepseek",
  mode: "safe",
  markdown: false,
  lmstudioUrl: "http://localhost:1234/v1",
  mcpServers: [],
};

const CONFIG_PATH = resolve(homedir(), ".agirc.json");

let _config: AgiConfig | null = null;

/** Load config from ~/.agirc.json, falling back to env vars and defaults */
export function loadConfig(): AgiConfig {
  if (_config) return _config;

  let file: Partial<AgiConfig> = {};

  // 1. Read config file
  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = readFileSync(CONFIG_PATH, "utf-8");
      file = JSON.parse(raw);
    } catch {
      // Silently ignore malformed config — warn to stderr
      console.error(`Warning: Could not parse ${CONFIG_PATH}. Using defaults.`);
    }
  }

  // 2. Env vars override config file values
  _config = {
    defaultModel:
      process.env.AGENT_MODEL ||
      file.defaultModel ||
      DEFAULTS.defaultModel,
    defaultProvider:
      (process.env.PROVIDER as ProviderType) ||
      file.defaultProvider ||
      DEFAULTS.defaultProvider,
    mode:
      (process.env.AGI_MODE as "safe" | "auto") ||
      file.mode ||
      DEFAULTS.mode,
    markdown:
      process.env.AGI_MARKDOWN === "true"
        ? true
        : process.env.AGI_MARKDOWN === "false"
          ? false
          : file.markdown ?? DEFAULTS.markdown,
    lmstudioUrl:
      process.env.LMSTUDIO_URL ||
      file.lmstudioUrl ||
      DEFAULTS.lmstudioUrl,
    mcpServers:
      file.mcpServers ?? DEFAULTS.mcpServers,
  };

  return _config;
}

/** Get the currently loaded config (loads it if not already loaded) */
export function getConfig(): AgiConfig {
  return _config ?? loadConfig();
}

/** Reset cached config (useful for testing) */
export function resetConfig(): void {
  _config = null;
}

/**
 * Generate a sample config file content for documentation / help text.
 */
export function sampleConfig(): string {
  return JSON.stringify(
    {
      defaultModel: "deepseek-v4-pro",
      defaultProvider: "deepseek",
      mode: "safe",
      markdown: false,
      lmstudioUrl: "http://localhost:1234/v1",
      mcpServers: [
        {
          name: "filesystem",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"],
        },
      ],
    },
    null,
    2,
  );
}

/**
 * Path to the config file
 */
export function configPath(): string {
  return CONFIG_PATH;
}
