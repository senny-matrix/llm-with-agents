import "dotenv/config";
import { generateText, type ModelMessage } from "ai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { SYSTEM_PROMPT } from "./system/prompt";
import type { AgentCallbacks } from "../types.ts";

const MODEL_NAME = "deepseek-chat";

const deepseek = createDeepSeek({
  apiKey: process.env.OPENAI_API_KEY,
});

export const runAgent = async (
  userMessage: string,
  conversationHistory: ModelMessage[],
  callBack: AgentCallbacks,
) => {
  console.log("Starting generateText...");

  try {
    const { text } = await generateText({
      model: deepseek.chat(MODEL_NAME),
      prompt: userMessage,
      system: SYSTEM_PROMPT,
    });

    console.log("Response:", text);
  } catch (e) {
    console.error("Error:", e);
  }
};

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (process.argv[1] === __filename) {
  runAgent("Hello friend, can you hear me?", [], {});
}

// Run the code with: 'npx tsx src/agent/run.ts'