import type { RunConfig } from "../domain/types.js";
import type {
  Clock,
  RunWorkspace,
  RunWorkspaceStore,
} from "../ports/index.js";

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
  const slug = name
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");

  return slug || "repository";
}
