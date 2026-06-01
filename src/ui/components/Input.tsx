import React, { useState, useRef } from "react";
import { Box, Text, useInput } from "ink";

interface InputProps {
  onSubmit: (value: string) => void;
  disabled?: boolean;
  /** History of previously submitted inputs (newest first) */
  history?: string[];
}

export function Input({ onSubmit, disabled = false, history = [] }: InputProps) {
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

    // ── Submit ──
    if (key.return) {
      if (value.trim()) {
        onSubmit(value);
        setValue("");
        historyIndex.current = -1;
      }
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

  return (
    <Box>
      <Text color="blue" bold>
        {"> "}
      </Text>
      <Text>{value}</Text>
      {!disabled && <Text color="gray">▌</Text>}
    </Box>
  );
}
