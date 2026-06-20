import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  indexTargetRepository,
  type RepositoryEntry,
  type RepositoryReader,
  type RepositoryIndexWriter,
  type RunWorkspace,
} from "../../src/index.js";
import {
  NodeRepositoryIndexWriter,
  NodeRepositoryReader,
} from "../../src/adapters/filesystem/index.js";

class InMemoryRepositoryReader implements RepositoryReader {
  constructor(private readonly entries: RepositoryEntry[]) {}

  async listEntries(): Promise<RepositoryEntry[]> {
    return this.entries;
  }
}

class InMemoryRepositoryIndexWriter implements RepositoryIndexWriter {
  readonly files = new Map<string, string>();
  readonly directories = new Set<string>();

  async writeText(
    directory: string,
    path: string,
    content: string,
  ): Promise<void> {
    this.directories.add(directory);
    this.files.set(path, content);
  }
}

const workspace: RunWorkspace = {
  name: "run-001",
  root: "/inspection/run-001",
  configFile: "/inspection/run-001/config.json",
  folders: {
    input: "/inspection/run-001/input",
    repoIndex: "/inspection/run-001/repo_index",
    memory: "/inspection/run-001/memory",
    agents: "/inspection/run-001/agents",
    validation: "/inspection/run-001/validation",
    qa: "/inspection/run-001/qa",
    final: "/inspection/run-001/final",
  },
};

test("writes deterministic repository index artifacts", async () => {
  const reader = new InMemoryRepositoryReader([
    { path: "src/index.ts", kind: "file", sizeBytes: 42 },
    { path: "src", kind: "directory" },
    { path: "README.md", kind: "file", sizeBytes: 120 },
  ]);
  const writer = new InMemoryRepositoryIndexWriter();

  await indexTargetRepository({
    target: {
      name: "example-service",
      root: "/repos/example-service",
      commit: "abc1234",
    },
    reader,
    writer,
    workspace,
  });

  assert.deepEqual(writer.directories, new Set([workspace.folders.repoIndex]));
  assert.equal(
    writer.files.get("file_tree.txt"),
    [
      ".",
      "README.md",
      "src/",
      "src/index.ts",
      "",
    ].join("\n"),
  );

  assert.deepEqual(JSON.parse(writer.files.get("repo_summary.json") ?? ""), {
    repository: {
      name: "example-service",
      root: "/repos/example-service",
      commit: "abc1234",
    },
    totals: {
      files: 2,
      directories: 1,
      skippedFiles: 0,
    },
  });

  assert.deepEqual(JSON.parse(writer.files.get("important_files.json") ?? ""), {
    files: [
      {
        path: "README.md",
        reason: "repository documentation",
        sizeBytes: 120,
      },
    ],
  });
});

test("omits noisy repository folders from index artifacts", async () => {
  const reader = new InMemoryRepositoryReader([
    { path: ".git", kind: "directory" },
    { path: ".git/config", kind: "file", sizeBytes: 12 },
    { path: "coverage", kind: "directory" },
    { path: "coverage/lcov.info", kind: "file", sizeBytes: 20 },
    { path: "node_modules", kind: "directory" },
    { path: "node_modules/pkg/index.js", kind: "file", sizeBytes: 30 },
    { path: "src", kind: "directory" },
    { path: "src/index.ts", kind: "file", sizeBytes: 42 },
  ]);
  const writer = new InMemoryRepositoryIndexWriter();

  await indexTargetRepository({
    target: {
      name: "example-service",
      root: "/repos/example-service",
    },
    reader,
    writer,
    workspace,
  });

  assert.equal(
    writer.files.get("file_tree.txt"),
    [
      ".",
      "src/",
      "src/index.ts",
      "",
    ].join("\n"),
  );
  assert.deepEqual(
    JSON.parse(writer.files.get("repo_summary.json") ?? "").totals,
    {
      files: 1,
      directories: 1,
      skippedFiles: 0,
    },
  );
});

