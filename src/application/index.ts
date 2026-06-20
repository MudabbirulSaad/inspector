import type { PortRegistry } from "../ports/index.js";

export const applicationBoundary = "application" as const;

export interface ApplicationBoundary {
  readonly boundary: typeof applicationBoundary;
  readonly ports: PortRegistry;
}
