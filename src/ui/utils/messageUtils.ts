import type { ModelMessage } from "ai";

/**
 * Extract the text content from a ModelMessage.
 * Handles string content and array-of-parts content.
 */
export function extractAssistantText(msg: ModelMessage): string {
	if (typeof msg.content === "string") return msg.content;
	if (Array.isArray(msg.content)) {
		return msg.content
			.filter(
				(p): p is { type: "text"; text: string } =>
					typeof p === "object" &&
					p !== null &&
					"type" in p &&
					p.type === "text" &&
					"text" in p,
			)
			.map((p) => p.text)
			.join("");
	}
	return "";
}