test("detects important repository files for inspection planning", async () => {
  const reader = new InMemoryRepositoryReader([
    { path: "AGENTS.md", kind: "file", sizeBytes: 100 },
    { path: "README.md", kind: "file", sizeBytes: 120 },
    { path: "docs/architecture.md", kind: "file", sizeBytes: 200 },
    { path: "docs", kind: "directory" },
    { path: "package.json", kind: "file", sizeBytes: 300 },
    { path: "schemas/finding.schema.json", kind: "file", sizeBytes: 400 },
    { path: "schemas", kind: "directory" },
    { path: "src/index.ts", kind: "file", sizeBytes: 42 },
    { path: "tsconfig.json", kind: "file", sizeBytes: 500 },
  ]);
  const writer = new InMemoryRepositoryIndexWriter();

  await indexTargetRepository({
    target: {
      name: "example-service",
      root: "/repos/example-service",
    },
    reader,
    writer,
    workspace,
  });

  assert.deepEqual(JSON.parse(writer.files.get("important_files.json") ?? ""), {
    files: [
      {
        path: "AGENTS.md",
        reason: "agent repository guidance",
        sizeBytes: 100,
      },
      {
        path: "README.md",
        reason: "repository documentation",
        sizeBytes: 120,
      },
      {
        path: "docs/architecture.md",
        reason: "project documentation",
        sizeBytes: 200,
      },
      {
        path: "package.json",
        reason: "package manifest",
        sizeBytes: 300,
      },
      {
        path: "schemas/finding.schema.json",
        reason: "output contract schema",
        sizeBytes: 400,
      },
      {
        path: "tsconfig.json",
        reason: "tooling configuration",
        sizeBytes: 500,
      },
    ],
  });
});

test("keeps huge files in the tree but skips them from important file outputs", async () => {
  const reader = new InMemoryRepositoryReader([
    { path: "README.md", kind: "file", sizeBytes: 2_000_000 },
    { path: "src", kind: "directory" },
    { path: "src/index.ts", kind: "file", sizeBytes: 42 },
  ]);
  const writer = new InMemoryRepositoryIndexWriter();

  await indexTargetRepository({
    target: {
      name: "example-service",
      root: "/repos/example-service",
    },
    reader,
    writer,
    workspace,
    maxFileSizeBytes: 1_000_000,
  });

  assert.equal(
    writer.files.get("file_tree.txt"),
    [
      ".",
      "README.md [skipped: 2000000 bytes]",
      "src/",
      "src/index.ts",
      "",
    ].join("\n"),
  );
  assert.deepEqual(
    JSON.parse(writer.files.get("repo_summary.json") ?? "").totals,
    {
      files: 2,
      directories: 1,
      skippedFiles: 1,
    },
  );
  assert.deepEqual(JSON.parse(writer.files.get("important_files.json") ?? ""), {
    files: [],
  });
});

test("walks a target repository and writes repo_index artifacts through filesystem adapters", async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "inspector-index-"));
  const targetRoot = join(tempDirectory, "target");
  const repoIndexRoot = join(tempDirectory, "run", "repo_index");

  await mkdir(join(targetRoot, "src"), { recursive: true });
  await mkdir(join(targetRoot, "node_modules", "pkg"), { recursive: true });
  await mkdir(repoIndexRoot, { recursive: true });
  await writeFile(join(targetRoot, "README.md"), "# Example\n");
  await writeFile(join(targetRoot, "src", "index.ts"), "export {};\n");
  await writeFile(join(targetRoot, "node_modules", "pkg", "index.js"), "");

  await indexTargetRepository({
    target: {
      name: "example-service",
      root: targetRoot,
    },
    reader: new NodeRepositoryReader(targetRoot),
    writer: new NodeRepositoryIndexWriter(),
    workspace: {
      ...workspace,
      folders: {
        ...workspace.folders,
        repoIndex: repoIndexRoot,
      },
    },
  });

  assert.equal(
    await readFile(join(repoIndexRoot, "file_tree.txt"), "utf8"),
    [
      ".",
      "README.md",
      "src/",
      "src/index.ts",
      "",
    ].join("\n"),
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(repoIndexRoot, "important_files.json"), "utf8")),
    {
      files: [
        {
          path: "README.md",
          reason: "repository documentation",
          sizeBytes: 10,
        },
      ],
    },
  );
});
