import type { PortRegistry } from "../ports/index.js";

export * from "./create-inspection-run-workspace.js";
export * from "./index-target-repository.js";
export * from "./detect-repository-stack.js";
export * from "./detect-repository-commands.js";
export * from "./append-swarm-memory.js";
export * from "./build-agent-prompt.js";
export * from "./execute-agent-run.js";
export * from "./write-agent-lifecycle-status.js";
export * from "./schedule-agent-graph.js";
export * from "./validate-agent-output.js";
export * from "./validate-evidence-references.js";
export * from "./run-scout-architecture-inspection.js";
export * from "./verify-findings-with-qa.js";
export * from "./generate-case-study-documentation.js";

export const applicationBoundary = "application" as const;

export interface ApplicationBoundary {
  readonly boundary: typeof applicationBoundary;
  readonly ports: PortRegistry;
}
