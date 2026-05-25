import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { streamText } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { listFiles } from '../agent/tools/file.ts';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

const MODEL_NAME = 'deepseek-v4-pro';

const deepseek = createDeepSeek({
  apiKey: process.env.OPENAI_API_KEY,
});

async function main() {
  console.log("Testing streamText without execute function");
  
  // Strip execute function
  const { execute, ...listFilesNoExecute } = listFiles;
  
  try {
    const result = streamText({
      model: deepseek.chat(MODEL_NAME),
      messages: [{ role: 'user', content: 'List the contents of the current directory.' }],
      tools: { listFiles: listFilesNoExecute }
    });

    const response = await result.response;
    console.log("Response messages from SDK:", JSON.stringify(response.messages, null, 2));
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
