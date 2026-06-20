import type { PortRegistry } from "../ports/index.js";

export * from "./create-inspection-run-workspace.js";
export * from "./index-target-repository.js";
export * from "./detect-repository-stack.js";
export * from "./detect-repository-commands.js";
export * from "./append-swarm-memory.js";
export * from "./build-agent-prompt.js";
export * from "./execute-agent-run.js";

export const applicationBoundary = "application" as const;

export interface ApplicationBoundary {
  readonly boundary: typeof applicationBoundary;
  readonly ports: PortRegistry;
}
