// import { dateTime } from "./dateTime.ts";
import { deleteFile, listFiles, readFile, writeFile } from "./file.ts";

// All tools combined for the agent
export const tools = {
    // dateTime,
    deleteFile,
    listFiles,
    readFile,
    writeFile,
};

export { readFile, writeFile, deleteFile, listFiles } from "./file.ts";

// export const fileTools = { readFile, writeFile, deleteFile, listFiles }