import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { streamText } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });

const MODEL_NAME = 'deepseek-v4-pro';

const deepseek = createDeepSeek({
  apiKey: process.env.OPENAI_API_KEY,
});

async function main() {
  console.log("Testing streamText with", MODEL_NAME);
  try {
    const result = streamText({
      model: deepseek.chat(MODEL_NAME),
      messages: [{ role: 'user', content: 'Say hello in 3 words.' }],
    });

    for await (const chunk of result.fullStream) {
      console.log("Chunk type:", chunk.type, chunk);
    }
  } catch (error) {
    console.error("Caught error in streamText:", error);
  }
}

main();
