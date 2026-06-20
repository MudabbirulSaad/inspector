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
  constructor(
    private readonly entries: RepositoryEntry[],
    private readonly files = new Map<string, string>(),
  ) {}

  async listEntries(): Promise<RepositoryEntry[]> {
    return this.entries;
  }

  async readTextFile(path: string): Promise<string> {
    const content = this.files.get(path);

    if (content === undefined) {
      throw new Error(`Missing fixture file: ${path}`);
    }

    return content;
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

test("omits local agent operational state from index artifacts", async () => {
  const reader = new InMemoryRepositoryReader([
    { path: ".agents", kind: "directory" },
    { path: ".agents/memory.md", kind: "file", sizeBytes: 100 },
    { path: ".agents/state", kind: "directory" },
    { path: ".agents/state/run/output.json", kind: "file", sizeBytes: 200 },
    { path: ".inspector-runs", kind: "directory" },
    {
      path: ".inspector-runs/2026-06-20T00-00-00-000Z_repo/config.json",
      kind: "file",
      sizeBytes: 300,
    },
    { path: "README.md", kind: "file", sizeBytes: 120 },
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
      "README.md",
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
      skippedFiles: 0,
    },
  );
});

test("omits generated public Inspector docs from index artifacts", async () => {
  const reader = new InMemoryRepositoryReader([
    { path: "docs", kind: "directory" },
    { path: "docs/inspector", kind: "directory" },
    {
      path: "docs/inspector/00-executive-summary.md",
      kind: "file",
      sizeBytes: 120,
    },
    { path: "docs/architecture.md", kind: "file", sizeBytes: 240 },
    { path: "README.md", kind: "file", sizeBytes: 120 },
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
      "README.md",
      "docs/",
      "docs/architecture.md",
      "",
    ].join("\n"),
  );
});

test("omits Inspector dogfood run artifacts from all index artifacts", async () => {
  const reader = new InMemoryRepositoryReader(
    [
      { path: ".inspector-dogfood", kind: "directory" },
      { path: ".inspector-dogfood/runs", kind: "directory" },
      { path: ".inspector-dogfood/runs/example", kind: "directory" },
      {
        path: ".inspector-dogfood/runs/example/agents/flow_tracer/attempt-1/status.json",
        kind: "file",
        sizeBytes: 300,
      },
      {
        path: ".inspector-dogfood/runs/example/config.json",
        kind: "file",
        sizeBytes: 120,
      },
      { path: "README.md", kind: "file", sizeBytes: 120 },
      { path: "src", kind: "directory" },
      { path: "src/index.ts", kind: "file", sizeBytes: 42 },
    ],
    new Map([
      [
        ".inspector-dogfood/runs/example/config.json",
        JSON.stringify({ target: "example" }),
      ],
    ]),
  );
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

  for (const content of writer.files.values()) {
    assert.doesNotMatch(content, /\.inspector-dogfood/);
  }
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
  assert.deepEqual(JSON.parse(writer.files.get("important_files.json") ?? ""), {
    files: [
      {
        path: "README.md",
        reason: "repository documentation",
        sizeBytes: 120,
      },
    ],
  });
  assert.deepEqual(
    JSON.parse(writer.files.get("repo_summary.json") ?? "").totals,
    {
      files: 2,
      directories: 1,
      skippedFiles: 0,
    },
  );
});

test("omits configured output directory inside target root from all index artifacts", async () => {
  const reader = new InMemoryRepositoryReader(
    [
      { path: ".custom-output", kind: "directory" },
      { path: ".custom-output/runs", kind: "directory" },
      { path: ".custom-output/runs/example", kind: "directory" },
      {
        path: ".custom-output/runs/example/config.json",
        kind: "file",
        sizeBytes: 120,
      },
      { path: "README.md", kind: "file", sizeBytes: 120 },
      { path: "src", kind: "directory" },
      { path: "src/index.ts", kind: "file", sizeBytes: 42 },
    ],
    new Map([
      [
        ".custom-output/runs/example/config.json",
        JSON.stringify({ target: "example" }),
      ],
    ]),
  );
  const writer = new InMemoryRepositoryIndexWriter();

  await indexTargetRepository({
    target: {
      name: "example-service",
      root: "/repos/example-service",
    },
    outputDirectory: "/repos/example-service/.custom-output/runs",
    reader,
    writer,
    workspace,
  });

  for (const content of writer.files.values()) {
    assert.doesNotMatch(content, /\.custom-output\/runs/);
  }
  assert.equal(
    writer.files.get("file_tree.txt"),
    [
      ".",
      ".custom-output/",
      "README.md",
      "src/",
      "src/index.ts",
      "",
    ].join("\n"),
  );
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

test("detects important repository files for inspection planning", async () => {
  const reader = new InMemoryRepositoryReader(
    [
      { path: "AGENTS.md", kind: "file", sizeBytes: 100 },
      { path: "README.md", kind: "file", sizeBytes: 120 },
      { path: "docs/architecture.md", kind: "file", sizeBytes: 200 },
      { path: "docs", kind: "directory" },
      { path: "package.json", kind: "file", sizeBytes: 300 },
      { path: "schemas/finding.schema.json", kind: "file", sizeBytes: 400 },
      { path: "schemas", kind: "directory" },
      { path: "src/index.ts", kind: "file", sizeBytes: 42 },
      { path: "tsconfig.json", kind: "file", sizeBytes: 500 },
    ],
    new Map([["package.json", "{}"]]),
  );
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
  await writeFile(
    join(targetRoot, "package.json"),
    JSON.stringify({ scripts: { test: "node --test" } }),
  );
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
      "package.json",
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
        {
          path: "package.json",
          reason: "package manifest",
          sizeBytes: 34,
        },
      ],
    },
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(repoIndexRoot, "detected_commands.json"), "utf8")),
    {
      commands: [
        { category: "test", command: "npm test", source: "package.json" },
      ],
      missing: ["build", "dev", "format", "lint", "typecheck"],
    },
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(repoIndexRoot, "detected_stack.json"), "utf8")),
    {
      stacks: [
        {
          name: "node",
          confidence: "high",
          evidence: ["package.json"],
        },
        {
          name: "typescript",
          confidence: "high",
          evidence: ["package.json", "src/index.ts"],
        },
      ],
      packageManager: {
        name: "npm",
        evidence: ["package.json"],
      },
    },
  );
});

