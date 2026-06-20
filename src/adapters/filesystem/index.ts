import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  RepositoryEntry,
  RepositoryIndexWriter,
  RepositoryReader,
  RunWorkspace,
  RunWorkspaceRequest,
  RunWorkspaceStore,
} from "../../ports/index.js";

export const filesystemAdapterBoundary = "adapters.filesystem" as const;

const workspaceFolders = [
  "input",
  "repo_index",
  "memory",
  "agents",
  "validation",
  "qa",
  "final",
] as const;

export class NodeRunWorkspaceStore implements RunWorkspaceStore {
  async create(request: RunWorkspaceRequest): Promise<RunWorkspace> {
    try {
      await mkdir(request.outputDirectory, { recursive: true });

      const { name, root } = await createUniqueWorkspaceRoot(request);

      await writeFile(join(root, "config.json"), request.configJson, {
        flag: "wx",
      });

      for (const folder of workspaceFolders) {
        await mkdir(join(root, folder));
      }

      return toRunWorkspace(name, root);
    } catch (error) {
      throw new Error(
        `Cannot create inspection run workspace in ${request.outputDirectory}`,
        { cause: error },
      );
    }
  }
}

export class NodeRepositoryReader implements RepositoryReader {
  constructor(private readonly root: string) {}

  async listEntries(): Promise<RepositoryEntry[]> {
    return this.walkDirectory("");
  }

  private async walkDirectory(relativeDirectory: string): Promise<RepositoryEntry[]> {
    const absoluteDirectory =
      relativeDirectory.length === 0
        ? this.root
        : join(this.root, relativeDirectory);
    const dirents = await readdir(absoluteDirectory, { withFileTypes: true });
    const entries: RepositoryEntry[] = [];

    for (const dirent of dirents) {
      const relativePath =
        relativeDirectory.length === 0
          ? dirent.name
          : `${relativeDirectory}/${dirent.name}`;
      const absolutePath = join(this.root, relativePath);

      if (dirent.isDirectory()) {
        entries.push({ path: relativePath, kind: "directory" });
        entries.push(...(await this.walkDirectory(relativePath)));
        continue;
      }

      if (dirent.isFile()) {
        const metadata = await stat(absolutePath);
        entries.push({
          path: relativePath,
          kind: "file",
          sizeBytes: metadata.size,
        });
      }
    }

    return entries;
  }
}

export class NodeRepositoryIndexWriter implements RepositoryIndexWriter {
  async writeText(
    directory: string,
    path: string,
    content: string,
  ): Promise<void> {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, path), content);
  }
}

async function createUniqueWorkspaceRoot(
  request: RunWorkspaceRequest,
): Promise<{ name: string; root: string }> {
  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const name =
      attempt === 1
        ? request.workspaceName
        : `${request.workspaceName}_${attempt}`;
    const root = join(request.outputDirectory, name);

    try {
      await mkdir(root);
      return { name, root };
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    `Unable to create a unique inspection workspace for ${request.workspaceName}`,
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function toRunWorkspace(name: string, root: string): RunWorkspace {
  return {
    name,
    root,
    configFile: join(root, "config.json"),
    folders: {
      input: join(root, "input"),
      repoIndex: join(root, "repo_index"),
      memory: join(root, "memory"),
      agents: join(root, "agents"),
      validation: join(root, "validation"),
      qa: join(root, "qa"),
      final: join(root, "final"),
    },
  };
}
