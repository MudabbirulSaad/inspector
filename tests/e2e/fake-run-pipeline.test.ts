import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  createDefaultScoutArchitectureFakeRunner,
  type FakeAgentRunner,
} from "../../src/adapters/codex/index.js";
import { runInspectorCli } from "../../src/adapters/cli/index.js";
import { NodeRepositoryReader } from "../../src/adapters/filesystem/index.js";
import type { Clock } from "../../src/index.js";

const fixturesRoot = resolve("tests/fixtures");
const fixedClock: Clock = {
  now: () => new Date("2026-06-20T01:02:03.004Z"),
};

test("fake-run pipeline inspects tiny checked-in repositories end to end", async (context) => {
  const fixtures = ["tiny-node-app", "tiny-layered-app"] as const;

  for (const fixtureName of fixtures) {
    await context.test(fixtureName, async () => {
      const outputDirectory = await mkdtemp(
        join(tmpdir(), `inspector-e2e-${fixtureName}-`),
      );
      const repoPath = join(outputDirectory, fixtureName);
      await cp(join(fixturesRoot, fixtureName), repoPath, { recursive: true });
      const objectivePath = join(outputDirectory, "objective.md");
      await writeFile(
        objectivePath,
        `Inspect ${fixtureName} with the deterministic fake runner.\n`,
      );
      const repositoryReader = new NodeRepositoryReader(repoPath);
      const runner = await createDefaultScoutArchitectureFakeRunner(
        repositoryReader,
        await repositoryReader.listEntries(),
      );
      const stdout: string[] = [];
      const stderr: string[] = [];

      const result = await runInspectorCli({
        argv: [
          "run",
          repoPath,
          "--objective",
          objectivePath,
          "--out",
          outputDirectory,
        ],
        clock: fixedClock,
        runner,
        stdout: (line) => stdout.push(line),
        stderr: (line) => stderr.push(line),
      });

      assert.equal(result.exitCode, 0);
      assert.equal(stderr.join("\n"), "");
      assert.ok(result.workspace);
      assert.equal(
        result.workspace.name,
        `2026-06-20T01-02-03-004Z_${fixtureName}`,
      );
      assert.match(stdout.join("\n"), /Inspection run workspace:/);

      await assertRunWorkspaceArtifacts(result.workspace.root, fixtureName, runner);
    });
  }
});

async function assertRunWorkspaceArtifacts(
  workspaceRoot: string,
  fixtureName: string,
  runner: FakeAgentRunner,
): Promise<void> {
  await assertFile(join(workspaceRoot, "config.json"));
  await assertFile(join(workspaceRoot, "repo_index", "file_tree.txt"));
  await assertFile(join(workspaceRoot, "repo_index", "repo_summary.json"));
  await assertFile(join(workspaceRoot, "repo_index", "important_files.json"));
  await assertFile(join(workspaceRoot, "repo_index", "detected_stack.json"));
  await assertFile(join(workspaceRoot, "repo_index", "detected_commands.json"));

  const fileTree = await readFile(
    join(workspaceRoot, "repo_index", "file_tree.txt"),
    "utf8",
  );
  assert.match(fileTree, /package\.json/);
  assert.match(fileTree, fixtureName === "tiny-node-app" ? /src\/index\.js/ : /src\/app\.ts/);

  assert.deepEqual(
    runner.requests.map((request) => request.agentId),
    [
      "scout",
      "architecture",
      "pattern_miner",
      "flow_tracer",
      "testing_strategy",
      "tradeoff_analyst",
    ],
  );

  for (const agentId of [
    "scout",
    "architecture",
    "pattern_miner",
    "flow_tracer",
    "testing_strategy",
    "tradeoff_analyst",
  ]) {
    await assertFile(join(workspaceRoot, "agents", agentId, "attempt-1", "prompt.md"));
    await assertFile(join(workspaceRoot, "agents", agentId, "attempt-1", "output.json"));
    const status = await assertJsonFile(
      join(workspaceRoot, "agents", agentId, "attempt-1", "status.json"),
    );
    assertRecord(status);
    assert.equal(status.status, "EVIDENCE_VALIDATED");
    assert.ok(
      JSON.stringify(status).includes("EVIDENCE_VALIDATED"),
      `${agentId} status should include EVIDENCE_VALIDATED`,
    );
    await assertJsonFile(
      join(workspaceRoot, "validation", agentId, "attempt-1", "report.json"),
    );
    const evidenceReport = await assertJsonFile(
      join(workspaceRoot, "validation", agentId, "attempt-1", "evidence.json"),
    );
    assertRecord(evidenceReport);
    assert.equal(evidenceReport.valid, true);
  }

  await assertFile(join(workspaceRoot, "memory", "blackboard.md"));
  await assertNonEmptyJsonl(join(workspaceRoot, "memory", "findings.jsonl"));
  await assertNonEmptyJsonl(join(workspaceRoot, "memory", "verified_findings.jsonl"));

  const commandReport = await assertJsonFile(
    join(workspaceRoot, "validation", "command_report.json"),
  );
  assertRecord(commandReport);
  assert.equal(commandReport.skipped, true);
  assert.ok(Array.isArray(commandReport.commands));
  assert.equal(commandReport.commands.length, 0);

  const qaResults = await assertJsonFile(join(workspaceRoot, "qa", "results.json"));
  const qaIssues = await assertJsonFile(join(workspaceRoot, "qa", "issues.json"));
  const revisions = await assertJsonFile(
    join(workspaceRoot, "qa", "revision_requests.json"),
  );
  const readiness = await assertJsonFile(join(workspaceRoot, "qa", "readiness.json"));
  assertRecord(readiness);
  assert.ok(Array.isArray(qaResults));
  assert.equal(qaIssues.length, 0);
  assert.equal(revisions.length, 0);
  assert.equal(readiness.readinessScore, 100);

  await assertFile(join(workspaceRoot, "final", "docs", "00-executive-summary.md"));
  await assertFile(join(workspaceRoot, "final", "docs", "09-verification-report.md"));
  await assertNonEmptyJsonl(join(workspaceRoot, "final", "rag_cards", "patterns.jsonl"));
  await assertNonEmptyJsonl(join(workspaceRoot, "final", "rag_cards", "flows.jsonl"));
  await assertNonEmptyJsonl(join(workspaceRoot, "final", "rag_cards", "decisions.jsonl"));
}

async function assertFile(path: string): Promise<void> {
  assert.ok((await stat(path)).isFile(), `${path} should exist`);
}

async function assertJsonFile(path: string): Promise<Record<string, unknown> | unknown[]> {
  await assertFile(path);
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> | unknown[];
}

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
}

async function assertNonEmptyJsonl(path: string): Promise<void> {
  await assertFile(path);
  const lines = (await readFile(path, "utf8"))
    .split("\n")
    .filter((line) => line.trim().length > 0);
  assert.ok(lines.length > 0, `${path} should contain JSONL records`);
  for (const line of lines) {
    JSON.parse(line);
  }
}
