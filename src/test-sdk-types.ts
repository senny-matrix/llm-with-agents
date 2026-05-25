import { type ModelMessage } from 'ai';

const assistantMessage: ModelMessage = {
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

const toolMessage: ModelMessage = {
  role: 'tool',
  content: [
    {
      type: 'tool-result',
      toolCallId: 'call_123',
      toolName: 'listFiles',
      result: 'success'
    }
  ]
};

console.log("ModelMessage is compatible!", assistantMessage, toolMessage);
