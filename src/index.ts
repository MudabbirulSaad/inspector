export * from "./adapters/index.js";
export * from "./agents/index.js";
export * from "./application/index.js";
export * from "./domain/contracts.js";
export * from "./domain/types.js";
export * from "./memory/index.js";
export * from "./ports/index.js";
export * from "./shared/index.js";
export * from "./validation/index.js";
export * from "./writers/index.js";

export const sourceBoundaries = [
  "domain",
  "application",
  "ports",
  "adapters",
  "agents",
  "validation",
  "memory",
  "writers",
  "shared",
] as const;

export type SourceBoundary = (typeof sourceBoundaries)[number];
