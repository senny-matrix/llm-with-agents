import { Box, Text, useInput } from "ink";
import React, { useRef, useState } from "react";
import {
	type CompletionState,
	applyCompletion,
	findCompletion,
} from "../utils/fileCompletion.ts";

interface InputProps {
	onSubmit: (value: string) => void;
	disabled?: boolean;
	history?: string[];
}

interface InputState {
	value: string;
	cursor: number;
}

export function Input({
	onSubmit,
	disabled = false,
	history = [],
}: InputProps) {
	const s = useRef<InputState>({ value: "", cursor: 0 });
	const [tick, setTick] = useState(0);
	const rerender = () => setTick((t) => t + 1);
	const completion = useRef<CompletionState | null>(null);

	const historyIndex = useRef(-1);
	const draftBeforeHistory = useRef("");
	const onSubmitRef = useRef(onSubmit);
	onSubmitRef.current = onSubmit;

	const setVal = (v: string, c: number) => {
		s.current.value = v;
		s.current.cursor = c;
		rerender();
	};

	const checkCompletion = (val: string, cur: number) => {
		const found = findCompletion(val, cur);
		completion.current = found;
	};

	useInput((_input, key) => {
		if (disabled) return;
		const { value: curVal, cursor: curPos } = s.current;

		// ── Tab: accept completion ──
		if (key.tab) {
			if (completion.current?.active && completion.current.matches.length > 0) {
				const { value: newVal, cursor: newCur } = applyCompletion(
					curVal,
					curPos,
					completion.current,
				);
				setVal(newVal, newCur);
				completion.current = null;
				return;
			}
			// In @ context but no matches — clear stale state
			if (completion.current?.active) {
				completion.current = null;
			}
			return;
		}

		// ── History navigation ──
		if (key.upArrow && !key.shift && history.length > 0) {
			completion.current = null;
			if (historyIndex.current === -1) draftBeforeHistory.current = curVal;
			const next = Math.min(historyIndex.current + 1, history.length - 1);
			historyIndex.current = next;
			setVal(history[next], history[next].length);
			return;
		}

		if (key.downArrow && !key.shift && historyIndex.current >= 0) {
			completion.current = null;
			const prev = historyIndex.current - 1;
			if (prev < 0) {
				historyIndex.current = -1;
				setVal(draftBeforeHistory.current, draftBeforeHistory.current.length);
			} else {
				historyIndex.current = prev;
				setVal(history[prev], history[prev].length);
			}
			return;
		}

		// ── Cursor ──
		if (key.leftArrow && !key.shift) {
			s.current.cursor = Math.max(0, curPos - 1);
			rerender();
			return;
		}
		if (key.rightArrow && !key.shift) {
			s.current.cursor = Math.min(curVal.length, curPos + 1);
			rerender();
			return;
		}

		// Reset history
		if (historyIndex.current !== -1 && !key.upArrow && !key.downArrow) {
			historyIndex.current = -1;
		}

		// ── Submit ──
		if (key.return && !key.shift) {
			if (curVal.trim()) {
				onSubmitRef.current(curVal);
				setVal("", 0);
				historyIndex.current = -1;
				completion.current = null;
			}
			return;
		}

		// ── Newline ──
		if (key.return && key.shift) {
			const newVal =
				curVal.slice(0, curPos) + "\n" + curVal.slice(curPos);
			setVal(newVal, curPos + 1);
			checkCompletion(newVal, curPos + 1);
			return;
		}

		// ── Backspace ──
		if (key.backspace || key.delete) {
			if (curPos <= 0) return;
			const newVal = curVal.slice(0, curPos - 1) + curVal.slice(curPos);
			setVal(newVal, curPos - 1);
			checkCompletion(newVal, curPos - 1);
			return;
		}

		// ── Insert ──
		if (_input && !key.ctrl && !key.meta) {
			const newVal = curVal.slice(0, curPos) + _input + curVal.slice(curPos);
			setVal(newVal, curPos + _input.length);
			checkCompletion(newVal, curPos + _input.length);
			return;
		}
	});

	const { value, cursor: cursorPos } = s.current;
	const beforeCursor = value.slice(0, cursorPos);
	const afterCursor = value.slice(cursorPos);
	const lines = value.split("\n");

	return (
		<Box flexDirection="column">
			{/* Completion dropdown */}
			{completion.current?.active && completion.current.matches.length > 0 && (
				<Box flexDirection="column" marginBottom={1}>
					{completion.current.matches.map((match, i) => (
						<Text key={match}>
							{i === completion.current?.selected ? "▸ " : "  "}
							<Text color={match.endsWith("/") ? "cyan" : "green"}>
								{match}
							</Text>
						</Text>
					))}
				</Box>
			)}

			<Box>
				<Text color="blue" bold>
					{"> "}
				</Text>
				{lines.length > 1 ? (
					<Box flexDirection="column">
						{lines.map((l, i) => (
							<Text key={i}>
								{l}
								{i < lines.length - 1 ? "\n" : ""}
							</Text>
						))}
						{!disabled && (
							<Text>
								{beforeCursor.split("\n").pop()}
								<Text color="gray">▌</Text>
								{afterCursor.split("\n")[0]}
							</Text>
						)}
					</Box>
				) : (
					<>
						<Text>{beforeCursor}</Text>
						{!disabled && <Text color="gray">▌</Text>}
						<Text>{afterCursor}</Text>
					</>
				)}
			</Box>
			{lines.length > 1 && !disabled && (
				<Box>
					<Text dimColor>Shift+Enter for newline - ↑↓ history - ←→ cursor - Tab complete - Enter to send</Text>
				</Box>
			)}
		</Box>
	);
}
