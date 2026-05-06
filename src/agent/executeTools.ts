import {tools} from "./tools/index.ts";

export type ToolName = keyof typeof tools;

export const executeTool = async (name: ToolName, args: any) => {
    const tool = tools[name];
    if (!tool) {
        return 'Unknown tool, this does not exists';
    }
    const execute = tool.execute;

    if (!execute) {
        return 'This tool does not have an execute function and not registered tool';
    }

    const result =  await tool.execute(args, {
        toolCallId: '',
        messages: [],
    });

    return String(result);
}