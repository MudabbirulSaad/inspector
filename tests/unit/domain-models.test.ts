import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentAttempt,
  AgentId,
  AgentRole,
  AgentStatus,
  Evidence,
  Finding,
  InspectionReport,
  InspectionRun,
  KnowledgeCard,
  MemoryEvent,
  QaIssue,
  QaResult,
  RepositoryTarget,
  RevisionRequest,
  RunConfig,
} from "../../src/domain/types.js";

test("domain models can construct a schema-aligned inspection run", () => {
  const target: RepositoryTarget = {
    name: "example-service",
    root: "./example-service",
    commit: "abc1234",
  };

  const agentId: AgentId = "architecture-inspector";
  const agentRole: AgentRole = "architecture";
  const status: AgentStatus = "accepted";

  const evidence: Evidence = {
    file: "src/adapters/cli/main.ts",
    lineStart: 12,
    lineEnd: 20,
    excerpt: "The entrypoint parses input and starts inspection orchestration.",
  };

  const finding: Finding = {
    id: "finding-001",
    agent: agentId,
    severity: "medium",
    claim:
      "The CLI entrypoint should delegate orchestration to an application service.",
    evidence: [evidence],
    recommendation:
      "Keep CLI parsing in the adapter layer and move orchestration decisions behind an application port.",
    confidence: 0.82,
    validation: ["schema-valid", "evidence-present"],
  };

  const qaIssue: QaIssue = {
    check: "evidence-present",
    status: "failed",
    message: "Finding evidence must include a traceable file and line range.",
  };

  const qaResult: QaResult = {
    id: "qa-001",
    qaAgent: "qa-inspector",
    findingId: finding.id,
    status: "failed",
    rationale: "The finding needs a more precise line range.",
    checks: [
      {
        name: qaIssue.check,
        status: qaIssue.status,
        notes: qaIssue.message,
      },
    ],
    requiresFollowUp: true,
    followUpAgent: agentId,
    createdAt: "2026-06-20T02:00:00.000Z",
  };

  const revisionRequest: RevisionRequest = {
    id: "revision-001",
    findingId: finding.id,
    qaResultId: qaResult.id,
    requestedBy: qaResult.qaAgent,
    targetAgent: agentId,
    issues: [qaIssue],
    requiredCorrections: ["Narrow the evidence range to the relevant lines."],
    createdAt: "2026-06-20T02:05:00.000Z",
  };

  const attempt: AgentAttempt = {
    id: "attempt-001",
    agentId,
    role: agentRole,
    status,
    startedAt: "2026-06-20T01:55:00.000Z",
    completedAt: "2026-06-20T02:00:00.000Z",
    findings: [finding],
  };

  const memoryEvent: MemoryEvent = {
    id: "memory-event-001",
    timestamp: "2026-06-20T02:00:00.000Z",
    actor: "workflow-agent",
    type: "decision",
    summary: "Adopted JSON Schema contracts for evidence-backed outputs.",
  };

  const knowledgeCard: KnowledgeCard = {
    id: "knowledge-card-001",
    topic: "Keep CLI adapters thin",
    summary:
      "CLI entrypoints should translate user input and delegate workflow decisions to application services.",
    evidence: [
      {
        file: "docs/architecture.md",
        lineStart: 20,
        lineEnd: 27,
        findingId: finding.id,
      },
    ],
    tags: ["architecture", "cli", "hexagonal"],
    audience: "coding-agent",
    createdAt: "2026-06-20T02:00:00.000Z",
  };

  const runConfig: RunConfig = {
    target,
    outputDirectory: "./inspection-output",
    agentRoles: [agentRole, "qa"],
    validationCommands: ["npm test"],
    verbose: true,
  };

  const report: InspectionReport = {
    id: "inspection-report-001",
    repository: target,
    generatedAt: "2026-06-20T02:10:00.000Z",
    summary: "The inspection identified one architecture improvement.",
    findings: [finding],
    qaResults: [qaResult],
    knowledgeCards: [knowledgeCard],
    validation: {
      schemaVersion: "2020-12",
      commands: [
        {
          command: "npm test",
          status: "passed",
        },
      ],
    },
  };

  const run: InspectionRun = {
    id: "inspection-run-001",
    target,
    config: runConfig,
    status: "completed",
    attempts: [attempt],
    findings: [finding],
    qaResults: [qaResult],
    revisionRequests: [revisionRequest],
    memoryEvents: [memoryEvent],
    knowledgeCards: [knowledgeCard],
    report,
    createdAt: "2026-06-20T01:50:00.000Z",
    updatedAt: "2026-06-20T02:10:00.000Z",
  };

  assert.equal(run.target.name, target.name);
  assert.equal(run.attempts[0]?.status, status);
  assert.equal(run.revisionRequests[0]?.issues[0]?.check, qaIssue.check);
});
