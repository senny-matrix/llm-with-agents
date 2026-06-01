import { tool } from 'ai';
import { z } from 'zod';
import fs from 'node:fs/promises';
import nodePath from 'node:path';
import { spawnSync } from 'node:child_process';

const MAX_READ_LINES = 2000;
const MAX_READ_CHARS = 50_000;

export const readFile = tool({
    description: 'Read the contents of a file. Supports text files and images (jpg, png, gif, webp). For text files, output is truncated to ' + MAX_READ_LINES + ' lines or ' + (MAX_READ_CHARS / 1000) + 'KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.',
    inputSchema: z.object({
        path: z.string().describe('The absolute or relative path to the file to read'),
        offset: z.number().optional().describe('Line number to start reading from (1-indexed). Default: 1'),
        limit: z.number().optional().describe('Maximum number of lines to read. Default: ' + MAX_READ_LINES),
    }),
    execute: async ({ path, offset = 1, limit = MAX_READ_LINES }) => {
        try {
            const content = await fs.readFile(path, 'utf8');
            const lines = content.split('\n');
            const startIdx = Math.max(0, offset - 1);
            const endIdx = Math.min(lines.length, startIdx + limit);
            const sliced = lines.slice(startIdx, endIdx);
            let result = sliced.join('\n');

            // Truncate by characters too
            if (result.length > MAX_READ_CHARS) {
                result = result.slice(0, MAX_READ_CHARS);
                result += `\n\n... (truncated at ${MAX_READ_CHARS} characters. Lines ${offset}-${offset + sliced.length} of ${lines.length} total. Use offset to read more.)`;
            }

            const header = startIdx > 0 || sliced.length < lines.length
                ? `[Lines ${offset}-${offset + sliced.length} of ${lines.length}]\n`
                : '';

            return header + result;
        } catch (e) {
            return `There was an error reading the file. Here is the native error from node.js: ${e}`;
        }
    }
});

export const writeFile = tool({
    description: 'Create or overwrite a file at a specified path. Creates parent directories automatically. Use this for new files or complete rewrites.',
    inputSchema: z.object({
        path: z.string().describe('The absolute or relative path to the file to write'),
        content: z.string().describe('The content to write to the file'),
    }),
    execute: async ({ path, content }) => {
        try {
            const dir = nodePath.dirname(path);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(path, content, { encoding: 'utf8' });
            return `Successfully wrote ${content.length} characters to ${path}`;
        } catch (e) {
            return `Was not able to write the content at ${path}. Here is the node.js error: ${e}`;
        }
    }
});

// Context lines to show before and after each diff hunk
const DIFF_CONTEXT = 2;

/** Generate a unified-diff-style hunk showing oldText → newText in file context */
function generateDiff(
  filePath: string,
  oldText: string,
  newText: string,
  fileContent: string,
  editIndex: number,
): string {
  const lines: string[] = [];
  const fileLines = fileContent.split('\n');

  // Find the line number where oldText appears
  const matchIdx = fileContent.indexOf(oldText);
  if (matchIdx === -1) return '';

  const before = fileContent.slice(0, matchIdx);
  const lineNum = before.split('\n').length;

  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // Lines of context before the change
  const ctxStart = Math.max(1, lineNum - DIFF_CONTEXT);
  const ctxBefore = fileLines.slice(ctxStart - 1, lineNum - 1);

  // Lines of context after the change
  const afterStart = lineNum + oldLines.length - 1;
  const ctxEnd = Math.min(fileLines.length, afterStart + DIFF_CONTEXT);
  const ctxAfter = fileLines.slice(afterStart, ctxEnd);

  // Hunk header
  const oldRange = oldLines.length;
  const newRange = newLines.length;
  const hunkHeader = `@@ -${lineNum},${oldRange} +${lineNum},${newRange} @@`;

  if (editIndex === 0) {
    lines.push(`--- a/${filePath}`);
    lines.push(`+++ b/${filePath}`);
  }
  lines.push(hunkHeader);

  // Context before
  for (const l of ctxBefore) {
    lines.push(` ${l}`);
  }

  // Removed lines
  for (const l of oldLines) {
    lines.push(`-${l}`);
  }

  // Added lines
  for (const l of newLines) {
    lines.push(`+${l}`);
  }

  // Context after
  for (const l of ctxAfter) {
    lines.push(` ${l}`);
  }

  return lines.join('\n');
}

