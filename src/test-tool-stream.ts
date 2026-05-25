import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { streamText } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { z } from 'zod';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });

const MODEL_NAME = 'deepseek-v4-pro';

const deepseek = createDeepSeek({
  apiKey: process.env.OPENAI_API_KEY,
});

async function main() {
  console.log("Testing streamText with tools and", MODEL_NAME);
  try {
    const result = streamText({
      model: deepseek.chat(MODEL_NAME),
      messages: [{ role: 'user', content: 'List the contents of the current directory.' }],
      tools: {
        listFiles: {
          description: 'List all the files and directories in the specified directory path',
          inputSchema: z.object({
            directory: z.string().default('.'),
          }),
        }
      }
    });

    for await (const chunk of result.fullStream) {
      console.log("Chunk type:", chunk.type, chunk);
    }

    console.log("Awaiting finishReason...");
    const finishReason = await result.finishReason;
    console.log("Finish Reason:", finishReason);

    console.log("Awaiting response...");
    const response = await result.response;
    console.log("Response Messages:", JSON.stringify(response.messages, null, 2));

  } catch (error) {
    console.error("Caught error in main streamText:", error);
  }
}

main();