test("filesystem repository reader rejects text reads outside the repository root", async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "inspector-reader-"));
  const targetRoot = join(tempDirectory, "target");

  await mkdir(targetRoot, { recursive: true });
  await writeFile(join(targetRoot, "README.md"), "# Example\n");
  await writeFile(join(tempDirectory, "outside.txt"), "secret\n");

  const reader = new NodeRepositoryReader(targetRoot);

  assert.equal(await reader.readTextFile("README.md"), "# Example\n");
  await assert.rejects(
    () => reader.readTextFile("../outside.txt"),
    /outside the repository root/,
  );
});

test("detects Node package scripts as quality commands", async () => {
  const reader = new InMemoryRepositoryReader(
    [
      { path: "package.json", kind: "file", sizeBytes: 250 },
      { path: "src", kind: "directory" },
      { path: "src/index.ts", kind: "file", sizeBytes: 42 },
    ],
    new Map([
      [
        "package.json",
        JSON.stringify({
          scripts: {
            test: "node --test",
            typecheck: "tsc --noEmit",
            lint: "eslint .",
            build: "tsc",
            dev: "tsx src/index.ts",
            format: "prettier --write .",
          },
          devDependencies: {
            typescript: "^6.0.3",
            tsx: "^4.22.4",
          },
        }),
      ],
    ]),
  );
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

  assert.deepEqual(JSON.parse(writer.files.get("detected_commands.json") ?? ""), {
    commands: [
      { category: "build", command: "npm run build", source: "package.json" },
      { category: "dev", command: "npm run dev", source: "package.json" },
      { category: "format", command: "npm run format", source: "package.json" },
      { category: "lint", command: "npm run lint", source: "package.json" },
      { category: "test", command: "npm test", source: "package.json" },
      {
        category: "typecheck",
        command: "npm run typecheck",
        source: "package.json",
      },
    ],
    missing: [],
  });
  assert.deepEqual(JSON.parse(writer.files.get("detected_stack.json") ?? ""), {
    stacks: [
      {
        name: "node",
        confidence: "high",
        evidence: ["package.json"],
      },
      {
        name: "typescript",
        confidence: "high",
        evidence: ["package.json", "src/index.ts"],
      },
    ],
    packageManager: {
      name: "npm",
      evidence: ["package.json"],
    },
  });
});

