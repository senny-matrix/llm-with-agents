#!/usr/bin/env node
import "dotenv/config";
import React from "react";
import { render } from "ink";
import { App } from "./ui/index.tsx";
import { getCurrentModelName, getCurrentProvider } from "./agent/run.ts";
import { getConfig, configPath } from "./agent/config.ts";
import { connectMCPServers, getConnectedServers } from "./agent/mcp/index.ts";
import { addMCPTools } from "./agent/tools/index.ts";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  const model = getCurrentModelName();
  const provider = getCurrentProvider();
  const cfgPath = configPath();
  console.log(`
  agi — an AI coding agent for your terminal

  Usage:
    agi [options]

  Options:
    -h, --help      Show this help message and exit

  ── In-app Commands ──

  Mode & Display:
    /auto           Auto-approve all tool calls without confirmation
    /safe           Require approval for each tool call (default)
    /md             Toggle rendered markdown (tables, headings, code)
    /raw            Toggle raw plain-text markdown output

  Model & Provider:
    /model          Show the current model
    /model <name>   Switch to a different model at runtime
    /provider       Show the current provider
    /provider <p>   Switch provider (deepseek | lmstudio)

  Sessions:
    /sessions       List all saved conversation sessions
    /load <id>      Load a previously saved session by ID
    /export md      Export conversation as Markdown to ~/.agi/exports/
    /export json    Export conversation as JSON to ~/.agi/exports/
    /clear          Clear the conversation history

  Project:
    /init           Analyze the project and generate/update CLAUDE.md

  Exit:
    /exit, /quit    Exit the agent

  ── Keyboard Shortcuts ──

    Ctrl+C          Interrupt running agent (press again if idle to exit)
    Ctrl+D          Exit the agent
    Ctrl+L          Clear the conversation
    ↑ / ↓           Navigate input history

  ── Agent Tools ──

  File operations:
    readFile        Read files with offset/limit for large files
    writeFile       Create or overwrite files
    editFile        Edit files with exact text replacement (shows diff)
    listFiles       List directory contents
    deleteFile      Delete files
    grep            Search with regex patterns (rg or grep)

  Code & Shell:
    executeCode     Run JavaScript, TypeScript, or Python code
    runCommand      Execute arbitrary shell commands

  Information:
    webSearch       Search the web (Google CSE or Serper.dev)
    dateTime        Get current date and time
    delegate        Spawn sub-agents for parallel/specialized tasks

  Images:
    imageInfo       Get image metadata (format, dimensions, size, alpha)
    imageToBase64   Encode image as base64 data URI

  MCP (Model Context Protocol):
    Configure external tool servers in ~/.agirc.json under "mcpServers".
    Tools from MCP servers appear with a server-name__ prefix.

  ── Display Features ──

    • Markdown rendering (tables with box-drawing borders, code blocks with
      syntax highlighting for JS/TS/Python/Bash/JSON/SQL/Diff)
    • Progressive streaming — completed paragraphs render as styled markdown
      while in-progress text streams character by character
    • Diff view — edits show colored +/- changes with context
    • Cost tracking — per-request and cumulative session cost displayed
      (local/free models tracked as $0.00)
    • Auto-retry — long inputs that fail are automatically retried with
      truncation (keeps start + end, inserts truncation marker)
    • Sessions auto-saved to ~/.agi/sessions/ and restorable

  ── Defaults ──

    Model:    ${model}
    Provider: ${provider}
    Mode:     safe

  ── Environment Variables ──

    DEEPSEEK_API_KEY   API key for the DeepSeek provider
    LMSTUDIO_URL       LM Studio base URL (default: http://localhost:1234/v1)
    AGENT_MODEL        Override the default model name
    PROVIDER           Override default provider (deepseek | lmstudio)
    AGI_MODE           Override default mode (safe | auto)
    AGI_MARKDOWN       Override markdown rendering (true | false)
    SEARCH_BACKEND     Web search backend (google | serper)
    GOOGLE_API_KEY     Google Custom Search API key
    GOOGLE_CSE_ID      Google Custom Search engine ID
    SERPER_API_KEY     Serper.dev API key
    LMNR_PROJECT_API_KEY  Laminar observability (optional)

  ── Config File ──

    Path: ${cfgPath}
    Settings are loaded on startup (env vars override file values).
    Sample:
    {
      "defaultModel": "deepseek-v4-pro",
      "defaultProvider": "deepseek",
      "mode": "safe",
      "markdown": false,
      "lmstudioUrl": "http://localhost:1234/v1",
      "mcpServers": [
        {
          "name": "filesystem",
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
        }
      ]
    }
`);
  process.exit(0);
}

// Connect to MCP servers before rendering the TUI
const cfg = getConfig();
if (cfg.mcpServers.length > 0) {
  connectMCPServers(cfg.mcpServers).then((mcpTools) => {
    addMCPTools(mcpTools);
    const connected = getConnectedServers();
    console.error(`MCP: ${connected.length}/${cfg.mcpServers.length} server(s) connected, ${Object.keys(mcpTools).length} tool(s) available`);
    render(React.createElement(App));
  }).catch((err) => {
    console.error(`MCP: Initialization failed — ${err.message}`);
    render(React.createElement(App));
  });
} else {
  render(React.createElement(App));
}
