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

  Defaults:
    Model:    ${model}
    Provider: ${provider}
    Mode:     safe

  Environment:
    DEEPSEEK_API_KEY   API key for the DeepSeek provider
    LMSTUDIO_URL       LM Studio base URL (default: http://localhost:1234/v1)
    AGENT_MODEL        Override the default model name
`);
  process.exit(0);
}

render(React.createElement(App));