test("reports missing command categories and detects package managers from lockfiles", async () => {
  const cases = [
    {
      lockfile: "package-lock.json",
      packageManager: "npm",
      expectedTestCommand: "npm test",
    },
    {
      lockfile: "yarn.lock",
      packageManager: "yarn",
      expectedTestCommand: "yarn test",
    },
    {
      lockfile: "pnpm-lock.yaml",
      packageManager: "pnpm",
      expectedTestCommand: "pnpm test",
    },
  ] as const;

  for (const fixture of cases) {
    const reader = new InMemoryRepositoryReader(
      [
        { path: fixture.lockfile, kind: "file", sizeBytes: 10 },
        { path: "package.json", kind: "file", sizeBytes: 80 },
      ],
      new Map([
        [
          "package.json",
          JSON.stringify({
            scripts: {
              test: "node --test",
            },
          }),
        ],
      ]),
    );
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

    assert.deepEqual(
      JSON.parse(writer.files.get("detected_commands.json") ?? ""),
      {
        commands: [
          {
            category: "test",
            command: fixture.expectedTestCommand,
            source: "package.json",
          },
        ],
        missing: ["build", "dev", "format", "lint", "typecheck"],
      },
    );
    assert.deepEqual(
      JSON.parse(writer.files.get("detected_stack.json") ?? "").packageManager,
      {
        name: fixture.packageManager,
        evidence: [fixture.lockfile],
      },
    );
  }
});

test("detects stack signals from TypeScript, Docker, GitHub Actions, and non-Node manifests", async () => {
  const reader = new InMemoryRepositoryReader(
    [
      { path: ".github", kind: "directory" },
      { path: ".github/workflows", kind: "directory" },
      { path: ".github/workflows/ci.yml", kind: "file", sizeBytes: 80 },
      { path: "Cargo.toml", kind: "file", sizeBytes: 70 },
      { path: "Dockerfile", kind: "file", sizeBytes: 30 },
      { path: "go.mod", kind: "file", sizeBytes: 60 },
      { path: "package.json", kind: "file", sizeBytes: 120 },
      { path: "pyproject.toml", kind: "file", sizeBytes: 90 },
      { path: "requirements.txt", kind: "file", sizeBytes: 20 },
      { path: "tsconfig.json", kind: "file", sizeBytes: 110 },
    ],
    new Map([
      [
        "package.json",
        JSON.stringify({
          scripts: {},
        }),
      ],
    ]),
  );
  const writer = new InMemoryRepositoryIndexWriter();

  await indexTargetRepository({
    target: {
      name: "polyglot-service",
      root: "/repos/polyglot-service",
    },
    reader,
    writer,
    workspace,
  });

  assert.deepEqual(JSON.parse(writer.files.get("detected_stack.json") ?? ""), {
    stacks: [
      {
        name: "node",
        confidence: "high",
        evidence: ["package.json"],
      },
      {
        name: "typescript",
        confidence: "high",
        evidence: ["package.json", "tsconfig.json"],
      },
      {
        name: "python",
        confidence: "medium",
        evidence: ["pyproject.toml", "requirements.txt"],
      },
      {
        name: "rust",
        confidence: "medium",
        evidence: ["Cargo.toml"],
      },
      {
        name: "go",
        confidence: "medium",
        evidence: ["go.mod"],
      },
      {
        name: "docker",
        confidence: "medium",
        evidence: ["Dockerfile"],
      },
      {
        name: "github-actions",
        confidence: "medium",
        evidence: [".github/workflows/ci.yml"],
      },
    ],
    packageManager: {
      name: "npm",
      evidence: ["package.json"],
    },
  });
});
