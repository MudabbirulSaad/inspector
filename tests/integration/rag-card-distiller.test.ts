import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  generateRagKnowledgeCards,
  InvalidRagKnowledgeCardError,
  type Finding,
  type RagKnowledgeCardStream,
  type RagKnowledgeCardWriter,
  type RunWorkspace,
} from "../../src/index.js";
import { NodeRagKnowledgeCardWriter } from "../../src/adapters/filesystem/index.js";
import { createSchemaContractValidators } from "../../src/validation/index.js";

async function createWorkspace(): Promise<RunWorkspace> {
  const root = await mkdtemp(join(tmpdir(), "inspector-rag-cards-"));
  const final = join(root, "final");
  await mkdir(final, { recursive: true });

  return {
    name: "rag-card-run",
    root,
    configFile: join(root, "config.json"),
    folders: {
      input: join(root, "input"),
      repoIndex: join(root, "repo_index"),
      memory: join(root, "memory"),
      agents: join(root, "agents"),
      validation: join(root, "validation"),
      qa: join(root, "qa"),
      final,
    },
  };
}

test("RAG card distiller writes valid JSONL cards from approved findings", async () => {
  const workspace = await createWorkspace();
  const validators = await createSchemaContractValidators();
  const approvedFinding: Finding = {
    id: "finding-approved-decision",
    agent: "architecture",
    severity: "low",
    claim: "Application logic depends on ports rather than adapters.",
    evidence: [{ file: "src/application/index.ts", lineStart: 1, lineEnd: 12 }],
    recommendation: "Keep new orchestration behavior behind application ports.",
    confidence: 0.9,
    tags: ["architecture", "hexagonal"],
    cardType: "decision",
    audience: "coding-agent",
    whenToUse: "When adding orchestration that needs filesystem or process work.",
    whenNotToUse: "When code is purely domain modeling.",
    adaptationNotes: "Define a port first, then add the adapter.",
  };

  await generateRagKnowledgeCards({
    workspace,
    writer: new NodeRagKnowledgeCardWriter(),
    repository: { name: "inspector", root: "/repo" },
    approvedFindings: [approvedFinding],
    rejectedFindings: [],
    validator: validators["knowledge-card"],
    generatedAt: new Date("2026-06-20T01:02:03.004Z"),
  });

  const decisionsJsonl = await readFile(
    join(workspace.folders.final, "rag_cards", "decisions.jsonl"),
    "utf8",
  );
  const lines = decisionsJsonl.trim().split("\n");
  assert.equal(lines.length, 1);

  const card = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
  assert.equal(card.id, "rag-card-finding-approved-decision");
  assert.equal(card.topic, approvedFinding.claim);
  assert.equal(card.sourceRepo, "inspector");
  assert.equal(card.confidence, approvedFinding.confidence);
  assert.deepEqual(card.tags, approvedFinding.tags);
  assert.equal(card.audience, "coding-agent");
  assert.equal(card.whenToUse, approvedFinding.whenToUse);
  assert.equal(card.whenNotToUse, approvedFinding.whenNotToUse);
  assert.equal(card.adaptationNotes, approvedFinding.adaptationNotes);
  assert.deepEqual(card.evidence, [
    {
      file: "src/application/index.ts",
      lineStart: 1,
      lineEnd: 12,
      findingId: approvedFinding.id,
    },
  ]);
  assert.equal(validators["knowledge-card"].validate(card).valid, true);
});

test("RAG card distiller excludes rejected findings from every JSONL stream", async () => {
  const workspace = await createWorkspace();
  const validators = await createSchemaContractValidators();
  const approvedFinding: Finding = {
    id: "finding-approved-pattern",
    agent: "pattern_miner",
    severity: "low",
    claim: "Ports hide filesystem details from application services.",
    evidence: [{ file: "src/ports/index.ts", lineStart: 1, lineEnd: 20 }],
    recommendation: "Introduce ports before filesystem adapters.",
    confidence: 0.88,
    tags: ["ports", "filesystem"],
  };
  const rejectedFinding: Finding = {
    id: "finding-rejected-warning",
    agent: "architecture",
    severity: "critical",
    claim: "Rejected findings must never become trusted cards.",
    evidence: [{ file: "src/domain/types.ts", lineStart: 1, lineEnd: 2 }],
    recommendation: "Exclude QA-rejected claims from RAG outputs.",
    confidence: 0.2,
    tags: ["rejected"],
    cardType: "warning",
  };

  await generateRagKnowledgeCards({
    workspace,
    writer: new NodeRagKnowledgeCardWriter(),
    repository: { name: "inspector", root: "/repo" },
    approvedFindings: [approvedFinding],
    rejectedFindings: [rejectedFinding],
    validator: validators["knowledge-card"],
    generatedAt: new Date("2026-06-20T01:02:03.004Z"),
  });

  const ragCardsDirectory = join(workspace.folders.final, "rag_cards");
  const outputs = await Promise.all(
    ["patterns.jsonl", "flows.jsonl", "decisions.jsonl", "warnings.jsonl"].map(
      (file) => readFile(join(ragCardsDirectory, file), "utf8"),
    ),
  );
  const allCards = outputs.join("");

  assert.match(allCards, /finding-approved-pattern/);
  assert.doesNotMatch(allCards, /finding-rejected-warning/);
  assert.doesNotMatch(allCards, /Rejected findings must never become trusted cards/);
});

