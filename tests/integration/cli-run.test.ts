import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FakeAgentRunner } from "../../src/adapters/codex/index.js";
import { runInspectorCli } from "../../src/adapters/cli/index.js";
import type { AgentRunResult, Clock } from "../../src/index.js";

const fixedClock: Clock = {
  now: () => new Date("2026-06-20T01:02:03.004Z"),
};

const scoutFinding = {
  id: "finding-scout-001",
  agent: "scout",
  severity: "info",
  claim: "The repository includes a README entrypoint for inspection context.",
  evidence: [
    {
      file: "README.md",
      lineStart: 1,
      lineEnd: 2,
    },
  ],
  recommendation: "Use the README as initial repository context.",
  confidence: 0.7,
};

function successfulScoutResult(stdout = JSON.stringify(scoutFinding)): AgentRunResult {
  return {
    stdout,
    stderr: "",
    exitCode: 0,
    startedAt: "2026-06-20T01:02:04.000Z",
    completedAt: "2026-06-20T01:02:05.000Z",
    outputArtifactPaths: [],
    streamingEvents: [],
  };
}

async function createFixture(): Promise<{
  tempDirectory: string;
  repoPath: string;
  objectivePath: string;
  outPath: string;
}> {
  const tempDirectory = await mkdtemp(join(tmpdir(), "inspector-cli-run-"));
  const repoPath = join(tempDirectory, "target-repo");
  const objectivePath = join(tempDirectory, "objective.md");
  const outPath = join(tempDirectory, "runs");

  await mkdir(repoPath);
  await writeFile(join(repoPath, "README.md"), "# Target\n\nContext.\n");
  await writeFile(objectivePath, "Inspect the repository structure.\n");

  return { tempDirectory, repoPath, objectivePath, outPath };
}

test("CLI run creates a run workspace for a valid command", async () => {
  const fixture = await createFixture();
  const stdout: string[] = [];
  const stderr: string[] = [];

  const result = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      fixture.objectivePath,
      "--out",
      fixture.outPath,
    ],
    clock: fixedClock,
    runner: new FakeAgentRunner({ results: [successfulScoutResult()] }),
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(stderr.length, 0);
  assert.equal(
    await readFile(
      join(
        fixture.outPath,
        "2026-06-20T01-02-03-004Z_target-repo",
        "repo_index",
        "file_tree.txt",
      ),
      "utf8",
    ),
    ".\nREADME.md\n",
  );
});

test("CLI run reports a missing repository path", async () => {
  const fixture = await createFixture();
  const stderr: string[] = [];

  const result = await runInspectorCli({
    argv: ["run", "--objective", fixture.objectivePath, "--out", fixture.outPath],
    clock: fixedClock,
    runner: new FakeAgentRunner({ results: [successfulScoutResult()] }),
    stderr: (line) => stderr.push(line),
  });

  assert.equal(result.exitCode, 1);
  assert.match(stderr.join("\n"), /Missing repository path/);
});

test("CLI run reports a missing objective file", async () => {
  const fixture = await createFixture();
  const stderr: string[] = [];

  const result = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      join(fixture.tempDirectory, "missing-objective.md"),
      "--out",
      fixture.outPath,
    ],
    clock: fixedClock,
    runner: new FakeAgentRunner({ results: [successfulScoutResult()] }),
    stderr: (line) => stderr.push(line),
  });

  assert.equal(result.exitCode, 1);
  assert.match(stderr.join("\n"), /Objective file does not exist/);
});

test("CLI run sends the objective to the fake Scout runner and saves Scout output", async () => {
  const fixture = await createFixture();
  const runner = new FakeAgentRunner({ results: [successfulScoutResult()] });

  const result = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      fixture.objectivePath,
      "--out",
      fixture.outPath,
    ],
    clock: fixedClock,
    runner,
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(runner.requests.length, 1);
  assert.equal(runner.requests[0]?.agentId, "scout");
  assert.match(runner.requests[0]?.prompt ?? "", /Inspect the repository/);
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(
          fixture.outPath,
          "2026-06-20T01-02-03-004Z_target-repo",
          "agents",
          "scout",
          "attempt-1",
          "output.json",
        ),
        "utf8",
      ),
    ),
    scoutFinding,
  );
});

test("CLI run writes repository, memory, schema, and evidence artifacts", async () => {
  const fixture = await createFixture();

  const result = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      fixture.objectivePath,
      "--out",
      fixture.outPath,
    ],
    clock: fixedClock,
    runner: new FakeAgentRunner({ results: [successfulScoutResult()] }),
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 0);
  const workspaceRoot = join(
    fixture.outPath,
    "2026-06-20T01-02-03-004Z_target-repo",
  );

  assert.equal(
    (await stat(join(workspaceRoot, "repo_index", "repo_summary.json"))).isFile(),
    true,
  );
  assert.match(
    await readFile(join(workspaceRoot, "memory", "blackboard.md"), "utf8"),
    /Run initialized/,
  );
  assert.match(
    await readFile(
      join(workspaceRoot, "validation", "scout", "attempt-1", "report.json"),
      "utf8",
    ),
    /"status": "passed"/,
  );
  assert.match(
    await readFile(
      join(workspaceRoot, "validation", "scout", "attempt-1", "evidence.json"),
      "utf8",
    ),
    /"valid": true/,
  );
});

test("CLI run prints verbose progress and Scout streaming output", async () => {
  const fixture = await createFixture();
  const stdout: string[] = [];

  const result = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      fixture.objectivePath,
      "--out",
      fixture.outPath,
      "--verbose",
    ],
    clock: fixedClock,
    runner: new FakeAgentRunner({
      results: [
        successfulScoutResult(JSON.stringify(scoutFinding)),
      ].map((agentResult) => ({
        ...agentResult,
        streamingEvents: [
          {
            timestamp: "2026-06-20T01:02:04.500Z",
            kind: "status" as const,
            message: "Scout started",
          },
        ],
      })),
    }),
    stdout: (line) => stdout.push(line),
  });

  assert.equal(result.exitCode, 0);
  assert.match(stdout.join("\n"), /Creating run workspace/);
  assert.match(stdout.join("\n"), /Indexing repository/);
  assert.match(stdout.join("\n"), /\[scout:status\] Scout started/);
  assert.match(stdout.join("\n"), /Inspection run workspace:/);
});
