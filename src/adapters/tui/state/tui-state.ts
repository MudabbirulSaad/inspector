export type TuiAgentStatus =
  | "pending"
  | "running"
  | "validating"
  | "completed"
  | "failed";

export interface TuiStep {
  agentId: string;
  label: string;
  status: TuiAgentStatus;
  attempt?: number;
  failureReason?: string;
}

export interface TuiRunInfo {
  runId: string;
  repoPath: string;
  docsPath: string;
  dataPath: string;
}

export interface TuiActivity {
  agentId?: string;
  message: string;
}

export interface TuiRunSummary {
  status: "completed" | "failed";
  docsPath?: string;
  dataPath?: string;
  approved?: number;
  rejected?: number;
  issues?: number;
}

export interface TuiError {
  reason: string;
  nextAction: string;
  dataPath?: string;
}

export interface TuiState {
  run?: TuiRunInfo;
  steps: TuiStep[];
  currentActivity?: TuiActivity;
  summary?: TuiRunSummary;
  error?: TuiError;
}

export const specialistSteps: TuiStep[] = [
  { agentId: "scout", label: "Scout", status: "pending" },
  { agentId: "architecture", label: "Architecture", status: "pending" },
  { agentId: "pattern_miner", label: "Pattern Miner", status: "pending" },
  { agentId: "flow_tracer", label: "Flow Tracer", status: "pending" },
  {
    agentId: "testing_strategy",
    label: "Testing Strategy",
    status: "pending",
  },
  {
    agentId: "tradeoff_analyst",
    label: "Tradeoff Analyst",
    status: "pending",
  },
];

export function createInitialTuiState(): TuiState {
  return {
    steps: specialistSteps.map((step) => ({ ...step })),
  };
}
