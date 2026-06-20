import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { NodeQaArtifactWriter } from "../../src/adapters/filesystem/index.js";
import {
  verifyFindingsWithQa,
  type Finding,
  type RunWorkspace,
} from "../../src/index.js";

const supportedFinding: Finding = {
  id: "finding-supported",
  agent: "architecture",
  severity: "medium",
  claim: "Application orchestration depends on ports.",
  evidence: [{ file: "src/application/index.ts", lineStart: 1, lineEnd: 8 }],
  recommendation: "Keep orchestration in the application layer.",
  confidence: 0.86,
};

const patternFinding: Finding = {
  id: "finding-pattern",
  agent: "pattern_miner",
  severity: "low",
  claim: "Prompt builders use versioned templates.",
  evidence: [{ file: "src/application/build-agent-prompt.ts", lineStart: 1, lineEnd: 12 }],
  recommendation: "Keep prompt text outside orchestration code.",
  confidence: 0.74,
};

async function createWorkspace(): Promise<RunWorkspace> {
  const root = await mkdtemp(join(tmpdir(), "inspector-qa-"));
  const qa = join(root, "qa");
  await mkdir(qa, { recursive: true });

  return {
    name: "run-qa",
    root,
    configFile: join(root, "config.json"),
    folders: {
      input: join(root, "input"),
      repoIndex: join(root, "repo_index"),
      memory: join(root, "memory"),
      agents: join(root, "agents"),
      validation: join(root, "validation"),
      qa,
      final: join(root, "final"),
    },
  };
}

test("QA verifier rejects unsupported findings and creates QA issues", async () => {
  const result = await verifyFindingsWithQa({
    candidateFindings: [supportedFinding],
    schemaReports: [
      {
        agentId: "architecture",
        valid: true,
        errors: [],
      },
    ],
    evidenceReports: [
      {
        agentId: "architecture",
        valid: false,
        errors: [
          {
            code: "missing-file",
            artifactType: "finding",
            artifactId: supportedFinding.id,
            evidenceFile: "src/application/index.ts",
            message: "Evidence file does not exist: src/application/index.ts",
          },
        ],
      },
    ],
    agentReports: [],
    memory: {},
    now: new Date("2026-06-20T00:00:00.000Z"),
  });

  assert.deepEqual(result.approvedFindings, []);
  assert.deepEqual(result.rejectedFindings, [supportedFinding]);
  assert.equal(result.qaIssues.length, 1);
  assert.equal(result.qaIssues[0]?.check, "evidence-support");
  assert.equal(result.qaIssues[0]?.status, "failed");
  assert.match(result.qaIssues[0]?.message ?? "", /Evidence file does not exist/);
  assert.equal(result.qaResults[0]?.status, "failed");
  assert.equal(result.qaResults[0]?.findingId, supportedFinding.id);
});

test("QA verifier routes failed findings to the owner agent with a revision request", async () => {
  const result = await verifyFindingsWithQa({
    candidateFindings: [supportedFinding],
    schemaReports: [{ agentId: "architecture", valid: true, errors: [] }],
    evidenceReports: [
      {
        agentId: "architecture",
        valid: false,
        errors: [
          {
            code: "invalid-line-range",
            artifactType: "finding",
            artifactId: supportedFinding.id,
            evidenceFile: "src/application/index.ts",
            message: "Evidence line range is outside the cited file.",
          },
        ],
      },
    ],
    agentReports: [],
    memory: {},
    now: new Date("2026-06-20T00:00:00.000Z"),
  });

  assert.equal(result.qaResults[0]?.followUpAgent, "architecture");
  assert.equal(result.revisionRequests.length, 1);
  assert.equal(result.revisionRequests[0]?.findingId, supportedFinding.id);
  assert.equal(result.revisionRequests[0]?.qaResultId, `qa-${supportedFinding.id}`);
  assert.equal(result.revisionRequests[0]?.requestedBy, "qa_verifier");
  assert.equal(result.revisionRequests[0]?.targetAgent, "architecture");
  assert.deepEqual(result.revisionRequests[0]?.requiredCorrections, [
    "Fix evidence-support: Evidence line range is outside the cited file.",
  ]);
});

