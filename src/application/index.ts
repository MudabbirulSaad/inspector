import type { RunConfig } from "../domain/types.js";
import type {
  Clock,
  PortRegistry,
  RepositoryEntry,
  RepositoryIndexWriter,
  RepositoryReader,
  RunWorkspace,
  RunWorkspaceStore,
} from "../ports/index.js";

export const applicationBoundary = "application" as const;

const ignoredRepositoryFolders = new Set([
  ".cache",
  ".git",
  ".next",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "vendor",
]);

export interface ApplicationBoundary {
  readonly boundary: typeof applicationBoundary;
  readonly ports: PortRegistry;
}

export interface CreateInspectionRunWorkspaceInput {
  config: RunConfig;
  clock: Clock;
  workspaces: RunWorkspaceStore;
}

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

export type CommandCategory =
  | "test"
  | "typecheck"
  | "lint"
  | "build"
  | "dev"
  | "format";

export interface DetectedCommand {
  category: CommandCategory;
  command: string;
  source: string;
}

export interface DetectedCommands {
  commands: DetectedCommand[];
  missing: CommandCategory[];
}

export interface DetectedStack {
  stacks: {
    name: string;
    confidence: "high" | "medium" | "low";
    evidence: string[];
  }[];
  packageManager?: {
    name: string;
    evidence: string[];
  };
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface DetectedPackageManager {
  name: "npm" | "pnpm" | "yarn";
  evidence: string[];
}

const commandCategories: CommandCategory[] = [
  "build",
  "dev",
  "format",
  "lint",
  "test",
  "typecheck",
];

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
    `${JSON.stringify(await detectStack(input.reader, entries), null, 2)}\n`,
  );
  await input.writer.writeText(
    input.workspace.folders.repoIndex,
    "detected_commands.json",
    `${JSON.stringify(
      await detectCommands(input.reader, entries),
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

async function detectCommands(
  reader: RepositoryReader,
  entries: RepositoryEntry[],
): Promise<DetectedCommands> {
  const packageJson = await readPackageJson(reader, entries);
  const packageManager = detectPackageManager(entries, packageJson);
  const scripts = packageJson?.scripts ?? {};
  const commands = commandCategories.flatMap((category) => {
    if (scripts[category] === undefined) {
      return [];
    }

    return [
      {
        category,
        command: renderPackageScriptCommand(packageManager.name, category),
        source: "package.json",
      },
    ];
  });

  return {
    commands,
    missing: commandCategories.filter(
      (category) => scripts[category] === undefined,
    ),
  };
}

async function detectStack(
  reader: RepositoryReader,
  entries: RepositoryEntry[],
): Promise<DetectedStack> {
  const packageJson = await readPackageJson(reader, entries);
  const packageManager = detectPackageManager(entries, packageJson);
  const stacks: DetectedStack["stacks"] = [];

  if (packageJson !== undefined) {
    stacks.push({
      name: "node",
      confidence: "high",
      evidence: ["package.json"],
    });
  }

  if (hasTypeScriptEvidence(entries, packageJson)) {
    stacks.push({
      name: "typescript",
      confidence: "high",
      evidence: typeScriptEvidence(entries, packageJson),
    });
  }

  const pythonEvidence = evidenceForFiles(entries, [
    "pyproject.toml",
    "requirements.txt",
  ]);
  if (pythonEvidence.length > 0) {
    stacks.push({
      name: "python",
      confidence: "medium",
      evidence: pythonEvidence,
    });
  }

  const rustEvidence = evidenceForFiles(entries, ["Cargo.toml"]);
  if (rustEvidence.length > 0) {
    stacks.push({
      name: "rust",
      confidence: "medium",
      evidence: rustEvidence,
    });
  }

  const goEvidence = evidenceForFiles(entries, ["go.mod"]);
  if (goEvidence.length > 0) {
    stacks.push({
      name: "go",
      confidence: "medium",
      evidence: goEvidence,
    });
  }

  const dockerEvidence = dockerFileEvidence(entries);
  if (dockerEvidence.length > 0) {
    stacks.push({
      name: "docker",
      confidence: "medium",
      evidence: dockerEvidence,
    });
  }

  const githubActionsEvidence = githubActionsFileEvidence(entries);
  if (githubActionsEvidence.length > 0) {
    stacks.push({
      name: "github-actions",
      confidence: "medium",
      evidence: githubActionsEvidence,
    });
  }

  return {
    stacks,
    packageManager:
      packageJson === undefined
        ? undefined
        : packageManager,
  };
}

function detectPackageManager(
  entries: RepositoryEntry[],
  packageJson: PackageJson | undefined,
): DetectedPackageManager {
  const files = new Set(
    entries
      .filter((entry) => entry.kind === "file")
      .map((entry) => entry.path),
  );

  if (files.has("pnpm-lock.yaml")) {
    return { name: "pnpm", evidence: ["pnpm-lock.yaml"] };
  }

  if (files.has("yarn.lock")) {
    return { name: "yarn", evidence: ["yarn.lock"] };
  }

  if (files.has("package-lock.json")) {
    return { name: "npm", evidence: ["package-lock.json"] };
  }

  return {
    name: "npm",
    evidence: packageJson === undefined ? [] : ["package.json"],
  };
}

function renderPackageScriptCommand(
  packageManager: DetectedPackageManager["name"],
  category: CommandCategory,
): string {
  if (category === "test") {
    return `${packageManager} test`;
  }

  if (packageManager === "npm") {
    return `npm run ${category}`;
  }

  return `${packageManager} ${category}`;
}

async function readPackageJson(
  reader: RepositoryReader,
  entries: RepositoryEntry[],
): Promise<PackageJson | undefined> {
  if (!entries.some((entry) => entry.kind === "file" && entry.path === "package.json")) {
    return undefined;
  }

  return JSON.parse(await reader.readTextFile("package.json")) as PackageJson;
}

function hasTypeScriptEvidence(
  entries: RepositoryEntry[],
  packageJson: PackageJson | undefined,
): boolean {
  return (
    entries.some(
      (entry) =>
        entry.kind === "file" &&
        (entry.path === "tsconfig.json" || entry.path.endsWith(".ts")),
    ) ||
    packageJson?.dependencies?.typescript !== undefined ||
    packageJson?.devDependencies?.typescript !== undefined
  );
}

function typeScriptEvidence(
  entries: RepositoryEntry[],
  packageJson: PackageJson | undefined,
): string[] {
  return [
    ...(packageJson === undefined ? [] : ["package.json"]),
    ...evidenceForFiles(entries, ["tsconfig.json"]),
    ...entries
      .filter((entry) => entry.kind === "file" && entry.path.endsWith(".ts"))
      .map((entry) => entry.path)
      .slice(0, 1),
  ];
}

function evidenceForFiles(
  entries: RepositoryEntry[],
  paths: string[],
): string[] {
  const wantedPaths = new Set(paths);

  return entries
    .filter((entry) => entry.kind === "file" && wantedPaths.has(entry.path))
    .map((entry) => entry.path);
}

function dockerFileEvidence(entries: RepositoryEntry[]): string[] {
  return entries
    .filter(
      (entry) =>
        entry.kind === "file" &&
        (entry.path === "Dockerfile" || entry.path.endsWith("/Dockerfile")),
    )
    .map((entry) => entry.path);
}

function githubActionsFileEvidence(entries: RepositoryEntry[]): string[] {
  return entries
    .filter(
      (entry) =>
        entry.kind === "file" &&
        entry.path.startsWith(".github/workflows/") &&
        (entry.path.endsWith(".yml") || entry.path.endsWith(".yaml")),
    )
    .map((entry) => entry.path);
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
