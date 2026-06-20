import type { RunConfig } from "../domain/types.js";
import type {
  Clock,
  PortRegistry,
  RunWorkspace,
  RunWorkspaceStore,
} from "../ports/index.js";

export const applicationBoundary = "application" as const;

export interface ApplicationBoundary {
  readonly boundary: typeof applicationBoundary;
  readonly ports: PortRegistry;
}

export interface CreateInspectionRunWorkspaceInput {
  config: RunConfig;
  clock: Clock;
  workspaces: RunWorkspaceStore;
}

export async function createInspectionRunWorkspace(
  input: CreateInspectionRunWorkspaceInput,
): Promise<RunWorkspace> {
  const workspaceName = `${formatTimestamp(input.clock.now())}_${slugifyRepoName(
    input.config.target.name,
  )}`;

  return input.workspaces.create({
    outputDirectory: input.config.outputDirectory,
    workspaceName,
    configJson: `${JSON.stringify(input.config, null, 2)}\n`,
  });
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function slugifyRepoName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}
