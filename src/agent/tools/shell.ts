import { tool } from "ai";
import { exec } from "node:child_process";
import { z } from "zod";

const DEFAULT_TIMEOUT_MS = 30_000;

function execAsync(
	command: string,
	timeout: number = DEFAULT_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
	return new Promise((resolve) => {
		exec(command, { timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
			resolve({
				stdout: stdout?.trim() || "",
				stderr: stderr?.trim() || "",
				code: error ? (error as NodeJS.ErrnoException & { code?: number }).code ?? 1 : 0,
			});
		});
	});
}

export const runCommand = tool({
	description:
		"Execute a shell command and return the output. Use this for system operations, running scripts, or interacting with the OS",
	inputSchema: z.object({
		command: z.string().describe("The shell command to execute"),
	}),
	execute: async ({ command }) => {
		const { stdout, stderr, code } = await execAsync(command);

		let output = stdout;
		if (stderr && code !== 0) {
			output += `\nError: ${stderr}`;
		} else if (stderr) {
			// stderr with exit code 0 is informational (e.g. git's "Switched to branch")
			output += `\n${stderr}`;
		}

		if (code !== 0) {
			return `Error executing command '${command}':
            Exit Code: ${code}
            Output: ${output}`;
		}
		return output || "Command executed successfully without any output.";
	},
});
