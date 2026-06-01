import { dateTime } from "./dateTime.ts";
import { deleteFile, listFiles, readFile, writeFile, editFile, grep } from "./file.ts";
import { webSearch} from "./webSearch.ts";
import { runCommand } from "./shell.ts";

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
};

export const readOnlyTools = { readFile, listFiles, grep, dateTime, webSearch };
export const fileTools = { readFile, writeFile, editFile, deleteFile, listFiles, grep };
export const shellTool = { runCommand };