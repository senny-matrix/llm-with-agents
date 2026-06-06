import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Project root directory — `@` references resolve relative to this.
 * Uses process.cwd() which is the directory agi was started from.
 * This is a function (not a constant) to avoid module-loading timing issues
 * in the compiled binary. */
function getProjectRoot(): string {
	return process.cwd();
}

/** Simple cache for dirent listings to avoid repeated synchronous I/O on every keystroke.
 * Keyed by resolved absolute directory path, TTL of 5 seconds. */
const dirCache = new Map<string, { entries: string[]; ts: number }>();
const CACHE_TTL = 5_000;

function getCachedDir(resolvedDir: string): string[] | null {
	const cached = dirCache.get(resolvedDir);
	if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.entries;
	return null;
}

function setCachedDir(resolvedDir: string, entries: string[]) {
	dirCache.set(resolvedDir, { entries, ts: Date.now() });
}

export interface CompletionState {
	active: boolean;
	prefix: string;
	cursor: number;
	matches: string[];
	selected: number;
}

/**
 * Resolve a path from an `@` reference.
 * - Absolute paths (`/…`) left alone
 * - `~` paths expanded to home
 * - Relative paths resolved against project root
 */
function resolveProjectPath(path: string): string {
	// Strip leading slash: @/src/file → src/file (relative to project root)
	const normalized = path.startsWith("/") ? path.slice(1) : path;
	if (normalized.startsWith("~")) return expandHome(normalized);
	return join(getProjectRoot(), normalized);
}

/** Expand ~ to home directory */
function expandHome(p: string): string {
	return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

/** Get the directory and partial name from a path prefix */
function splitPrefix(prefix: string): { dir: string; partial: string } {
	const normalized = prefix.replace(/\\/g, "/");
	const lastSep = normalized.lastIndexOf("/");
	if (lastSep === -1) return { dir: ".", partial: normalized };
	return {
		dir: normalized.slice(0, lastSep) || "/",
		partial: normalized.slice(lastSep + 1),
	};
}

/** List files/dirs matching a partial name in a directory */
function listMatches(dir: string, partial: string): string[] {
	try {
		const resolvedDir = resolveProjectPath(dir);
		let entries = getCachedDir(resolvedDir);
		if (!entries) {
			try {
				entries = readdirSync(resolvedDir);
			} catch {
				return [];
			}
			setCachedDir(resolvedDir, entries);
		}
		const results: string[] = [];
		const lowerPartial = partial.toLowerCase();

		for (const entry of entries) {
			if (entry.startsWith(".") && !partial.startsWith(".")) continue;
			if (lowerPartial && !entry.toLowerCase().includes(lowerPartial)) continue;
			try {
				const fullPath = join(resolvedDir, entry);
				const isDir = statSync(fullPath).isDirectory();
				results.push(isDir ? entry + "/" : entry);
			} catch {
				// skip unreadable
			}
		}

		results.sort((a, b) => {
			const aDir = a.endsWith("/");
			const bDir = b.endsWith("/");
			if (aDir !== bDir) return aDir ? -1 : 1;
			return a.localeCompare(b);
		});

		return results.slice(0, 12);
	} catch {
		return [];
	}
}

/** Refresh completion matches based on the current prefix */
export function refreshCompletion(state: CompletionState): CompletionState {
	const { dir, partial } = splitPrefix(state.prefix);
	const matches = listMatches(dir, partial);
	return { ...state, matches, selected: 0 };
}

/** Start a new completion at the given cursor position */
export function startCompletion(cursor: number, prefix: string): CompletionState {
	return refreshCompletion({
		active: true,
		prefix,
		cursor,
		matches: [],
		selected: 0,
	});
}

/** Apply the selected completion */
export function applyCompletion(
	value: string,
	_cursor: number,
	state: CompletionState,
): { value: string; cursor: number } {
	const match = state.matches[state.selected];
	if (!match) return { value, cursor: _cursor };

	const before = value.slice(0, state.cursor); // up to @
	const after = value.slice(_cursor); // after the current prefix
	const withoutPrefix = after.slice(state.prefix.length);

	// Keep the completed path relative to project root
	const { dir } = splitPrefix(state.prefix);
	const relativePath = dir !== "." ? `${dir}/${match}` : match;

	const newValue = before + relativePath + withoutPrefix;
	const newCursor = before.length + relativePath.length;

	return { value: newValue, cursor: newCursor };
}

/** Find @ completion state from the cursor position */
export function findCompletion(value: string, cursor: number): CompletionState | null {
	const beforeCursor = value.slice(0, cursor);
	const atIndex = beforeCursor.lastIndexOf("@");

	if (atIndex === -1) return null;

	// Must be at start of a word
	if (atIndex > 0 && value[atIndex - 1] !== " " && value[atIndex - 1] !== "\n") {
		return null;
	}

	const prefix = beforeCursor.slice(atIndex + 1);
	if (prefix.length === 0) return null;

	return startCompletion(atIndex + 1, prefix);
}

/** Resolve all @path references in a message, replacing them with file content */
export function resolveFileReferences(message: string): string {
	return message.replace(/@(\S+)/g, (match, path) => {
		try {
			const resolved = resolveProjectPath(path);
			const content = readFileContent(resolved);
			if (content !== null) {
				return `<file path="${path}">\n${content}\n</file>`;
			}
		} catch {
			// leave unresolved
		}
		return match;
	});
}

function readFileContent(path: string): string | null {
	try {
		const stats = statSync(path);
		if (!stats.isFile()) return null;
		if (stats.size > 500_000) return null;
		return readFileSync(path, "utf-8");
	} catch {
		return null;
	}
}
