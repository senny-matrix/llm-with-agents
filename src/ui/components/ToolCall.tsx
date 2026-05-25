import React from 'react';
import { Box, Text } from 'ink';
import InkSpinner from 'ink-spinner';

export interface ToolCallProps {
  name: string;
  args?: unknown;
  status: 'pending' | 'complete';
  result?: string;
}

export function ToolCall({ name, status, result }: ToolCallProps) {
  const previewLength = 500;
  const truncated = result && result.length > previewLength;
  const displayResult = result ? (truncated ? result.slice(0, previewLength) : result) : '';

  return (
    <Box flexDirection="column" marginLeft={2}>
      <Box>
        <Text color="yellow">⚡ </Text>
        <Text color="yellow" bold>
          {name}
        </Text>
        {status === 'pending' ? (
          <Text>
            {' '}
            <Text color="cyan">
              <InkSpinner type="dots" />
            </Text>
          </Text>
        ) : (
          <Text color="green"> ✓</Text>
        )}
      </Box>
      {status === 'complete' && displayResult && (
        <Box flexDirection="column" marginLeft={2}>
          <Text dimColor>→ {displayResult}</Text>
          {truncated && (
            <Text dimColor>  ... (showing first {previewLength} of {result.length} characters)</Text>
          )}
        </Box>
      )}
    </Box>
  );
}
