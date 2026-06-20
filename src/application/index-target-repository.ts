import type { RunConfig } from "../domain/types.js";
import type {
  RepositoryEntry,
  RepositoryIndexWriter,
  RepositoryReader,
  RunWorkspace,
} from "../ports/index.js";
import { detectRepositoryCommands } from "./detect-repository-commands.js";
import { detectRepositoryStack } from "./detect-repository-stack.js";

const ignoredRepositoryFolders = new Set([
  ".agents",
  ".cache",
  ".git",
  ".inspector-runs",
  ".next",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "vendor",
]);

export interface IndexTargetRepositoryInput {
  target: RunConfig["target"];
  reader: RepositoryReader;
  writer: RepositoryIndexWriter;
  workspace: RunWorkspace;
  maxFileSizeBytes?: number;
}

export interface RepositoryIndexSummary {
  repository: RunConfig["target"];
  totals: {
    files: number;
    directories: number;
    skippedFiles: number;
  };
}

export interface ImportantRepositoryFile {
  path: string;
  reason: string;
  sizeBytes?: number;
}

export interface ImportantRepositoryFiles {
  files: ImportantRepositoryFile[];
}

export async function indexTargetRepository(
  input: IndexTargetRepositoryInput,
): Promise<void> {
  const maxFileSizeBytes = input.maxFileSizeBytes ?? 1_000_000;
  const entries = [
    ...(await input.reader.listEntries()).filter(
      (entry) => !isIgnoredEntry(entry),
    ),
  ].sort(compareRepositoryEntries);

  await input.writer.writeText(
    input.workspace.folders.repoIndex,
    "file_tree.txt",
    renderFileTree(entries, maxFileSizeBytes),
  );
  await input.writer.writeText(
    input.workspace.folders.repoIndex,
    "repo_summary.json",
    `${JSON.stringify(
      createSummary(input.target, entries, maxFileSizeBytes),
      null,
      2,
    )}\n`,
  );
  await input.writer.writeText(
    input.workspace.folders.repoIndex,
    "important_files.json",
    `${JSON.stringify(
      createImportantFiles(entries, maxFileSizeBytes),
      null,
      2,
    )}\n`,
  );
  await input.writer.writeText(
    input.workspace.folders.repoIndex,
    "detected_stack.json",
    `${JSON.stringify(
      await detectRepositoryStack(input.reader, entries),
      null,
      2,
    )}\n`,
  );
  await input.writer.writeText(
    input.workspace.folders.repoIndex,
    "detected_commands.json",
    `${JSON.stringify(
      await detectRepositoryCommands(input.reader, entries),
      null,
      2,
    )}\n`,
  );
}

function isIgnoredEntry(entry: RepositoryEntry): boolean {
  return entry.path
    .split("/")
    .some((segment) => ignoredRepositoryFolders.has(segment));
}

function isOversizedFile(
  entry: RepositoryEntry,
  maxFileSizeBytes: number,
): boolean {
  return entry.kind === "file" && (entry.sizeBytes ?? 0) > maxFileSizeBytes;
}

function compareRepositoryEntries(
  left: RepositoryEntry,
  right: RepositoryEntry,
): number {
  if (left.path < right.path) {
    return -1;
  }

  if (left.path > right.path) {
    return 1;
  }

  return 0;
}

function renderFileTree(
  entries: RepositoryEntry[],
  maxFileSizeBytes: number,
): string {
  const lines = [
    ".",
    ...entries.map((entry) => {
      if (entry.kind === "directory") {
        return `${entry.path}/`;
      }

      if (isOversizedFile(entry, maxFileSizeBytes)) {
        return `${entry.path} [skipped: ${entry.sizeBytes ?? 0} bytes]`;
      }

      return entry.path;
    }),
  ];

  return `${lines.join("\n")}\n`;
}

function createSummary(
  target: RunConfig["target"],
  entries: RepositoryEntry[],
  maxFileSizeBytes: number,
): RepositoryIndexSummary {
  return {
    repository: target,
    totals: {
      files: entries.filter((entry) => entry.kind === "file").length,
      directories: entries.filter((entry) => entry.kind === "directory").length,
      skippedFiles: entries.filter((entry) =>
        isOversizedFile(entry, maxFileSizeBytes),
      ).length,
    },
  };
}

function createImportantFiles(
  entries: RepositoryEntry[],
  maxFileSizeBytes: number,
): ImportantRepositoryFiles {
  return {
    files: entries
      .filter(
        (entry) =>
          entry.kind === "file" && !isOversizedFile(entry, maxFileSizeBytes),
      )
      .flatMap((entry) => {
        const reason = importantFileReason(entry.path);
        return reason === undefined
          ? []
          : [{ path: entry.path, reason, sizeBytes: entry.sizeBytes }];
      }),
  };
}

function importantFileReason(path: string): string | undefined {
  const lowerPath = path.toLowerCase();

  if (lowerPath === "agents.md") {
    return "agent repository guidance";
  }

  if (lowerPath === "readme.md") {
    return "repository documentation";
  }

  if (lowerPath === "package.json") {
    return "package manifest";
  }

  if (lowerPath.endsWith("config.json") || lowerPath.endsWith("config.js")) {
    return "tooling configuration";
  }

  if (lowerPath.startsWith("docs/") && lowerPath.endsWith(".md")) {
    return "project documentation";
  }

  if (
    lowerPath.startsWith("schemas/") &&
    lowerPath.endsWith(".schema.json")
  ) {
    return "output contract schema";
  }

  return undefined;
}
