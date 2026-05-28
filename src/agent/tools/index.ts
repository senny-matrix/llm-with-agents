import { dateTime } from "./dateTime.ts";
import { deleteFile, listFiles, readFile, writeFile } from "./file.ts";
import { webSearch} from "./webSearch.ts";

// All tools combined for the agent
export const tools = {
    dateTime,
    deleteFile,
    listFiles,
    readFile,
    writeFile,
    webSearch,
};

export { readFile, writeFile, deleteFile, listFiles } from "./file.ts";
export { dateTime } from "./dateTime.ts";
export { webSearch } from "./webSearch.ts";

// export const fileTools = { readFile, writeFile, deleteFile, listFiles }