import { tool } from 'ai';
import { z } from 'zod';
import fs from 'node:fs/promises';
import nodePath from 'node:path';
import type { ToolName } from "../executeTools.ts";

export const readFile = tool({
    description: 'Read the full content of the file at a given path, always use this to read a file',
    inputSchema: z.object({
        path: z.string().describe('The absolute or relative path to the file to read'),
    }),
    execute: async ({ path }) => {
        try {
            const content = await fs.readFile(path, 'utf8');
            return content.toString();
        } catch (e) {
            return `There was an error reading the file. Here is the native error from node.js: {e}`;
        }
    }
});

export const writeFile = tool({
    description: 'Write content to a file at a specified given path. Create the file if it does not exist and will overwrite if it does.',
    inputSchema: z.object({
        path: z.string().describe('The absolute or relative path to the file to write'),
        content: z.string().describe('The content to write to the file'),
    }),
    execute: async ({ path, content }) => {
        try {
            const dir = nodePath.dirname(path);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(path, content, { encoding: 'utf8' });
            return `Successfully wrote ${content.length} characters to ${path}`
        } catch (e) {
            return `Was not able to write the content at ${path}. Here is the node.js error: ${e}`;
        }
    }
});

export const listFiles = tool({
    description: 'List all the files and directories in the specified directory path',
    inputSchema: z.object({
        directory: z
            .string()
            .describe('The dirctory path to list the contents of')
            .default('.'),
    }),
    execute: async ({ directory }) => {
        try {
            const entries = await fs.readdir(directory, { withFileTypes: true });
            const items = entries.map(entry => {
                const type = entry.isDirectory() ? '[dir]' : '[file]';
                return `${type} ${entry.name}`;
            });
            return items.length > 0
                ? `The following items are in ${directory}:\n${items.sort().join('\n')}`
                : `The directory ${directory} appears to be empty.`;
        } catch (e) {
            return `There was an error listing the contents of ${directory}. Here is the node.js error: ${e}`;
        }
    }
})

export const deleteFile = tool({
    description: 'Delete the file at the specified given path. Use with caution as this is very destructive and can not be undone.',
    inputSchema: z.object({
        path: z.string().describe('The absolute or relative path to the file you wantto delete'),
    }),
    execute: async ({ path }) => {
        try {
            await fs.unlink(path);
            return `Successfully deleted the file at ${path}`;
        } catch (e) {
            return `There was an error deleting the file at ${path}. Here is the node.js error: ${e}`;
        }
    }
})