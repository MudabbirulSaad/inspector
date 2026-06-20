export type AgentLifecycleStatus =
  | "PENDING"
  | "RUNNING"
  | "OUTPUT_RECEIVED"
  | "SCHEMA_VALIDATED"
  | "EVIDENCE_VALIDATED"
  | "QA_REVIEWED"
  | "APPROVED"
  | "SCHEMA_FAILED"
  | "EVIDENCE_FAILED"
  | "QA_FAILED"
  | "RETRYING"
  | "FAILED";

export interface AgentLifecycleTransition {
  from: AgentLifecycleStatus | null;
  to: AgentLifecycleStatus;
  timestamp: string;
  reason?: string;
}

export interface AgentLifecycle {
  agentId: string;
  status: AgentLifecycleStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  history: AgentLifecycleTransition[];
}

export interface CreateAgentLifecycleRequest {
  agentId: string;
  timestamp: string;
}

export interface TransitionAgentLifecycleRequest {
  to: AgentLifecycleStatus;
  timestamp: string;
  reason?: string;
}

const allowedTransitions: Record<
  AgentLifecycleStatus,
  readonly AgentLifecycleStatus[]
> = {
  PENDING: ["RUNNING"],
  RUNNING: ["OUTPUT_RECEIVED"],
  OUTPUT_RECEIVED: ["SCHEMA_VALIDATED", "SCHEMA_FAILED"],
  SCHEMA_VALIDATED: ["EVIDENCE_VALIDATED", "EVIDENCE_FAILED"],
  EVIDENCE_VALIDATED: ["QA_REVIEWED"],
  QA_REVIEWED: ["APPROVED", "QA_FAILED"],
  APPROVED: [],
  SCHEMA_FAILED: ["RETRYING", "FAILED"],
  EVIDENCE_FAILED: ["RETRYING", "FAILED"],
  QA_FAILED: ["RETRYING", "FAILED"],
  RETRYING: ["RUNNING"],
  FAILED: [],
};

export function createAgentLifecycle(
  request: CreateAgentLifecycleRequest,
): AgentLifecycle {
  return {
    agentId: request.agentId,
    status: "PENDING",
    attempts: 0,
    createdAt: request.timestamp,
    updatedAt: request.timestamp,
    history: [
      {
        from: null,
        to: "PENDING",
        timestamp: request.timestamp,
      },
    ],
  };
}

export function transitionAgentLifecycle(
  lifecycle: AgentLifecycle,
  request: TransitionAgentLifecycleRequest,
): AgentLifecycle {
  const allowed = allowedTransitions[lifecycle.status];

  if (!allowed.includes(request.to)) {
    throw new Error(
      `Invalid agent lifecycle transition from ${lifecycle.status} to ${request.to}`,
    );
  }

  return {
    ...lifecycle,
    status: request.to,
    attempts:
      request.to === "RUNNING" ? lifecycle.attempts + 1 : lifecycle.attempts,
    updatedAt: request.timestamp,
    history: [
      ...lifecycle.history,
      {
        from: lifecycle.status,
        to: request.to,
        timestamp: request.timestamp,
        ...(request.reason === undefined ? {} : { reason: request.reason }),
      },
    ],
  };
}

export function serializeAgentLifecycleStatus(
  lifecycle: AgentLifecycle,
): string {
  return JSON.stringify(
    {
      agentId: lifecycle.agentId,
      status: lifecycle.status,
      attempts: lifecycle.attempts,
      createdAt: lifecycle.createdAt,
      updatedAt: lifecycle.updatedAt,
      history: lifecycle.history,
    },
    null,
    2,
  );
}
