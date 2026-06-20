export const agentOutputContracts = [
  "scout-output",
  "architecture-output",
  "pattern-miner-output",
  "finding",
  "qa-result",
  "knowledge-card",
  "memory-event",
  "inspection-report",
] as const;

export type AgentOutputContract = (typeof agentOutputContracts)[number];

export const domainModelContracts = [
  "evidence",
  "scout-output",
  "architecture-output",
  "pattern-miner-output",
  "finding",
  "qa-result",
  "qa-issue",
  "revision-request",
  "knowledge-card",
  "memory-event",
  "repository-target",
  "agent-attempt",
  "run-config",
  "inspection-run",
  "inspection-report",
] as const;

export type DomainModelContract = (typeof domainModelContracts)[number];
