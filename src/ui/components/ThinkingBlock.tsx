import { Box, Text } from "ink";

interface ThinkingBlockProps {
	reasoning: string;
	expanded: boolean;
	isFocused?: boolean;
	onToggle?: () => void;
}

export function ThinkingBlock({ reasoning, expanded, isFocused = false }: ThinkingBlockProps) {
	const lines = reasoning.trim().split("\n");
	const displayText = expanded ? reasoning : lines[0]?.slice(0, 80) + (lines.length > 1 ? " …" : "");

	return (
		<Box flexDirection="column" marginLeft={2}>
			{/* Header — always visible */}
			<Box>
				<Text color={isFocused ? "cyan" : "yellow"} bold>
					{isFocused ? "▸ " : "  "}
					{expanded ? "🤔 ▼ Thinking" : "🤔 ▶ Thinking"}
				</Text>
				<Text dimColor>
					{" "}
					({reasoning.length} chars{expanded ? "" : ", Enter to expand"})
				</Text>
			</Box>
			{/* Body — only when expanded */}
			{expanded && (
				<Box marginLeft={4} marginTop={1}>
					<Text dimColor>{displayText}</Text>
				</Box>
			)}
		</Box>
	);
}
