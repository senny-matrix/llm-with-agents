#!/usr/bin/env node
import "dotenv/config";
import React from "react";
import { render } from "ink";
import { App } from "./ui/index.tsx";
import { getCurrentModelName, getCurrentProvider } from "./agent/run.ts";

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

  Keyboard shortcuts:
    Ctrl+C          Interrupt running agent (press again if idle to exit)
    Ctrl+D          Exit the agent
    Ctrl+L          Clear the conversation
    ↑ / ↓           Navigate input history

<<<<<<< HEAD
  Auto-retry: When input is too long, the agent automatically retries
    with a truncated version of your message.

  Image tools:
    imageInfo        Get image metadata (format, dimensions, size)
    imageToBase64    Encode image as base64 data URI

||||||| e9a49a1
=======
  Image tools:
    imageInfo        Get image metadata (format, dimensions, size)
    imageToBase64    Encode image as base64 data URI

>>>>>>> 26-reading_images
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
      "lmstudioUrl": "http://localhost:1234/v1"
    }
`);
  process.exit(0);
}

render(React.createElement(App));
