import 'dotenv/config';
import { generateText, stepCountIs, type ModelMessage } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { getTracer, Laminar } from '@lmnr-ai/lmnr';
import { SYSTEM_PROMPT } from './system/prompt.ts';
import type { AgentCallbacks } from '../types.ts';
import { tools } from './tools/index.ts';
import { executeTool, type ToolName } from './executeTools.ts';

const MODEL_NAME = 'deepseek-v4-pro';

const deepseek = createDeepSeek({
  apiKey: process.env.OPENAI_API_KEY,
});

Laminar.initialize({
  projectApiKey: process.env.LMNR_PROJECT_API_KEY || '',
});

export const runAgent = async (
  userMessage: string,
  conversationHistory: ModelMessage[],
  callBack: AgentCallbacks,
) => {
  console.log('Starting generateText...');

  try {
    const { text, toolCalls } = await generateText({
      model: deepseek.chat(MODEL_NAME),
      prompt: userMessage,
      system: SYSTEM_PROMPT,
      tools,
      //   temperature: 0.7,
      //   stopWhen: stepCountIs(2),
      experimental_telemetry: {
        isEnabled: true,
        tracer: getTracer(),
      },
    });

    console.log('Response:', text, toolCalls);
    // await Laminar.flush();
    console.log('Done!');

    toolCalls.forEach(async (tc) => {
      console.log(await executeTool(tc.toolName as ToolName, tc.input));
    });
  } catch (e) {
    console.error('Error:', e);
  }
};

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (process.argv[1] === __filename) {
  runAgent('What is the current time right now?', [], {});
}

// Run the code with: 'npx tsx src/agent/run.ts'
