import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { streamText } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { listFiles } from './agent/tools/file.ts';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });

const MODEL_NAME = 'deepseek-v4-pro';

const deepseek = createDeepSeek({
  apiKey: process.env.OPENAI_API_KEY,
});

async function main() {
  console.log("Testing streamText with real listFiles from tools");
  try {
    const result = streamText({
      model: deepseek.chat(MODEL_NAME),
      messages: [{ role: 'user', content: 'List the contents of the current directory.' }],
      tools: { listFiles }
    });

    for await (const chunk of result.fullStream) {
      console.log("Chunk type:", chunk.type);
    }
  } catch (error) {
    console.error("Caught error with real listFiles:", error);
  }
}

main();
