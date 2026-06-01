import { createDeepSeek } from '@ai-sdk/deepseek';

let instance: ReturnType<typeof createDeepSeek> | null = null;

export function getDeepSeekProvider() {
  if (!instance) {
    instance = createDeepSeek({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return instance;
}
