import { streamText } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';

const msg1: any = {
  role: 'assistant',
  content: [
    {
      type: 'tool-call',
      toolCallId: 'call_123',
      toolName: 'listFiles',
      args: {}
    }
  ]
};

console.log("msg1 defined.");
