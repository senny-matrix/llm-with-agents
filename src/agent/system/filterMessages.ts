import type { ModelMessage } from "ai";

interface ContentPart {
	type?: string;
	text?: string;
	toolCallId?: string;
}

/**
 * Filter conversation history to only include compatible message formats.
 * Provider tools (like webSearch) may return messages with formats that
 * cause issues when passed back to subsequent API calls.
 *
 * The filter:
 * - Keeps user, system messages as-is.
 * - Keeps assistant messages that have text content OR tool-call parts.
 * - Drops tool result messages whose preceding assistant tool-call was filtered out.
 */
export const filterCompatibleMessages = (
	messages: ModelMessage[],
): ModelMessage[] => {
	// First pass: filter individual messages
	const filtered = messages.filter((msg) => {
		if (msg.role === "user" || msg.role === "system") return true;

		if (msg.role === "assistant") {
			const content = msg.content;
			if (typeof content === "string" && content.trim()) return true;
			if (Array.isArray(content)) {
				// Keep if it has text content OR tool-call parts
				const hasContent = content.some((part: unknown) => {
					const p = part as ContentPart;
					if (typeof part === "string" && part.trim()) return true;
					if (p?.type === "tool-call") return true;
					if (p?.text && p.text.trim()) return true;
					return false;
				});
				return hasContent;
			}
		}

		if (msg.role === "tool") return true;

		return false;
	});

	// Second pass: drop orphaned tool messages by tracking expected tool-call IDs
	const activeToolCallIds = new Set<string>();
	const result: ModelMessage[] = [];
	for (const msg of filtered) {
		if (msg.role === "tool" && Array.isArray(msg.content)) {
			const toolCallIds = msg.content
				.map((p: unknown) => (p as ContentPart)?.toolCallId)
				.filter(Boolean) as string[];
			// Only keep if ALL tool-call IDs are expected
			if (toolCallIds.some((id) => !activeToolCallIds.has(id))) continue;
			// Remove consumed IDs
			for (const id of toolCallIds) activeToolCallIds.delete(id);
			result.push(msg);
		} else if (msg.role === "assistant" && Array.isArray(msg.content)) {
			// Collect tool-call IDs from this assistant message
			for (const part of msg.content) {
				const p = part as ContentPart;
				if (p?.type === "tool-call" && p.toolCallId) {
					activeToolCallIds.add(p.toolCallId);
				}
			}
			result.push(msg);
		} else {
			result.push(msg);
		}
	}

	return result;
};
