export const agentOutputContracts = [
  "finding",
  "qa-result",
  "knowledge-card",
  "memory-event",
  "inspection-report",
] as const;

export type AgentOutputContract = (typeof agentOutputContracts)[number];