test("RAG card distiller fails before writing invalid cards", async () => {
  const workspace = await createWorkspace();
  const validators = await createSchemaContractValidators();
  const writer = new CapturingRagKnowledgeCardWriter();
  const invalidApprovedFinding: Finding = {
    id: "finding-without-evidence",
    agent: "architecture",
    severity: "low",
    claim: "A card without evidence is invalid.",
    evidence: [],
    recommendation: "Do not write RAG cards without traceable evidence.",
    confidence: 0.7,
    tags: ["invalid"],
  };

  await assert.rejects(
    generateRagKnowledgeCards({
      workspace,
      writer,
      repository: { name: "inspector", root: "/repo" },
      approvedFindings: [invalidApprovedFinding],
      rejectedFindings: [],
      validator: validators["knowledge-card"],
      generatedAt: new Date("2026-06-20T01:02:03.004Z"),
    }),
    InvalidRagKnowledgeCardError,
  );

  assert.equal(writer.writeCount, 0);
});

test("RAG card distiller writes valid JSONL to each card stream", async () => {
  const workspace = await createWorkspace();
  const validators = await createSchemaContractValidators();
  const findings: Finding[] = [
    buildFinding("finding-pattern", "pattern_miner", "info", "pattern"),
    buildFinding("finding-flow", "flow_tracer", "info", "flow"),
    buildFinding("finding-decision", "architecture", "low", "decision"),
    buildFinding("finding-warning", "architecture", "high", "warning"),
  ];

  await generateRagKnowledgeCards({
    workspace,
    writer: new NodeRagKnowledgeCardWriter(),
    repository: { name: "inspector", root: "/repo" },
    approvedFindings: findings,
    rejectedFindings: [],
    validator: validators["knowledge-card"],
    generatedAt: new Date("2026-06-20T01:02:03.004Z"),
  });

  for (const [file, expectedFindingId] of [
    ["patterns.jsonl", "finding-pattern"],
    ["flows.jsonl", "finding-flow"],
    ["decisions.jsonl", "finding-decision"],
    ["warnings.jsonl", "finding-warning"],
  ] as const) {
    const content = await readFile(
      join(workspace.folders.final, "rag_cards", file),
      "utf8",
    );
    const lines = content.trim().split("\n");
    assert.equal(lines.length, 1, `${file} should contain one card`);
    const card = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    assert.equal(card.id, `rag-card-${expectedFindingId}`);
    assert.equal(validators["knowledge-card"].validate(card).valid, true);
  }
});

class CapturingRagKnowledgeCardWriter implements RagKnowledgeCardWriter {
  writeCount = 0;

  async writeRagKnowledgeCards(): Promise<
    Record<RagKnowledgeCardStream, { path: string }>
  > {
    this.writeCount += 1;
    return {
      patterns: { path: "patterns.jsonl" },
      flows: { path: "flows.jsonl" },
      decisions: { path: "decisions.jsonl" },
      warnings: { path: "warnings.jsonl" },
    };
  }
}

function buildFinding(
  id: string,
  agent: string,
  severity: Finding["severity"],
  cardType: NonNullable<Finding["cardType"]>,
): Finding {
  return {
    id,
    agent,
    severity,
    claim: `${id} claim`,
    evidence: [{ file: "README.md", lineStart: 1, lineEnd: 1 }],
    recommendation: `${id} recommendation`,
    confidence: 0.75,
    tags: [cardType],
    cardType,
  };
}
