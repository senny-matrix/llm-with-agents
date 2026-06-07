import { Box, Text } from "ink";
import { ThinkingBlock } from "./ThinkingBlock.tsx";

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
}

interface MessageListProps {
  messages: Message[];
  expandedBlocks?: Record<string, boolean>;
  focusedBlockId?: string | null;
}

export function MessageList({ messages, expandedBlocks = {}, focusedBlockId = null }: MessageListProps) {
	return (
		<Box flexDirection="column" gap={1}>
			{messages.map((message, index) => {
				const blockId = `msg-${index}`;
				return (
				<Box key={index} flexDirection="column">
					<Text color={message.role === "user" ? "blue" : "green"} bold>
						{message.role === "user" ? "› You" : "› Assistant"}
					</Text>
					<Box marginLeft={2}>
						<Text>{message.content}</Text>
					</Box>
					{message.role === "assistant" && message.reasoning && (
						<Box marginTop={1}>
							<ThinkingBlock
								reasoning={message.reasoning}
								expanded={!!expandedBlocks[blockId]}
								isFocused={focusedBlockId === blockId}
							/>
						</Box>
					)}
				</Box>
				);
			})}
		</Box>
	);
}
