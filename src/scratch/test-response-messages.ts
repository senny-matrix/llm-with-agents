import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDeepSeek } from '@ai-sdk/deepseek';
import { streamText } from 'ai';
import { config } from 'dotenv';

import { listFiles } from '../agent/tools/file.ts';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

const MODEL_NAME = 'deepseek-v4-pro';

const deepseek = createDeepSeek({
  apiKey: process.env.OPENAI_API_KEY,
});

async function main() {
  console.log("Testing streamText response messages");
  try {
    const result = streamText({
      model: deepseek.chat(MODEL_NAME),
      messages: [{ role: 'user', content: 'List the contents of the current directory.' }],
      tools: { listFiles }
    });

    const response = await result.response;
    console.log("Response messages from SDK:", JSON.stringify(response.messages, null, 2));
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