test("QA verifier separates approved and rejected findings with deterministic readiness scoring", async () => {
  const result = await verifyFindingsWithQa({
    candidateFindings: [supportedFinding, patternFinding],
    schemaReports: [
      { agentId: "architecture", valid: true, errors: [] },
      { agentId: "pattern_miner", valid: true, errors: [] },
    ],
    evidenceReports: [
      {
        agentId: "architecture",
        valid: false,
        errors: [
          {
            code: "missing-file",
            artifactType: "finding",
            artifactId: supportedFinding.id,
            evidenceFile: "src/application/index.ts",
            message: "Evidence file does not exist.",
          },
        ],
      },
      { agentId: "pattern_miner", valid: true, errors: [] },
    ],
    agentReports: [],
    memory: {},
    now: new Date("2026-06-20T00:00:00.000Z"),
  });

  assert.deepEqual(result.approvedFindings, [patternFinding]);
  assert.deepEqual(result.rejectedFindings, [supportedFinding]);
  assert.equal(result.qaResults.find((item) => item.findingId === patternFinding.id)?.status, "passed");
  assert.equal(result.qaResults.find((item) => item.findingId === supportedFinding.id)?.status, "failed");
  assert.equal(result.readinessScore, 50);
});

test("QA verifier writes QA result, issue, revision, and readiness artifacts", async () => {
  const workspace = await createWorkspace();
  const result = await verifyFindingsWithQa({
    candidateFindings: [supportedFinding],
    schemaReports: [{ agentId: "architecture", valid: true, errors: [] }],
    evidenceReports: [
      {
        agentId: "architecture",
        valid: false,
        errors: [
          {
            code: "missing-file",
            artifactType: "finding",
            artifactId: supportedFinding.id,
            evidenceFile: "src/application/index.ts",
            message: "Evidence file does not exist.",
          },
        ],
      },
    ],
    agentReports: [],
    memory: {},
    now: new Date("2026-06-20T00:00:00.000Z"),
    artifacts: new NodeQaArtifactWriter(),
    workspace,
  });

  assert.deepEqual(
    JSON.parse(await readFile(join(workspace.folders.qa, "results.json"), "utf8")),
    result.qaResults,
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(workspace.folders.qa, "issues.json"), "utf8")),
    result.qaIssues,
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(join(workspace.folders.qa, "revision_requests.json"), "utf8"),
    ),
    result.revisionRequests,
  );
  assert.deepEqual(
    JSON.parse(await readFile(join(workspace.folders.qa, "readiness.json"), "utf8")),
    { readinessScore: 0 },
  );
});

test("QA verifier rejects direct contradictions between candidate findings", async () => {
  const first: Finding = {
    ...supportedFinding,
    id: "finding-uses-ports",
    claim: "Application orchestration uses ports.",
  };
  const second: Finding = {
    ...patternFinding,
    id: "finding-does-not-use-ports",
    claim: "Application orchestration does not use ports.",
  };

  const result = await verifyFindingsWithQa({
    candidateFindings: [first, second],
    schemaReports: [
      { agentId: "architecture", valid: true, errors: [] },
      { agentId: "pattern_miner", valid: true, errors: [] },
    ],
    evidenceReports: [
      { agentId: "architecture", valid: true, errors: [] },
      { agentId: "pattern_miner", valid: true, errors: [] },
    ],
    agentReports: [],
    memory: {},
    now: new Date("2026-06-20T00:00:00.000Z"),
  });

  assert.deepEqual(result.approvedFindings, []);
  assert.deepEqual(result.rejectedFindings.map((finding) => finding.id), [
    "finding-uses-ports",
    "finding-does-not-use-ports",
  ]);
  assert.equal(
    result.qaIssues.filter((issue) => issue.check === "contradiction").length,
    2,
  );
  assert.match(result.qaIssues[0]?.message ?? "", /contradicts/);
});
