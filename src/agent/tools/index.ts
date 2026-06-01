import { dateTime } from "./dateTime.ts";
import { deleteFile, listFiles, readFile, writeFile, editFile, grep } from "./file.ts";
import { webSearch } from "./webSearch.ts";
import { runCommand } from "./shell.ts";
import { delegate } from "./delegate.ts";
import { executeCode } from "./executeCode.ts";
import { imageInfo, imageToBase64 } from "./image.ts";

// All tools combined for the agent
export const tools = {
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

export const readOnlyTools = { readFile, listFiles, grep, dateTime, webSearch };
export const fileTools = { readFile, writeFile, editFile, deleteFile, listFiles, grep };
export const shellTool = { runCommand };
export const codeTool = { executeCode };
export const imageTools = { imageInfo, imageToBase64 };