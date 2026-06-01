import React from "react";
import { Box, Text } from "ink";
import type { TokenUsageInfo } from "../../types.ts";

interface TokenUsageProps {
  usage: TokenUsageInfo | null;
  /** Running session total cost */
  sessionCost?: number;
}

export function TokenUsage({ usage, sessionCost = 0 }: TokenUsageProps) {
  if (!usage) {
    // If no usage but we have accumulated cost, show that
    if (sessionCost > 0) {
      return (
        <Box borderStyle="single" borderColor="gray" paddingX={1}>
          <Text dimColor>Session cost: </Text>
          <Text color="yellow">{formatCost(sessionCost)}</Text>
        </Box>
      );
    }
    return null;
  }

  const thresholdPercent = Math.round(usage.threshold * 100);
  const usagePercent = usage.percentage.toFixed(1);

  // Determine color based on usage
  let color: string = "green";
  if (usage.percentage >= usage.threshold * 100) {
    color = "red";
  } else if (usage.percentage >= usage.threshold * 100 * 0.75) {
    color = "yellow";
  }

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Text>
        Tokens:{" "}
        <Text color={color} bold>
          {usagePercent}%
        </Text>
        <Text dimColor> (threshold: {thresholdPercent}%)</Text>
        {usage.requestCost !== undefined && usage.requestCost > 0 && (
          <>
            <Text dimColor> | Last request: </Text>
            <Text color="yellow">{formatCost(usage.requestCost)}</Text>
          </>
        )}
        {sessionCost > 0 && (
          <>
            <Text dimColor> | Session: </Text>
            <Text color="yellow">{formatCost(sessionCost)}</Text>
          </>
        )}
      </Text>
    </Box>
  );
}

function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}
