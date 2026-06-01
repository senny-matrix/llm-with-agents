import { tools } from "./tools/index.ts";

export type ToolName = keyof typeof tools;

export const executeTool = async (name: ToolName, args: unknown): Promise<string> => {
    const tool = tools[name];
    if (!tool) {
        return `Unknown tool "${name}". Available tools: ${Object.keys(tools).join(', ')}`;
    }

    if (!tool.execute) {
        return `Tool "${name}" does not have an execute function.`;
    }

    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (tool.execute as any)(args, {
            toolCallId: '',
            messages: [],
        });
        return String(result);
    } catch (e) {
        return `Error executing tool "${name}": ${e instanceof Error ? e.message : String(e)}`;
    }
};