import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  runQualityCommands,
  writeQualityCommandReport,
  type DetectedCommands,
  type ProcessRunner,
  type ProcessRunRequest,
  type ProcessRunResult,
  type RunWorkspace,
} from "../../src/index.js";
import { NodeQualityCommandReportWriter } from "../../src/adapters/filesystem/index.js";

test("runs safe quality commands and reports successful results", async () => {
  const runner = new QueuedProcessRunner([
    processResult({
      stdout: "tests passed\n",
      startedAt: "2026-06-20T00:00:00.000Z",
      completedAt: "2026-06-20T00:00:02.500Z",
    }),
    processResult({
      stdout: "types passed\n",
      startedAt: "2026-06-20T00:00:03.000Z",
      completedAt: "2026-06-20T00:00:04.000Z",
    }),
  ]);

  const report = await runQualityCommands({
    detectedCommands: {
      commands: [
        { category: "test", command: "npm test", source: "package.json" },
        {
          category: "typecheck",
          command: "npm run typecheck",
          source: "package.json",
        },
        { category: "dev", command: "npm run dev", source: "package.json" },
      ],
      missing: ["build", "format", "lint"],
    },
    cwd: "/repo",
    runner,
    timeoutMs: 1000,
    enabled: true,
  });

  assert.deepEqual(
    runner.requests.map((request) => ({
      command: request.command,
      args: request.args,
      cwd: request.cwd,
      timeoutMs: request.timeoutMs,
    })),
    [
      { command: "npm", args: ["test"], cwd: "/repo", timeoutMs: 1000 },
      {
        command: "npm",
        args: ["run", "typecheck"],
        cwd: "/repo",
        timeoutMs: 1000,
      },
    ],
  );
  assert.deepEqual(report, {
    commands: [
      {
        command: "npm",
        args: ["test"],
        exitCode: 0,
        stdout: "tests passed\n",
        stderr: "",
        durationMs: 2500,
        status: "passed",
      },
      {
        command: "npm",
        args: ["run", "typecheck"],
        exitCode: 0,
        stdout: "types passed\n",
        stderr: "",
        durationMs: 1000,
        status: "passed",
      },
    ],
  });
});

test("skips quality commands by default without invoking the process runner", async () => {
  const runner = new QueuedProcessRunner([]);

  const report = await runQualityCommands({
    detectedCommands: detected("test", "npm test"),
    cwd: "/repo",
    runner,
  });

  assert.deepEqual(runner.requests, []);
  assert.deepEqual(report, {
    skipped: true,
    reason:
      "Quality command execution is disabled by default. Use --run-quality-commands or runQualityCommands: true only for trusted repositories.",
    commands: [],
  });
});

test("executes safe quality commands when explicitly enabled", async () => {
  const runner = new QueuedProcessRunner([
    processResult({
      stdout: "tests passed\n",
      startedAt: "2026-06-20T00:00:00.000Z",
      completedAt: "2026-06-20T00:00:00.250Z",
    }),
  ]);

  const report = await runQualityCommands({
    detectedCommands: detected("test", "npm test"),
    cwd: "/repo",
    runner,
    enabled: true,
  });

  assert.deepEqual(runner.requests.map((request) => request.command), ["npm"]);
  assert.deepEqual(report.commands, [
    {
      command: "npm",
      args: ["test"],
      exitCode: 0,
      stdout: "tests passed\n",
      stderr: "",
      durationMs: 250,
      status: "passed",
    },
  ]);
});

test("reports failed quality commands with captured output", async () => {
  const runner = new QueuedProcessRunner([
    processResult({
      stdout: "one test failed\n",
      stderr: "assertion error\n",
      exitCode: 1,
      startedAt: "2026-06-20T00:00:00.000Z",
      completedAt: "2026-06-20T00:00:00.120Z",
    }),
  ]);

  const report = await runQualityCommands({
    detectedCommands: detected("test", "npm test"),
    cwd: "/repo",
    runner,
    enabled: true,
  });

  assert.deepEqual(report.commands, [
    {
      command: "npm",
      args: ["test"],
      exitCode: 1,
      stdout: "one test failed\n",
      stderr: "assertion error\n",
      durationMs: 120,
      status: "failed",
    },
  ]);
});

test("blocks unsafe or unapproved detected commands without executing them", async () => {
  const runner = new QueuedProcessRunner([]);

  const report = await runQualityCommands({
    detectedCommands: detected("test", "npm test && rm -rf dist"),
    cwd: "/repo",
    runner,
    enabled: true,
  });

  assert.deepEqual(runner.requests, []);
  assert.deepEqual(report.commands, [
    {
      command: "npm test && rm -rf dist",
      args: [],
      exitCode: null,
      stdout: "",
      stderr: "Dangerous shell syntax is not allowed in validation commands: npm test && rm -rf dist",
      durationMs: 0,
      status: "blocked",
    },
  ]);
});

test("reports timed out quality commands distinctly", async () => {
  const runner = new QueuedProcessRunner([
    processResult({
      exitCode: 1,
      stderr: "",
      failureReason: "process timed out after 50ms",
      startedAt: "2026-06-20T00:00:00.000Z",
      completedAt: "2026-06-20T00:00:00.050Z",
    }),
  ]);

  const report = await runQualityCommands({
    detectedCommands: detected("build", "npm run build"),
    cwd: "/repo",
    runner,
    timeoutMs: 50,
    enabled: true,
  });

  assert.deepEqual(report.commands, [
    {
      command: "npm",
      args: ["run", "build"],
      exitCode: 1,
      stdout: "",
      stderr: "",
      durationMs: 50,
      status: "timeout",
    },
  ]);
});

test("writes the quality command report under the workspace validation folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-quality-report-"));
  const workspace = workspaceAt(root);
  const report = {
    commands: [
      {
        command: "npm",
        args: ["test"],
        exitCode: 0,
        stdout: "ok\n",
        stderr: "",
        durationMs: 25,
        status: "passed" as const,
      },
    ],
  };

  const result = await writeQualityCommandReport({
    workspace,
    report,
    writer: new NodeQualityCommandReportWriter(),
  });

  assert.equal(result.path, join(root, "validation", "command_report.json"));
  assert.deepEqual(
    JSON.parse(await readFile(result.path, "utf8")) as unknown,
    report,
  );
});

function detected(
  category: DetectedCommands["commands"][number]["category"],
  command: string,
): DetectedCommands {
  return {
    commands: [{ category, command, source: "package.json" }],
    missing: [],
  };
}

function workspaceAt(root: string): RunWorkspace {
  return {
    name: "run",
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

function processResult(overrides: Partial<ProcessRunResult> = {}): ProcessRunResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    startedAt: "2026-06-20T00:00:00.000Z",
    completedAt: "2026-06-20T00:00:00.000Z",
    streamingEvents: [],
    ...overrides,
  };
}

class QueuedProcessRunner implements ProcessRunner {
  readonly requests: ProcessRunRequest[] = [];

  constructor(private readonly results: ProcessRunResult[]) {}

  async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    this.requests.push(request);
    const result = this.results.shift();
    if (result === undefined) {
      throw new Error("No queued process result");
    }
    return result;
  }
}
