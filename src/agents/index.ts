import type { AgentOutputContract } from "../domain/contracts.js";

export const agentsBoundary = "agents" as const;

export type AgentContractId =
  | "scout"
  | "architecture"
  | "pattern_miner"
  | "qa_verifier"
  | "final_reviewer"
  | "flow_tracer"
  | "testing_strategy"
  | "tradeoff_analyst"
  | "rag_card_distiller";

export type AgentLifecycle = "v1" | "later";

export interface AgentRetryPolicy {
  maxAttempts: number;
  retryableFailures: string[];
}

export interface AgentQaRevisionOwnership {
  ownsRevisionFor: AgentContractId[];
}

export interface AgentContract {
  id: AgentContractId;
  role: string;
  description: string;
  lifecycle: AgentLifecycle;
  dependencies: AgentContractId[];
  outputArtifacts: string[];
  outputSchema: AgentOutputContract;
  retryPolicy: AgentRetryPolicy;
  required: boolean;
  qaRevisionOwnership: AgentQaRevisionOwnership;
}

const defaultRetryPolicy: AgentRetryPolicy = {
  maxAttempts: 2,
  retryableFailures: ["schema-invalid", "missing-evidence", "qa-follow-up"],
};

const agentContracts = [
  {
    id: "scout",
    role: "repository scout",
    description:
      "Maps repository structure, important files, stack signals, and likely inspection focus areas.",
    lifecycle: "v1",
    dependencies: [],
    outputArtifacts: ["agents/scout/attempt-{attempt}/output.json"],
    outputSchema: "scout-output",
    retryPolicy: defaultRetryPolicy,
    required: true,
    qaRevisionOwnership: { ownsRevisionFor: ["scout"] },
  },
  {
    id: "architecture",
    role: "architecture inspector",
    description:
      "Evaluates architectural boundaries, dependency direction, and design risks using repository evidence.",
    lifecycle: "v1",
    dependencies: ["scout"],
    outputArtifacts: ["agents/architecture/attempt-{attempt}/output.json"],
    outputSchema: "architecture-output",
    retryPolicy: defaultRetryPolicy,
    required: true,
    qaRevisionOwnership: { ownsRevisionFor: ["architecture"] },
  },
  {
    id: "pattern_miner",
    role: "pattern miner",
    description:
      "Finds repeated implementation patterns, conventions, and inconsistencies that affect maintainability.",
    lifecycle: "v1",
    dependencies: ["architecture"],
    outputArtifacts: ["agents/pattern_miner/attempt-{attempt}/output.json"],
    outputSchema: "pattern-miner-output",
    retryPolicy: defaultRetryPolicy,
    required: true,
    qaRevisionOwnership: { ownsRevisionFor: ["pattern_miner"] },
  },
  {
    id: "flow_tracer",
    role: "flow tracer",
    description:
      "Traces user-facing flows through entrypoints, services, adapters, and output artifacts.",
    lifecycle: "v1",
    dependencies: ["architecture", "pattern_miner"],
    outputArtifacts: ["agents/flow_tracer/attempt-{attempt}/output.json"],
    outputSchema: "flow-tracer-output",
    retryPolicy: defaultRetryPolicy,
    required: true,
    qaRevisionOwnership: { ownsRevisionFor: ["flow_tracer"] },
  },
  {
    id: "testing_strategy",
    role: "testing strategy inspector",
    description:
      "Evaluates test coverage, validation commands, and risk-based testing gaps.",
    lifecycle: "v1",
    dependencies: ["architecture", "pattern_miner", "flow_tracer"],
    outputArtifacts: ["agents/testing_strategy/attempt-{attempt}/output.json"],
    outputSchema: "testing-strategy-output",
    retryPolicy: defaultRetryPolicy,
    required: true,
    qaRevisionOwnership: { ownsRevisionFor: ["testing_strategy"] },
  },
  {
    id: "qa_verifier",
    role: "QA verifier",
    description:
      "Checks validated findings for evidence quality, accuracy, and follow-up requirements.",
    lifecycle: "v1",
    dependencies: ["architecture", "pattern_miner", "flow_tracer", "testing_strategy"],
    outputArtifacts: ["qa/results.json"],
    outputSchema: "qa-result",
    retryPolicy: defaultRetryPolicy,
    required: true,
    qaRevisionOwnership: {
      ownsRevisionFor: [
        "scout",
        "architecture",
        "pattern_miner",
        "flow_tracer",
        "testing_strategy",
      ],
    },
  },
  {
    id: "final_reviewer",
    role: "final reviewer",
    description:
      "Assembles accepted findings, QA results, validation metadata, and knowledge-card inputs for final review.",
    lifecycle: "v1",
    dependencies: ["qa_verifier"],
    outputArtifacts: ["final/inspection-report.json", "final/case-study.md"],
    outputSchema: "inspection-report",
    retryPolicy: defaultRetryPolicy,
    required: true,
    qaRevisionOwnership: { ownsRevisionFor: [] },
  },
  {
    id: "tradeoff_analyst",
    role: "tradeoff analyst",
    description:
      "Identifies design tradeoffs, alternatives, and consequences behind important implementation choices.",
    lifecycle: "later",
    dependencies: ["architecture", "pattern_miner"],
    outputArtifacts: ["agents/tradeoff_analyst/findings.json"],
    outputSchema: "finding",
    retryPolicy: defaultRetryPolicy,
    required: false,
    qaRevisionOwnership: { ownsRevisionFor: ["tradeoff_analyst"] },
  },
  {
    id: "rag_card_distiller",
    role: "RAG card distiller",
    description:
      "Distills accepted findings and QA-approved evidence into compact knowledge cards for future agents.",
    lifecycle: "later",
    dependencies: ["qa_verifier"],
    outputArtifacts: ["final/knowledge-cards.json"],
    outputSchema: "knowledge-card",
    retryPolicy: defaultRetryPolicy,
    required: false,
    qaRevisionOwnership: { ownsRevisionFor: [] },
  },
] as const satisfies AgentContract[];

function copyAgentContract(contract: AgentContract): AgentContract {
  return {
    ...contract,
    dependencies: [...contract.dependencies],
    outputArtifacts: [...contract.outputArtifacts],
    retryPolicy: {
      ...contract.retryPolicy,
      retryableFailures: [...contract.retryPolicy.retryableFailures],
    },
    qaRevisionOwnership: {
      ownsRevisionFor: [...contract.qaRevisionOwnership.ownsRevisionFor],
    },
  };
}

export function getAgentContracts(filters?: {
  lifecycle?: AgentLifecycle;
}): AgentContract[] {
  if (filters?.lifecycle === undefined) {
    return agentContracts.map(copyAgentContract);
  }

  return agentContracts.filter(
    (contract) => contract.lifecycle === filters.lifecycle,
  ).map(copyAgentContract);
}

export function getAgentContract(id: string): AgentContract {
  const contract = agentContracts.find((candidate) => candidate.id === id);

  if (contract === undefined) {
    throw new Error(`Unknown agent contract: ${id}`);
  }

  return copyAgentContract(contract);
}

export function getAgentDependencyGraph(filters?: {
  lifecycle?: AgentLifecycle;
}): Partial<Record<AgentContractId, AgentContractId[]>> {
  return Object.fromEntries(
    getAgentContracts(filters).map((contract) => [
      contract.id,
      [...contract.dependencies],
    ]),
  );
}
