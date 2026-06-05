import type { ToolSet } from "ai";
import { dateTime } from "./dateTime.ts";
import { deleteFile, listFiles, readFile, writeFile, editFile, grep } from "./file.ts";
import { webSearch } from "./webSearch.ts";
import { runCommand } from "./shell.ts";
import { delegate } from "./delegate.ts";
import { executeCode } from "./executeCode.ts";
import { imageInfo, imageToBase64 } from "./image.ts";

// All tools combined for the agent
// MCP tools are added dynamically via addMCPTools() before agent runs
export const tools: ToolSet = {
    dateTime,
    readFile,
    writeFile,
    editFile,
    listFiles,
    deleteFile,
    grep,
    webSearch,
    runCommand,
    executeCode,
    imageInfo,
    imageToBase64,
    delegate,
};

/** Add dynamically discovered MCP tools to the global tools map */
export function addMCPTools(
  mcpTools: Record<string, unknown>,
): void {
  Object.assign(tools, mcpTools);
}

export const readOnlyTools = { readFile, listFiles, grep, dateTime, webSearch };
export const fileTools = { readFile, writeFile, editFile, deleteFile, listFiles, grep };
export const shellTool = { runCommand };
export const codeTool = { executeCode };
export const imageTools = { imageInfo, imageToBase64 };