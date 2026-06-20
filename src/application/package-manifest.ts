import type {
  RepositoryEntry,
  RepositoryReader,
} from "../ports/index.js";

export interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface DetectedPackageManager {
  name: "npm" | "pnpm" | "yarn";
  evidence: string[];
}

export async function readPackageJson(
  reader: RepositoryReader,
  entries: RepositoryEntry[],
): Promise<PackageJson | undefined> {
  if (
    !entries.some(
      (entry) => entry.kind === "file" && entry.path === "package.json",
    )
  ) {
    return undefined;
  }

  return JSON.parse(await reader.readTextFile("package.json")) as PackageJson;
}

export function detectPackageManager(
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
