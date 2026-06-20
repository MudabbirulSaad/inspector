import type { RepositoryEntry } from "../ports/index.js";

const defaultIgnoredRepositoryFolders = new Set([
  ".agents",
  ".cache",
  ".git",
  ".inspector-dogfood",
  ".inspector-runs",
  ".next",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "vendor",
]);

export interface RepositoryIgnoreOptions {
  targetRoot?: string;
  outputDirectory?: string;
  ignoredArtifactPaths?: readonly string[];
}

export function isIgnoredRepositoryEntry(
  entry: RepositoryEntry,
  options: RepositoryIgnoreOptions = {},
): boolean {
  return isIgnoredRepositoryPath(entry.path, options);
}

export function isIgnoredRepositoryPath(
  path: string,
  options: RepositoryIgnoreOptions = {},
): boolean {
  const normalizedPath = normalizeRepositoryPath(path);
  const segments = normalizedPath.split("/");

  if (isPathAtOrBelow(normalizedPath, "docs/inspector")) {
    return true;
  }

  if (segments.some((segment) => defaultIgnoredRepositoryFolders.has(segment))) {
    return true;
  }

  return ignoredArtifactPaths(options).some((artifactPath) =>
    isPathAtOrBelow(normalizedPath, artifactPath),
  );
}

export function isInspectorRunArtifactPath(
  path: string,
  options: RepositoryIgnoreOptions = {},
): boolean {
  return isIgnoredRepositoryPath(path, options);
}

export function normalizeRepositoryPath(path: string): string {
  return path
    .replaceAll("\\", "/")
    .replace(/^(\.\/)+/, "")
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");
}

function ignoredArtifactPaths(options: RepositoryIgnoreOptions): string[] {
  return [
    ...configuredOutputDirectoryPaths(options),
    ...(options.ignoredArtifactPaths ?? []).map(normalizeRepositoryPath),
  ].filter((path) => path.length > 0);
}

function configuredOutputDirectoryPaths(
  options: RepositoryIgnoreOptions,
): string[] {
  if (
    options.targetRoot === undefined ||
    options.outputDirectory === undefined
  ) {
    return [];
  }

  const relativeOutputDirectory = relativePathInsideRoot(
    options.targetRoot,
    options.outputDirectory,
  );

  return relativeOutputDirectory === undefined
    ? []
    : [relativeOutputDirectory];
}

function relativePathInsideRoot(
  root: string,
  child: string,
): string | undefined {
  const normalizedRoot = normalizeSystemPath(root);
  const normalizedChild = normalizeSystemPath(child);

  if (normalizedRoot.anchor !== normalizedChild.anchor) {
    return undefined;
  }

  if (normalizedChild.segments.length < normalizedRoot.segments.length) {
    return undefined;
  }

  for (const [index, segment] of normalizedRoot.segments.entries()) {
    if (normalizedChild.segments[index] !== segment) {
      return undefined;
    }
  }

  return normalizedChild.segments
    .slice(normalizedRoot.segments.length)
    .join("/");
}

function normalizeSystemPath(path: string): {
  anchor: string;
  segments: string[];
} {
  const slashedPath = path.replaceAll("\\", "/");
  const driveMatch = /^([A-Za-z]:)(?:\/|$)/.exec(slashedPath);
  const driveAnchor = driveMatch?.[1];
  const anchor =
    driveAnchor === undefined
      ? slashedPath.startsWith("/")
        ? "/"
        : ""
      : driveAnchor.toLowerCase();
  const withoutAnchor =
    driveMatch === null
      ? slashedPath.replace(/^\/+/, "")
      : slashedPath.slice(driveMatch[0].length);
  const segments: string[] = [];

  for (const segment of withoutAnchor.split("/")) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }

    if (segment === "..") {
      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  return { anchor, segments };
}

function isPathAtOrBelow(path: string, parentPath: string): boolean {
  return path === parentPath || path.startsWith(`${parentPath}/`);
}
