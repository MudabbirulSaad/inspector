export const portsBoundary = "ports" as const;

export interface PortRegistry {
  readonly boundary: typeof portsBoundary;
}

export interface Clock {
  now(): Date;
}

export interface RunWorkspaceRequest {
  outputDirectory: string;
  workspaceName: string;
  configJson: string;
}

export interface RunWorkspace {
  name: string;
  root: string;
  configFile: string;
  folders: {
    input: string;
    repoIndex: string;
    memory: string;
    agents: string;
    validation: string;
    qa: string;
    final: string;
  };
}

export interface RunWorkspaceStore {
  create(request: RunWorkspaceRequest): Promise<RunWorkspace>;
}

export type RepositoryEntryKind = "file" | "directory";

export interface RepositoryEntry {
  path: string;
  kind: RepositoryEntryKind;
  sizeBytes?: number;
}

export interface RepositoryReader {
  listEntries(): Promise<RepositoryEntry[]>;
  readTextFile(path: string): Promise<string>;
}

export interface RepositoryIndexWriter {
  writeText(directory: string, path: string, content: string): Promise<void>;
}
