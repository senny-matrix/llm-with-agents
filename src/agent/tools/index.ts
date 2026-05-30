import { dateTime } from "./dateTime.ts";
import { deleteFile, listFiles, readFile, writeFile } from "./file.ts";
import { webSearch} from "./webSearch.ts";
import { runCommand } from "./shell.ts";

// All tools combined for the agent
export const tools = {
    dateTime,
    deleteFile,
    listFiles,
    readFile,
    writeFile,
    webSearch,
    runCommand,
};

export const fileTools = { readFile, writeFile, deleteFile, listFiles };
export const dateTimeTool = { dateTime };
export const webSearchTool = { webSearch };
export const shellTool = { runCommand };

export { webSearch } from "./webSearch.ts";
export { runCommand } from "./shell.ts";

// export const fileTools = { readFile, writeFile, deleteFile, listFiles }