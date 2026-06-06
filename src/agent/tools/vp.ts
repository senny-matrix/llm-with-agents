import { tool } from "ai";
import { exec } from "node:child_process";
import { z } from "zod";

const VP_INSTALL_TIMEOUT_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 60_000;

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

/** Check if vp is available on the PATH */
async function isVpInstalled(): Promise<boolean> {
	const { code } = await execAsync("vp --version", 5_000);
	return code === 0;
}

/** Install vp globally using the best available package manager */
async function installVp(): Promise<string> {
	const pmChecks = [
		{ cmd: "bun", install: "bun install -g vp" },
		{ cmd: "pnpm", install: "pnpm add -g vp" },
		{ cmd: "npm", install: "npm install -g @viteplus/vp" },
	];

	for (const { cmd, install } of pmChecks) {
		const { code } = await execAsync(`which ${cmd}`, 3_000);
		if (code === 0) {
			const result = await execAsync(install, VP_INSTALL_TIMEOUT_MS);
			if (result.code === 0) return `✅ Installed vp via \`${cmd}\``;
			return `❌ Failed to install vp using ${cmd}: ${result.stderr || result.stdout}`;
		}
	}

	return "❌ No supported package manager found (bun, pnpm, npm). Install vp manually: `npm install -g @viteplus/vp`";
}

/**
 * vp — Vite+ project management tool.
 *
 * Use this tool to create, manage, and develop JavaScript/TypeScript projects
 * using Vite+ (vp). It auto-installs vp if not present on the system.
 */
export const vpTool = tool({
	description: `Manage JavaScript/TypeScript projects with Vite+ (vp).

Key operations:
  create <project-name> [template] — Create a new project (templates: react, next, express, api, lib, app, default)
  install [packages...]            — Install all deps, or add specific packages
  add <packages...>                — Add dependencies
  remove <packages...>             — Remove packages
  dev                              — Start dev server
  build                            — Build for production
  check                            — Run format + lint + type checks
  lint                             — Lint code
  fmt                              — Format code
  test                             — Run tests
  run <task>                       — Run a project task

Auto-installs vp if not detected on the system.`,
	inputSchema: z.object({
		operation: z
			.enum([
				"create",
				"install",
				"add",
				"remove",
				"dev",
				"build",
				"check",
				"lint",
				"fmt",
				"test",
				"run",
			])
			.describe("The vp operation to perform"),
		args: z
			.array(z.string())
			.optional()
			.describe("Additional arguments (e.g. project name, package names, template)"),
	}),
	execute: async ({ operation, args = [] }) => {
		// 1. Ensure vp is installed
		if (!(await isVpInstalled())) {
			const installResult = await installVp();
			if (!installResult.startsWith("✅")) {
				return installResult;
			}
			if (!(await isVpInstalled())) {
				return "❌ vp was installed but is not on PATH. Try restarting your terminal, or use runCommand to install it manually.";
			}
		}

		// 2. Build and run the command
		const argStr = args.length > 0 ? ` ${args.map((a) => `"${a}"`).join(" ")}` : "";
		const command = `vp ${operation}${argStr}`;
		const { stdout, stderr, code } = await execAsync(command);

		let output = stdout;
		if (stderr) {
			output += `\n${stderr}`;
		}

		if (code !== 0) {
			return `Error running \`${command}\`:\nExit Code: ${code}\n${output}`;
		}

		return output || `✅ \`vp ${operation}\` completed successfully.`;
	},
});
