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
  console.log("Testing streamText iteration 2 simulation");

  const messages: any[] = [
    { role: 'system', content: 'You are a helpful AI assistant.' },
    { role: 'user', content: 'List the contents of the current directory.' },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call_123',
          toolName: 'listFiles',
          input: {}
        }
      ]
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call_123',
          toolName: 'listFiles',
          output: {
            type: 'text',
            value: 'The following items are in .:\n[dir] src\n[file] package.json'
          }
        }
      ]
    }
  ];

  try {
    const result = streamText({
      model: deepseek.chat(MODEL_NAME),
      messages,
    });

    for await (const chunk of result.fullStream) {
      console.log("Chunk type:", chunk.type);
    }

    console.log("Awaiting finishReason...");
    const finishReason = await result.finishReason;
    console.log("Finish Reason:", finishReason);

    console.log("Awaiting response...");
    const response = await result.response;
    console.log("Response Messages:", JSON.stringify(response.messages, null, 2));

  } catch (error) {
    console.error("Caught error in iteration 2:", error);
  }
}

main();
