export interface AgentCallbacks {
  onReasoning?: (token: string) => void;
  onToken?: (token: string) => void;
  onToolCallStart?: (name: string, args: unknown) => void;
  onToolCallEnd?: (name: string, result: string) => void;
  onComplete?: (response: string, meta?: { reasoning?: string }) => void;
  onToolApproval?: (name: string, args: unknown) => Promise<boolean>;
  onTokenUsage?: (usage: TokenUsageInfo) => void;
  onCostUpdate?: (cost: CostUpdateInfo) => void;
}

export interface ToolApprovalRequest {
  toolName: string;
  args: unknown;
  resolve: (approved: boolean) => void;
}

export interface ToolCallInfo {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ModelLimits {
  inputLimit: number;
  outputLimit: number;
  contextWindow: number;
}

export interface TokenUsageInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextWindow: number;
  threshold: number;
  percentage: number;
  /** Cost for this specific request */
  requestCost?: number;
}

/** Accumulated cost across the session */
export interface CostUpdateInfo {
  /** Cost added by the most recent request */
  addedCost: number;
  /** Running total for the session */
  sessionCost: number;
}
