import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  appendRejectedSwarmFinding,
  appendSwarmBlackboardSnapshot,
  appendSwarmDecision,
  appendSwarmFinding,
  appendSwarmMemoryEvent,
  appendSwarmQaIssue,
  appendVerifiedSwarmFinding,
  createSchemaContractValidators,
  type Finding,
  type MemoryEvent,
  type QaIssue,
  type RunWorkspace,
} from "../../src/index.js";
import { NodeSwarmMemoryStore } from "../../src/adapters/filesystem/index.js";

const memoryFiles = [
  "blackboard.md",
  "events.jsonl",
  "findings.jsonl",
  "decisions.jsonl",
  "qa_issues.jsonl",
  "verified_findings.jsonl",
  "rejected_findings.jsonl",
] as const;

async function createWorkspace(): Promise<RunWorkspace> {
  const root = await mkdtemp(join(tmpdir(), "inspector-memory-"));
  const memory = join(root, "memory");
  await mkdir(memory, { recursive: true });

  return {
    name: "run-001",
    root,
    configFile: join(root, "config.json"),
    folders: {
      input: join(root, "input"),
      repoIndex: join(root, "repo_index"),
      memory,
      agents: join(root, "agents"),
      validation: join(root, "validation"),
      qa: join(root, "qa"),
      final: join(root, "final"),
    },
  };
}

test("appends schema-valid memory events into run memory", async () => {
  const workspace = await createWorkspace();
  const validators = await createSchemaContractValidators();
  const event: MemoryEvent = {
    id: "event-001",
    timestamp: "2026-06-20T01:02:03.004Z",
    actor: "orchestrator",
    type: "milestone",
    summary: "Repository indexing completed.",
  };

  await appendSwarmMemoryEvent({
    event,
    memory: new NodeSwarmMemoryStore(workspace),
    validator: validators["memory-event"],
  });

  for (const file of memoryFiles) {
    assert.equal((await stat(join(workspace.folders.memory, file))).isFile(), true);
  }
  assert.deepEqual(
    (await readFile(join(workspace.folders.memory, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as MemoryEvent),
    [event],
  );
});

test("preserves append order for memory events", async () => {
  const workspace = await createWorkspace();
  const validators = await createSchemaContractValidators();
  const memory = new NodeSwarmMemoryStore(workspace);
  const events: MemoryEvent[] = [
    {
      id: "event-001",
      timestamp: "2026-06-20T01:02:03.004Z",
      actor: "orchestrator",
      type: "milestone",
      summary: "Repository indexing completed.",
    },
    {
      id: "event-002",
      timestamp: "2026-06-20T01:03:03.004Z",
      actor: "qa-agent",
      type: "qa",
      summary: "Finding needs follow-up.",
    },
  ];

  for (const event of events) {
    await appendSwarmMemoryEvent({
      event,
      memory,
      validator: validators["memory-event"],
    });
  }

  assert.deepEqual(
    (await readFile(join(workspace.folders.memory, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as MemoryEvent),
    events,
  );
});

test("appends findings and QA issues to their run memory streams", async () => {
  const workspace = await createWorkspace();
  const validators = await createSchemaContractValidators();
  const memory = new NodeSwarmMemoryStore(workspace);
  const finding: Finding = {
    id: "finding-001",
    agent: "architecture-agent",
    severity: "medium",
    claim: "Repository indexing preserves deterministic file order.",
    evidence: [{ file: "src/application/index.ts", lineStart: 100, lineEnd: 120 }],
    recommendation: "Keep deterministic sorting at the application boundary.",
    confidence: 0.9,
  };
  const qaIssue: QaIssue = {
    check: "evidence",
    status: "needs-review",
    message: "Finding needs a narrower evidence range.",
    evidence: [{ file: "src/application/index.ts", lineStart: 100, lineEnd: 120 }],
  };

  await appendSwarmFinding({
    finding,
    memory,
    validator: validators.finding,
  });
  await appendVerifiedSwarmFinding({
    finding,
    memory,
    validator: validators.finding,
  });
  await appendRejectedSwarmFinding({
    finding,
    memory,
    validator: validators.finding,
  });
  await appendSwarmQaIssue({
    issue: qaIssue,
    memory,
    validator: validators["qa-issue"],
  });

  assert.deepEqual(
    JSON.parse(
      (await readFile(join(workspace.folders.memory, "findings.jsonl"), "utf8"))
        .trim(),
    ),
    finding,
  );
  assert.deepEqual(
    JSON.parse(
      (
        await readFile(
          join(workspace.folders.memory, "verified_findings.jsonl"),
          "utf8",
        )
      ).trim(),
    ),
    finding,
  );
  assert.deepEqual(
    JSON.parse(
      (
        await readFile(
          join(workspace.folders.memory, "rejected_findings.jsonl"),
          "utf8",
        )
      ).trim(),
    ),
    finding,
  );
  assert.deepEqual(
    JSON.parse(
      (await readFile(join(workspace.folders.memory, "qa_issues.jsonl"), "utf8"))
        .trim(),
    ),
    qaIssue,
  );
});

test("appends decision records and blackboard snapshots", async () => {
  const workspace = await createWorkspace();
  const validators = await createSchemaContractValidators();
  const memory = new NodeSwarmMemoryStore(workspace);
  const decision: MemoryEvent = {
    id: "decision-001",
    timestamp: "2026-06-20T02:00:00.000Z",
    actor: "orchestrator",
    type: "decision",
    summary: "Use package scripts as V1 command detection source.",
    relatedFiles: ["package.json"],
  };

  await appendSwarmDecision({
    decision,
    memory,
    validator: validators["memory-event"],
  });
  await appendSwarmBlackboardSnapshot({
    title: "After indexing",
    body: "Repository index artifacts are available.",
    memory,
  });
  await appendSwarmBlackboardSnapshot({
    title: "After QA",
    body: "One finding needs follow-up.",
    memory,
  });

  assert.deepEqual(
    JSON.parse(
      (await readFile(join(workspace.folders.memory, "decisions.jsonl"), "utf8"))
        .trim(),
    ),
    decision,
  );
  assert.equal(
    await readFile(join(workspace.folders.memory, "blackboard.md"), "utf8"),
    [
      "## After indexing",
      "",
      "Repository index artifacts are available.",
      "",
      "## After QA",
      "",
      "One finding needs follow-up.",
      "",
      "",
    ].join("\n"),
  );
});

test("rejects invalid memory events before appending JSONL", async () => {
  const workspace = await createWorkspace();
  const validators = await createSchemaContractValidators();

  await assert.rejects(
    appendSwarmMemoryEvent({
      event: {
        id: "event-001",
        timestamp: "not-a-date",
        actor: "orchestrator",
        type: "milestone",
        summary: "Invalid event.",
      },
      memory: new NodeSwarmMemoryStore(workspace),
      validator: validators["memory-event"],
    }),
    /Invalid memory event/,
  );

  await assert.rejects(
    readFile(join(workspace.folders.memory, "events.jsonl"), "utf8"),
    /ENOENT/,
  );
});
