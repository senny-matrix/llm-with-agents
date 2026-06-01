import { tool } from "ai";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

const MAX_OUTPUT_CHARS = 30_000;
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Execute code by writing it to a temp file and running it.
 *
 * Why this instead of runCommand?
 *   - No shell escaping needed — multi-line code with quotes/backticks is safe
 *   - Avoids command-line length limits on large code blocks
 *   - The model provides code + language; the tool handles the file lifecycle
 */
export const executeCode = tool({
  description:
    "Execute code in JavaScript, TypeScript, or Python. Writes the code to a temp file, runs it, returns stdout+stderr, then cleans up. Use this for computation, data processing, or running scripts. Prefer this over runCommand when you have multi-line code — you don't need to worry about shell escaping. Default timeout is 60 seconds. For TypeScript, tsx must be available (npx tsx). For Python, python3 must be on PATH.",
  inputSchema: z.object({
    code: z.string().describe("The code to execute"),
    language: z
      .enum(["javascript", "python", "typescript"])
      .describe("The programming language")
      .default("javascript"),
    timeout: z
      .number()
      .int()
      .positive()
      .max(300_000)
      .default(DEFAULT_TIMEOUT_MS)
      .describe("Timeout in milliseconds (max 5 minutes). Default: 60000"),
  }),
  execute: async ({
    code,
    language,
    timeout = DEFAULT_TIMEOUT_MS,
  }: {
    code: string;
    language: "javascript" | "python" | "typescript";
    timeout?: number;
  }) => {
    const extensions: Record<string, string> = {
      javascript: ".js",
      python: ".py",
      typescript: ".ts",
    };

    const ext = extensions[language];
    const tmpFile = path.join(os.tmpdir(), `code-exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);

    // Resolve the best available runtime
    const runtimes: Record<string, string> = {
      javascript: "node",
      typescript: "npx tsx",
    };

    // Detect Python: prefer python3, fall back to python
    let pythonCmd = "python3";
    try {
      execSync("python3 --version", { stdio: "pipe", timeout: 3000 });
    } catch {
      try {
        execSync("python --version", { stdio: "pipe", timeout: 3000 });
        pythonCmd = "python";
      } catch {
        // Keep python3 default — the error message will be clearer
      }
    }

    try {
      await fs.writeFile(tmpFile, code, "utf-8");

      let command: string;
      let cmdForDisplay: string;
      if (language === "python") {
        command = `${pythonCmd} "${tmpFile}"`;
        cmdForDisplay = `${pythonCmd} ${path.basename(tmpFile)}`;
      } else {
        const runtime = runtimes[language];
        command = `${runtime} "${tmpFile}"`;
        cmdForDisplay = `${runtime} ${path.basename(tmpFile)}`;
      }

      const result = execSync(command, {
        encoding: "utf-8",
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        cwd: process.cwd(), // Run in project directory so relative paths work
        env: { ...process.env }, // Inherit env so the agent's API keys etc. are available
      });

      const output = result.trim();
      if (!output) {
        return "Code executed successfully (no output).";
      }

      const truncated = output.length > MAX_OUTPUT_CHARS
        ? output.slice(0, MAX_OUTPUT_CHARS) + `\n\n... (output truncated at ${MAX_OUTPUT_CHARS} characters. Total: ${output.length})`
        : output;

      return truncated;
    } catch (error) {
      const err = error as NodeJS.ErrnoException & { stdout?: Buffer | string; stderr?: Buffer | string; status?: number | null; killed?: boolean; signal?: NodeJS.Signals | null };

      // Collect any partial output
      const parts: string[] = [];
      if (err.stderr) parts.push(`[stderr]\n${String(err.stderr).trim()}`);
      if (err.stdout) parts.push(`[stdout]\n${String(err.stdout).trim()}`);

      const output = parts.join("\n\n");

      // Friendly error messages for common issues
      if (err.code === "ENOENT") {
        const missing = language === "python" ? "python3" : language === "typescript" ? "tsx (npx tsx)" : "node";
        return `Runtime not found: ${missing} is not available on PATH. Install it and try again.`;
      }

      if (err.killed || err.code === "ETIMEDOUT") {
        return `Code execution timed out after ${timeout}ms.\n\nPartial output:\n${output || "(none)"}`;
      }

      const statusMsg = err.status !== undefined ? ` (exit code ${err.status})` : "";
      return `Code execution failed${statusMsg}:\n\n${output || err.message}`;
    } finally {
      // Clean up temp file
      try {
        await fs.unlink(tmpFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  },
});