export const editFile = tool({
    description: 'Edit a single file using exact text replacement. Each edit replaces oldText with newText. oldText must match exactly and be unique in the file. Use multiple edits in one call for multiple changes. Keep oldText as small as possible while still being unique.',
    inputSchema: z.object({
        path: z.string().describe('The absolute or relative path to the file to edit'),
        edits: z.array(z.object({
            oldText: z.string().describe('Exact text to replace. Must be unique in the file.'),
            newText: z.string().describe('Replacement text.'),
        })).describe('Array of edits to apply. Each edit is matched against the original file simultaneously.'),
    }),
    execute: async ({ path, edits }) => {
        try {
            const originalContent = await fs.readFile(path, 'utf8');
            let content = originalContent;
            let applied = 0;
            let failed: string[] = [];
            const diffs: string[] = [];

            for (const edit of edits) {
                if (!content.includes(edit.oldText)) {
                    failed.push(`Could not find: "${edit.oldText.slice(0, 80)}${edit.oldText.length > 80 ? '...' : ''}"`);
                    continue;
                }
                const count = content.split(edit.oldText).length - 1;
                if (count > 1) {
                    failed.push(`Found ${count} matches for: "${edit.oldText.slice(0, 80)}${edit.oldText.length > 80 ? '...' : ''}". Text must be unique.`);
                    continue;
                }

                // Generate diff for this edit (against original content for accurate line numbers)
                diffs.push(generateDiff(path, edit.oldText, edit.newText, originalContent, applied));

                content = content.replace(edit.oldText, edit.newText);
                applied++;
            }

            if (applied > 0) {
                await fs.writeFile(path, content, { encoding: 'utf8' });
            }

            // Build result message
            const parts: string[] = [];
            parts.push(`Applied ${applied}/${edits.length} edit(s) to \`${path}\`.`);

            if (failed.length > 0) {
                parts.push(`\nFailures:\n${failed.map(f => `  - ${f}`).join('\n')}`);
            }

            // Show diffs for successful edits
            if (diffs.length > 0) {
                parts.push('\n```diff');
                parts.push(diffs.join('\n'));
                parts.push('```');
            }

            return parts.join('\n');
        } catch (e) {
            return `There was an error editing ${path}. Here is the node.js error: ${e}`;
        }
    }
});

export const grep = tool({
    description: 'Search for a pattern in files within a directory. Like rg/grep. Returns matching lines with file paths and line numbers.',
    inputSchema: z.object({
        pattern: z.string().describe('The regex pattern to search for'),
        path: z.string().optional().default('.').describe('Directory path to search in (default: current directory)'),
        include: z.string().optional().describe('File glob pattern to include (e.g., "*.ts", "*.{ts,tsx}")'),
    }),
    execute: async ({ pattern, path: dir = '.', include }) => {
        // Try ripgrep first, fall back to grep
        const rg = spawnSync('rg', [
            '--line-number', '--no-heading', '--color', 'never',
            ...(include ? ['--glob', include] : []),
            pattern, dir,
        ], { encoding: 'utf8', timeout: 15000 });

        let out: string;
        let err: string;
        let exitCode: number;

        if (rg.error && (rg.error as NodeJS.ErrnoException).code === 'ENOENT') {
            // rg not found, fall back to grep -r
            const g = spawnSync('grep', ['-rn', '--include=' + (include || '*'), pattern, dir], {
                encoding: 'utf8',
                timeout: 15000,
            });
            out = g.stdout || '';
            err = g.stderr || '';
            exitCode = g.status ?? 1;
        } else {
            out = rg.stdout || '';
            err = rg.stderr || '';
            exitCode = rg.status ?? 1;
        }

        if (exitCode === 1 && !out.trim()) {
            return `No matches found for pattern "${pattern}" in ${dir}`;
        }
        if (exitCode !== 0 && exitCode !== 1) {
            return `Search error: ${err || out}`;
        }

        const lines = out.trim().split('\n').filter(l => l);
        const maxResults = 50;
        const truncated = lines.length > maxResults;
        const results = lines.slice(0, maxResults);

        let result = results.join('\n');

        if (truncated) {
            result += `\n\n... (${lines.length - maxResults} more results. Narrow your search pattern.)`;
        }
        return result || `No matches found for pattern "${pattern}" in ${dir}`;
    }
});

export const listFiles = tool({
    description: 'List all the files and directories in the specified directory path',
    inputSchema: z.object({
        directory: z
            .string()
            .describe('The directory path to list the contents of')
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
        path: z.string().describe('The absolute or relative path to the file you want to delete'),
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