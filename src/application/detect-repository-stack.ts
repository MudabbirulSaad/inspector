import type {
  RepositoryEntry,
  RepositoryReader,
} from "../ports/index.js";
import {
  detectPackageManager,
  type PackageJson,
  readPackageJson,
} from "./package-manifest.js";

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

export async function detectRepositoryStack(
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
    packageManager: packageJson === undefined ? undefined : packageManager,
  };
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
