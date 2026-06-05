import { tool } from "ai";
import shell from "shelljs";
import { z } from "zod";

export const runCommand = tool({
	description:
		"Execute a shell command and return the output. Use this for system operations, running scripts, or interacting with the OS",
	inputSchema: z.object({
		command: z.string().describe("The shell command to execute"),
	}),
	execute: async ({ command }) => {
		const result = shell.exec(command, { silent: true, timeout: 30000 });
		let output = "";
		if (result.stdout) {
			output += result.stdout;
		}
		if (result.stderr) {
			output += `\nError: ${result.stderr}`;
		}

		if (result.code !== 0) {
			return `Error executing command '${command}':
            Exit Code: ${result.code}
            Output: ${output}`;
		}
		return output || "Command executed successfully without any output.";
	},
});
