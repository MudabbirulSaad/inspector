import type {
  AgentId,
  Finding,
  QaIssue,
  QaResult,
  RevisionRequest,
} from "../domain/types.js";
import type {
  QaArtifactWriter,
  RunWorkspace,
} from "../ports/index.js";
import type { EvidenceValidationError } from "./validate-evidence-references.js";

export interface QaSchemaReport {
  agentId: AgentId;
  valid: boolean;
  errors: { message: string; path?: string; keyword?: string }[];
}

export interface QaEvidenceReport {
  agentId: AgentId;
  valid: boolean;
  errors: EvidenceValidationError[];
}

export interface QaAgentReport {
  agentId: AgentId;
  status?: string;
  summary?: string;
}

export interface VerifyFindingsWithQaInput {
  candidateFindings: Finding[];
  schemaReports: QaSchemaReport[];
  evidenceReports: QaEvidenceReport[];
  agentReports: QaAgentReport[];
  memory: unknown;
  now: Date;
  workspace?: RunWorkspace;
  artifacts?: QaArtifactWriter;
}

export interface VerifyFindingsWithQaResult {
  approvedFindings: Finding[];
  rejectedFindings: Finding[];
  qaResults: QaResult[];
  qaIssues: QaIssue[];
  revisionRequests: RevisionRequest[];
  readinessScore: number;
}

export async function verifyFindingsWithQa(
  input: VerifyFindingsWithQaInput,
): Promise<VerifyFindingsWithQaResult> {
  const approvedFindings: Finding[] = [];
  const rejectedFindings: Finding[] = [];
  const qaResults: QaResult[] = [];
  const qaIssues: QaIssue[] = [];
  const revisionRequests: RevisionRequest[] = [];
  const createdAt = input.now.toISOString();
  const contradictionIssues = findContradictionIssues(input.candidateFindings);

  for (const finding of input.candidateFindings) {
    const issues = [
      ...issuesForFinding(finding, input),
      ...(contradictionIssues.get(finding.id) ?? []),
    ];

    if (issues.length === 0) {
      approvedFindings.push(finding);
      qaResults.push({
        id: `qa-${finding.id}`,
        qaAgent: "qa_verifier",
        findingId: finding.id,
        status: "passed",
        rationale: `Finding is supported by schema-valid and evidence-valid agent output: ${finding.claim}`,
        checks: [
          {
            name: "evidence-support",
            status: "passed",
            notes: "No schema or evidence report failures were found for this finding.",
          },
        ],
        requiresFollowUp: false,
        createdAt,
      });
      continue;
    }

    rejectedFindings.push(finding);
    qaIssues.push(...issues);
    const qaResult: QaResult = {
      id: `qa-${finding.id}`,
      qaAgent: "qa_verifier",
      findingId: finding.id,
      status: "failed",
      rationale: issues.map((issue) => issue.message).join(" "),
      checks: issues.map((issue) => ({
        name: issue.check,
        status: issue.status,
        notes: issue.message,
      })),
      requiresFollowUp: true,
      followUpAgent: finding.agent,
      createdAt,
    };
    qaResults.push(qaResult);
    revisionRequests.push({
      id: `revision-${finding.id}`,
      findingId: finding.id,
      qaResultId: qaResult.id,
      requestedBy: "qa_verifier",
      targetAgent: finding.agent,
      issues,
      requiredCorrections: issues.map(
        (issue) => `Fix ${issue.check}: ${issue.message}`,
      ),
      createdAt,
    });
  }

  const result = {
    approvedFindings,
    rejectedFindings,
    qaResults,
    qaIssues,
    revisionRequests,
    readinessScore: readinessScore(approvedFindings.length, input.candidateFindings.length),
  };

  if (input.workspace !== undefined && input.artifacts !== undefined) {
    await writeQaArtifacts(input.workspace, input.artifacts, result);
  }

  return result;
}

function findContradictionIssues(findings: Finding[]): Map<string, QaIssue[]> {
  const issues = new Map<string, QaIssue[]>();

  for (let leftIndex = 0; leftIndex < findings.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < findings.length;
      rightIndex += 1
    ) {
      const left = findings[leftIndex];
      const right = findings[rightIndex];

      if (
        left === undefined ||
        right === undefined ||
        !claimsDirectlyContradict(left.claim, right.claim)
      ) {
        continue;
      }

      addIssue(issues, left.id, {
        check: "contradiction",
        status: "failed",
        message: `Finding ${left.id} contradicts finding ${right.id}: ${right.claim}`,
        evidence: left.evidence,
      });
      addIssue(issues, right.id, {
        check: "contradiction",
        status: "failed",
        message: `Finding ${right.id} contradicts finding ${left.id}: ${left.claim}`,
        evidence: right.evidence,
      });
    }
  }

  return issues;
}

function claimsDirectlyContradict(left: string, right: string): boolean {
  const normalizedLeft = normalizeClaimForContradiction(left);
  const normalizedRight = normalizeClaimForContradiction(right);

  return (
    normalizedLeft.subject === normalizedRight.subject &&
    normalizedLeft.negated !== normalizedRight.negated
  );
}

function normalizeClaimForContradiction(claim: string): {
  subject: string;
  negated: boolean;
} {
  const normalized = claim.toLowerCase().replaceAll(/[^a-z0-9\s]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  const negated = normalized.includes(" does not ");

  return {
    subject: normalized
      .replace(" does not ", " ")
      .replaceAll(/\buses\b/g, "use")
      .trim(),
    negated,
  };
}

function addIssue(
  issues: Map<string, QaIssue[]>,
  findingId: string,
  issue: QaIssue,
): void {
  issues.set(findingId, [...(issues.get(findingId) ?? []), issue]);
}

function issuesForFinding(
  finding: Finding,
  input: VerifyFindingsWithQaInput,
): QaIssue[] {
  const issues: QaIssue[] = [];
  const schemaReport = input.schemaReports.find(
    (report) => report.agentId === finding.agent,
  );

  if (schemaReport !== undefined && !schemaReport.valid) {
    for (const error of schemaReport.errors) {
      issues.push({
        check: "schema-validity",
        status: "failed",
        message: error.message,
        evidence: finding.evidence,
      });
    }
  }

  for (const report of input.evidenceReports.filter(
    (candidate) => candidate.agentId === finding.agent,
  )) {
    for (const error of report.errors.filter(
      (candidate) => candidate.artifactId === finding.id,
    )) {
      issues.push({
        check: "evidence-support",
        status: "failed",
        message: error.message,
        evidence: finding.evidence,
      });
    }
  }

  return issues;
}

function readinessScore(approvedCount: number, totalCount: number): number {
  if (totalCount === 0) {
    return 0;
  }

  return Math.round((approvedCount / totalCount) * 100);
}

async function writeQaArtifacts(
  workspace: RunWorkspace,
  artifacts: QaArtifactWriter,
  result: VerifyFindingsWithQaResult,
): Promise<void> {
  await artifacts.writeQaResults({
    workspace,
    content: `${JSON.stringify(result.qaResults, null, 2)}\n`,
  });
  await artifacts.writeQaIssues({
    workspace,
    content: `${JSON.stringify(result.qaIssues, null, 2)}\n`,
  });
  await artifacts.writeRevisionRequests({
    workspace,
    content: `${JSON.stringify(result.revisionRequests, null, 2)}\n`,
  });
  await artifacts.writeReadiness({
    workspace,
    content: `${JSON.stringify({ readinessScore: result.readinessScore }, null, 2)}\n`,
  });
}
