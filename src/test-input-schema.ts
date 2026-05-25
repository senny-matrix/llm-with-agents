import { tool } from 'ai';
import { z } from 'zod';

try {
  const myTool = tool({
    description: 'test',
    inputSchema: z.object({}),
    execute: async () => 'hello',
  } as any);

  console.log("myTool:", myTool);
} catch (error) {
  console.error("Error creating tool with inputSchema:", error);
}
