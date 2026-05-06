import { tool } from "ai";
import { z } from "zod";

export const dateTime = tool({
    description: "Returns the current time and date. Use this tool before any time related task",
    inputSchema: z.object({}),
    execute: async () => {
        return `The current date and time in ISO format is: ${new Date().toISOString()}`;
    }
})