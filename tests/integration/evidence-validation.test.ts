import assert from "node:assert/strict";
import test from "node:test";

import {
  repositoryFilesForEvidence,
  validateEvidenceReferences,
} from "../../src/application/index.js";
import type { Finding, KnowledgeCard, QaResult } from "../../src/domain/types.js";
import type { RepositoryEntry, RepositoryReader } from "../../src/ports/index.js";

const finding: Finding = {
  id: "finding-001",
  agent: "architecture",
  severity: "medium",
  claim: "Workflow logic belongs in the application layer.",
  evidence: [
    {
      file: "src/application/orchestrate.ts",
      lineStart: 4,
      lineEnd: 8,
    },
  ],
  recommendation: "Keep orchestration behind application services.",
  confidence: 0.82,
};

test("evidence validator accepts existing file evidence with a valid line range", () => {
  const result = validateEvidenceReferences({
    repositoryFiles: [
      {
        path: "src/application/orchestrate.ts",
        lineCount: 12,
      },
    ],
    findings: [finding],
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("evidence validator rejects cited files that are absent from the repository", () => {
  const result = validateEvidenceReferences({
    repositoryFiles: [],
    findings: [finding],
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors[0]?.code, "missing-file");
  assert.equal(result.errors[0]?.artifactId, "finding-001");
  assert.match(result.errors[0]?.message ?? "", /does not exist/);
});

test("evidence validator rejects line ranges outside the cited file", () => {
  const result = validateEvidenceReferences({
    repositoryFiles: [
      {
        path: "src/application/orchestrate.ts",
        lineCount: 6,
      },
    ],
    findings: [finding],
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors[0]?.code, "invalid-line-range");
  assert.match(result.errors[0]?.message ?? "", /4-8/);
});

test("evidence validator rejects line ranges where the start is after the end", () => {
  const result = validateEvidenceReferences({
    repositoryFiles: [
      {
        path: "src/application/orchestrate.ts",
        lineCount: 20,
      },
    ],
    findings: [
      {
        ...finding,
        evidence: [
          {
            file: "src/application/orchestrate.ts",
            lineStart: 9,
            lineEnd: 4,
          },
        ],
      },
    ],
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors[0]?.code, "invalid-line-range");
});

test("evidence validator rejects a zero line start", () => {
  const result = validateEvidenceReferences({
    repositoryFiles: [
      {
        path: "src/application/orchestrate.ts",
        lineCount: 20,
      },
    ],
    findings: [
      {
        ...finding,
        evidence: [
          {
            file: "src/application/orchestrate.ts",
            lineStart: 0,
            lineEnd: 4,
          },
        ],
      },
    ],
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors[0]?.code, "invalid-line-range");
});

test("evidence validator rejects a zero line end", () => {
  const result = validateEvidenceReferences({
    repositoryFiles: [
      {
        path: "src/application/orchestrate.ts",
        lineCount: 20,
      },
    ],
    findings: [
      {
        ...finding,
        evidence: [
          {
            file: "src/application/orchestrate.ts",
            lineStart: 1,
            lineEnd: 0,
          },
        ],
      },
    ],
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors[0]?.code, "invalid-line-range");
});

test("evidence validator rejects negative line values", () => {
  const result = validateEvidenceReferences({
    repositoryFiles: [
      {
        path: "src/application/orchestrate.ts",
        lineCount: 20,
      },
    ],
    findings: [
      {
        ...finding,
        evidence: [
          {
            file: "src/application/orchestrate.ts",
            lineStart: -2,
            lineEnd: -1,
          },
        ],
      },
    ],
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors[0]?.code, "invalid-line-range");
});

test("evidence validator rejects evidence paths that escape the inspected repository", () => {
  const result = validateEvidenceReferences({
    repositoryFiles: [
      {
        path: "src/application/orchestrate.ts",
        lineCount: 20,
      },
    ],
    findings: [
      {
        ...finding,
        evidence: [
          {
            file: "../outside.ts",
            lineStart: 1,
            lineEnd: 1,
          },
        ],
      },
    ],
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors[0]?.code, "path-outside-repository");
});

test("evidence validator requires evidence for high-confidence findings", () => {
  const result = validateEvidenceReferences({
    repositoryFiles: [],
    findings: [
      {
        ...finding,
        id: "finding-high-confidence",
        evidence: [],
        confidence: 0.9,
      },
    ],
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors[0]?.code, "missing-evidence");
  assert.equal(result.errors[0]?.artifactId, "finding-high-confidence");
});

test("evidence validator rejects QA results for unknown findings when findings are available", () => {
  const qaResult: QaResult = {
    id: "qa-001",
    qaAgent: "qa",
    findingId: "missing-finding",
    status: "failed",
    rationale: "The cited finding was not present.",
    checks: [{ name: "finding-reference", status: "failed" }],
    requiresFollowUp: true,
  };

  const result = validateEvidenceReferences({
    repositoryFiles: [
      {
        path: "src/application/orchestrate.ts",
        lineCount: 20,
      },
    ],
    findings: [finding],
    qaResults: [qaResult],
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors[0]?.code, "unknown-finding-reference");
  assert.equal(result.errors[0]?.artifactType, "qa-result");
  assert.equal(result.errors[0]?.artifactId, "qa-001");
});

test("evidence validator rejects knowledge card evidence that references unapproved findings", () => {
  const knowledgeCard: KnowledgeCard = {
    id: "knowledge-card-001",
    topic: "Application orchestration",
    summary: "Keep workflow behavior in application services.",
    tags: ["architecture"],
    audience: "coding-agent",
    evidence: [
      {
        file: "src/application/orchestrate.ts",
        lineStart: 4,
        lineEnd: 8,
        findingId: "finding-001",
      },
    ],
  };

  const result = validateEvidenceReferences({
    repositoryFiles: [
      {
        path: "src/application/orchestrate.ts",
        lineCount: 20,
      },
    ],
    findings: [finding],
    approvedFindingIds: ["finding-002"],
    knowledgeCards: [knowledgeCard],
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors[0]?.code, "unapproved-finding-reference");
  assert.equal(result.errors[0]?.artifactType, "knowledge-card");
  assert.equal(result.errors[0]?.artifactId, "knowledge-card-001");
});

test("evidence file loading reads only cited repository files", async () => {
  const reader = new RecordingRepositoryReader({
    "src/application/orchestrate.ts": "one\ntwo\nthree\nfour\n",
    "assets/large.bin": "not text",
  });
  const repositoryFiles = await repositoryFilesForEvidence(
    reader,
    [
      {
        path: "src/application/orchestrate.ts",
        kind: "file",
        sizeBytes: 16,
      },
      {
        path: "assets/large.bin",
        kind: "file",
        sizeBytes: 5_000_000,
      },
    ],
    finding.evidence,
  );

  assert.deepEqual(repositoryFiles, [
    {
      path: "src/application/orchestrate.ts",
      lineCount: 4,
    },
  ]);
  assert.deepEqual(reader.reads, ["src/application/orchestrate.ts"]);
});

class RecordingRepositoryReader implements RepositoryReader {
  readonly reads: string[] = [];

  constructor(private readonly files: Record<string, string>) {}

  async listEntries(): Promise<RepositoryEntry[]> {
    return Object.keys(this.files).map((path) => ({
      path,
      kind: "file" as const,
      sizeBytes: this.files[path]?.length,
    }));
  }

  async readTextFile(path: string): Promise<string> {
    this.reads.push(path);
    const content = this.files[path];

    if (content === undefined) {
      throw new Error(`Unexpected read: ${path}`);
    }

    return content;
  }
}
