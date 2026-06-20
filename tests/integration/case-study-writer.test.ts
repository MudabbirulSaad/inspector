import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  generateCaseStudyDocumentation,
  type Finding,
  type QaResult,
  type RunWorkspace,
} from "../../src/index.js";
import { NodeCaseStudyDocumentWriter } from "../../src/adapters/filesystem/index.js";

const approvedArchitectureFinding: Finding = {
  id: "finding-approved-architecture",
  agent: "architecture",
  severity: "medium",
  claim: "Application orchestration depends on ports.",
  evidence: [{ file: "src/application/index.ts", lineStart: 1, lineEnd: 12 }],
  recommendation: "Keep orchestration independent from filesystem adapters.",
  confidence: 0.9,
};

const rejectedPatternFinding: Finding = {
  id: "finding-rejected-pattern",
  agent: "pattern_miner",
  severity: "low",
  claim: "Rejected pattern claim must not appear in final documentation.",
  evidence: [{ file: "src/writers/index.ts", lineStart: 1, lineEnd: 1 }],
  recommendation: "Do not publish rejected findings.",
  confidence: 0.4,
};

const passedQaResult: QaResult = {
  id: "qa-finding-approved-architecture",
  qaAgent: "qa_verifier",
  findingId: approvedArchitectureFinding.id,
  status: "passed",
  rationale: "Finding is supported by schema-valid and evidence-valid output.",
  checks: [{ name: "evidence-support", status: "passed" }],
  requiresFollowUp: false,
  createdAt: "2026-06-20T00:00:00.000Z",
};

const failedQaResult: QaResult = {
  id: "qa-finding-rejected-pattern",
  qaAgent: "qa_verifier",
  findingId: rejectedPatternFinding.id,
  status: "failed",
  rationale: "The evidence did not support the rejected pattern claim.",
  checks: [{ name: "evidence-support", status: "failed" }],
  requiresFollowUp: true,
  followUpAgent: "pattern_miner",
  createdAt: "2026-06-20T00:00:00.000Z",
};

async function createWorkspace(): Promise<RunWorkspace> {
  const root = await mkdtemp(join(tmpdir(), "inspector-case-study-"));
  const final = join(root, "final");
  await mkdir(final, { recursive: true });

  return {
    name: "case-study-run",
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

test("case study writer generates final docs from approved findings only", async () => {
  const workspace = await createWorkspace();

  const result = await generateCaseStudyDocumentation({
    workspace,
    writer: new NodeCaseStudyDocumentWriter(),
    repository: { name: "inspector", root: "/repo" },
    objective: "Inspect the repository architecture.",
    approvedFindings: [approvedArchitectureFinding],
    rejectedFindings: [rejectedPatternFinding],
    qaResults: [passedQaResult, failedQaResult],
    generatedAt: new Date("2026-06-20T01:02:03.004Z"),
  });

  assert.deepEqual(
    result.documents.map((document) => document.path),
    [
      "00-executive-summary.md",
      "01-product-context.md",
      "02-architecture-map.md",
      "03-feature-flow-traces.md",
      "04-pattern-catalog.md",
      "05-testing-strategy.md",
      "06-tradeoffs-and-risks.md",
      "07-adaptation-blueprint.md",
      "08-implementation-plan.md",
      "09-verification-report.md",
    ],
  );

  const executiveSummary = await readFile(
    join(workspace.folders.final, "docs", "00-executive-summary.md"),
    "utf8",
  );
  assert.match(executiveSummary, /Application orchestration depends on ports/);
  assert.match(executiveSummary, /src\/application\/index\.ts:1-12/);
  assert.doesNotMatch(executiveSummary, /Rejected pattern claim/);

  const verificationReport = await readFile(
    join(workspace.folders.final, "docs", "09-verification-report.md"),
    "utf8",
  );
  assert.match(verificationReport, /finding-approved-architecture/);
  assert.match(verificationReport, /qa-finding-approved-architecture/);
  assert.match(verificationReport, /Approved findings used: 1/);
  assert.match(verificationReport, /Rejected findings excluded: 1/);
  assert.doesNotMatch(verificationReport, /finding-rejected-pattern/);
});

test("case study writer marks unsupported sections honestly", async () => {
  const workspace = await createWorkspace();

  await generateCaseStudyDocumentation({
    workspace,
    writer: new NodeCaseStudyDocumentWriter(),
    repository: { name: "inspector", root: "/repo" },
    objective: "Inspect the repository architecture.",
    approvedFindings: [approvedArchitectureFinding],
    rejectedFindings: [],
    qaResults: [passedQaResult],
    generatedAt: new Date("2026-06-20T01:02:03.004Z"),
  });

  const featureFlows = await readFile(
    join(workspace.folders.final, "docs", "03-feature-flow-traces.md"),
    "utf8",
  );
  const testingStrategy = await readFile(
    join(workspace.folders.final, "docs", "05-testing-strategy.md"),
    "utf8",
  );
  const productContext = await readFile(
    join(workspace.folders.final, "docs", "01-product-context.md"),
    "utf8",
  );

  assert.match(
    featureFlows,
    /There is not enough verified evidence to support this section\./,
  );
  assert.match(
    testingStrategy,
    /There is not enough verified evidence to support this section\./,
  );
  assert.match(
    productContext,
    /There is not enough verified evidence to support this section\./,
  );
});
