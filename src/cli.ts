#!/usr/bin/env node
import "dotenv/config";
import React from "react";
import { render } from "ink";
import { App } from "./ui/index.tsx";
import { getCurrentModelName, getCurrentProvider } from "./agent/run.ts";
import { getConfig } from "./agent/config.ts";
import { connectMCPServers, getConnectedServers } from "./agent/mcp/index.ts";
import { addMCPTools } from "./agent/tools/index.ts";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  const model = getCurrentModelName();
  const provider = getCurrentProvider();
  console.log(`
  agi — an AI coding agent for your terminal

  Usage:
    agi [options]

  Options:
    -h, --help      Show this help message and exit

  Once running, type your messages to chat with the agent.

  In-app commands:
    /auto           Auto-approve all tool calls without confirmation
    /safe           Require approval for each tool call (default)
    /md             Toggle rendered markdown output
    /raw            Toggle raw (plain-text) markdown output
    /clear          Clear the conversation history
    /model          Show the current model
    /model <name>   Switch to a different model at runtime
    /provider       Show the current provider
    /provider <p>   Switch provider (deepseek | lmstudio)
    /exit, /quit    Exit the agent
    /sessions       List all saved conversation sessions
    /load <id>      Load a previously saved session by ID
    /export md      Export conversation as Markdown
    /export json    Export conversation as JSON

  Keyboard shortcuts:
    Ctrl+C          Interrupt running agent (press again if idle to exit)
    Ctrl+D          Exit the agent
    Ctrl+L          Clear the conversation
    ↑ / ↓           Navigate input history

  Auto-retry: When input is too long, the agent automatically retries
    with a truncated version of your message.

  Image tools:
    imageInfo        Get image metadata (format, dimensions, size)
    imageToBase64    Encode image as base64 data URI

  Defaults:
    Model:    ${model}
    Provider: ${provider}
    Mode:     safe

  Environment:
    DEEPSEEK_API_KEY   API key for the DeepSeek provider
    LMSTUDIO_URL       LM Studio base URL (default: http://localhost:1234/v1)
    AGENT_MODEL        Override the default model name
    AGI_MODE           Override default mode (safe | auto)
    AGI_MARKDOWN       Override markdown rendering (true | false)

  Config file (~/.agirc.json):
    Settings are loaded from ~/.agirc.json on startup (env vars override).
    Sample config:
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
          "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"]
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
