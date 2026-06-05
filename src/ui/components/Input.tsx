import { Box, Text, useInput } from "ink";
import React, { useRef, useState } from "react";

interface InputProps {
	onSubmit: (value: string) => void;
	disabled?: boolean;
	/** History of previously submitted inputs (newest first) */
	history?: string[];
}

export function Input({
	onSubmit,
	disabled = false,
	history = [],
}: InputProps) {
	const [value, setValue] = useState("");
	const historyIndex = useRef(-1);
	// Snapshot the value the user was typing before navigating into history
	const draftBeforeHistory = useRef("");

	useInput((input, key) => {
		if (disabled) return;

		// ── History navigation (up/down arrows) ──
		if (key.upArrow && history.length > 0) {
			// If we're not in history yet, save the current draft
			if (historyIndex.current === -1) {
				draftBeforeHistory.current = value;
			}
			const next = Math.min(historyIndex.current + 1, history.length - 1);
			historyIndex.current = next;
			setValue(history[next]);
			return;
		}

		if (key.downArrow && historyIndex.current >= 0) {
			const prev = historyIndex.current - 1;
			if (prev < 0) {
				// Back to the draft the user was typing
				historyIndex.current = -1;
				setValue(draftBeforeHistory.current);
			} else {
				historyIndex.current = prev;
				setValue(history[prev]);
			}
			return;
		}

		// Any other input resets history navigation
		if (historyIndex.current !== -1 && !key.upArrow && !key.downArrow) {
			historyIndex.current = -1;
		}

		// ── Submit on Enter (without Shift) ──
		if (key.return && !key.shift) {
			if (value.trim()) {
				onSubmit(value);
				setValue("");
				historyIndex.current = -1;
			}
			return;
		}

		// ── Newline on Shift+Enter ──
		if (key.return && key.shift) {
			setValue((prev) => prev + "\n");
			return;
		}

		// ── Editing ──
		if (key.backspace || key.delete) {
			setValue((prev) => prev.slice(0, -1));
			return;
		}

		if (input && !key.ctrl && !key.meta) {
			setValue((prev) => prev + input);
		}
	});

	const lines = value.split("\n");
	const lastLine = lines[lines.length - 1];
	const prevLines = lines.slice(0, -1);

	return (
		<Box flexDirection="column">
			<Box>
				<Text color="blue" bold>
					{"> "}
				</Text>
				{prevLines.length > 0 ? (
					<Box flexDirection="column">
						{prevLines.map((l, i) => (
							<Text key={i}>{l}</Text>
						))}
						<Box>
							<Text>{lastLine}</Text>
							{!disabled && <Text color="gray">▌</Text>}
						</Box>
					</Box>
				) : (
					<>
						<Text>{lastLine}</Text>
						{!disabled && <Text color="gray">▌</Text>}
					</>
				)}
			</Box>
			{prevLines.length > 0 && !disabled && (
				<Box>
					<Text dimColor>Shift+Enter for newline • Enter to send</Text>
				</Box>
			)}
		</Box>
	);
}
