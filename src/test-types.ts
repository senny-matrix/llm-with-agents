import { tool } from 'ai';
import { z } from 'zod';

const myTool = tool({
  description: 'test',
  inputSchema: z.object({}),
  execute: () => 'hello',
});

console.log("myTool has parameters:", 'parameters' in myTool, (myTool as any).parameters);
console.log("myTool has inputSchema:", 'inputSchema' in myTool, (myTool as any).inputSchema);
