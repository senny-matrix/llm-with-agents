import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { ModelMessage } from "ai";

const EXPORT_DIR = resolve(homedir(), ".agi", "exports");

function ensureDir() {
  if (!existsSync(EXPORT_DIR)) {
    mkdirSync(EXPORT_DIR, { recursive: true });
  }
}

/**
 * Export a conversation as a Markdown file.
 * Produces clean, readable output suitable for sharing or archiving.
 */
export function exportMarkdown(
  messages: ModelMessage[],
  sessionId: string,
): string {
  ensureDir();

  const lines: string[] = [];
  lines.push(`# AGI Conversation`);
  lines.push("");
  lines.push(`**Session:** \`${sessionId}\``);
  lines.push(`**Exported:** ${new Date().toISOString().slice(0, 19).replace("T", " ")}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const msg of messages) {
    const role = msg.role;
    const content = extractContent(msg);
    if (!content) continue;

    lines.push(`## ${role.charAt(0).toUpperCase() + role.slice(1)}`);
    lines.push("");
    lines.push(content);
    lines.push("");
  }

  const outPath = resolve(EXPORT_DIR, `${sessionId}.md`);
  writeFileSync(outPath, lines.join("\n"), "utf-8");
  return outPath;
}

/**
 * Export a conversation as a JSON file.
 * Contains the raw ModelMessage array with full metadata.
 */
export function exportJSON(
  messages: ModelMessage[],
  sessionId: string,
): string {
  ensureDir();

  const data = {
    exportedAt: new Date().toISOString(),
    sessionId,
    messageCount: messages.length,
    messages,
  };

  const outPath = resolve(EXPORT_DIR, `${sessionId}.json`);
  writeFileSync(outPath, JSON.stringify(data, null, 2), "utf-8");
  return outPath;
}

/**
 * Extract readable text from a ModelMessage.
 */
function extractContent(msg: ModelMessage): string {
  if (typeof msg.content === "string") return msg.content;

  if (Array.isArray(msg.content)) {
    const parts: string[] = [];
    for (const part of msg.content) {
      if (typeof part === "string") {
        parts.push(part);
      } else if (part && typeof part === "object" && "type" in part) {
        if (part.type === "text" && "text" in part) {
          parts.push(part.text as string);
        } else if (part.type === "tool-call" && "toolName" in part) {
          const args =
            "input" in part && part.input
              ? `\`${JSON.stringify(part.input).slice(0, 200)}\``
              : "";
          parts.push(`[Tool call: **${part.toolName}** ${args}]`);
        } else if (part.type === "tool-result" && "toolName" in part) {
          const output =
            "output" in part && part.output && typeof part.output === "object" && "value" in part.output
              ? (part.output as { value: string }).value.slice(0, 500)
              : "";
          parts.push(`[Tool result: **${(part as { toolName: string }).toolName}** \`\`\`${output}\`\`\`]`);
        }
      }
    }
    return parts.join("\n\n");
  }

  return "";
}
