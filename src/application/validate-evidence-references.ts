import type {
  Evidence,
  Finding,
  KnowledgeCard,
  QaResult,
} from "../domain/types.js";

export type EvidenceValidationErrorCode =
  | "missing-file"
  | "invalid-line-range"
  | "path-outside-repository"
  | "missing-evidence"
  | "unknown-finding-reference"
  | "unapproved-finding-reference";

export interface EvidenceRepositoryFile {
  path: string;
  lineCount: number;
}

export interface EvidenceValidationError {
  code: EvidenceValidationErrorCode;
  message: string;
  artifactType: "finding" | "qa-result" | "knowledge-card";
  artifactId: string;
  evidenceFile?: string;
  findingId?: string;
}

export interface ValidateEvidenceReferencesRequest {
  repositoryFiles: EvidenceRepositoryFile[];
  findings?: Finding[];
  qaResults?: QaResult[];
  knowledgeCards?: KnowledgeCard[];
  approvedFindingIds?: string[];
}

export interface EvidenceValidationResult {
  valid: boolean;
  errors: EvidenceValidationError[];
}

export function validateEvidenceReferences(
  request: ValidateEvidenceReferencesRequest,
): EvidenceValidationResult {
  const repositoryFiles = new Map(
    request.repositoryFiles.map((file) => [
      normalizeRepositoryPath(file.path),
      file,
    ]),
  );
  const findings = request.findings ?? [];
  const findingIds = new Set(findings.map((finding) => finding.id));
  const approvedFindingIds =
    request.approvedFindingIds === undefined
      ? undefined
      : new Set(request.approvedFindingIds);
  const errors: EvidenceValidationError[] = [];

  for (const finding of findings) {
    errors.push(...validateFindingEvidence(finding, repositoryFiles));
  }

  if (request.findings !== undefined) {
    errors.push(...validateQaReferences(request.qaResults ?? [], findingIds));
  }

  for (const knowledgeCard of request.knowledgeCards ?? []) {
    errors.push(
      ...validateKnowledgeCardEvidence(
        knowledgeCard,
        repositoryFiles,
        approvedFindingIds,
      ),
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function validateFindingEvidence(
  finding: Finding,
  repositoryFiles: ReadonlyMap<string, EvidenceRepositoryFile>,
): EvidenceValidationError[] {
  const errors: EvidenceValidationError[] = [];

  if (finding.confidence >= 0.8 && finding.evidence.length === 0) {
    errors.push({
      code: "missing-evidence",
      artifactType: "finding",
      artifactId: finding.id,
      message: `High-confidence finding requires evidence: ${finding.id}`,
    });
  }

  errors.push(
    ...finding.evidence.flatMap((evidence) =>
      validateEvidence("finding", finding.id, evidence, repositoryFiles),
    ),
  );

  return errors;
}

function validateQaReferences(
  qaResults: readonly QaResult[],
  findingIds: ReadonlySet<string>,
): EvidenceValidationError[] {
  return qaResults
    .filter((qaResult) => !findingIds.has(qaResult.findingId))
    .map((qaResult) => ({
      code: "unknown-finding-reference",
      artifactType: "qa-result",
      artifactId: qaResult.id,
      findingId: qaResult.findingId,
      message: `QA result references unknown finding: ${qaResult.findingId}`,
    }));
}

function validateKnowledgeCardEvidence(
  knowledgeCard: KnowledgeCard,
  repositoryFiles: ReadonlyMap<string, EvidenceRepositoryFile>,
  approvedFindingIds: ReadonlySet<string> | undefined,
): EvidenceValidationError[] {
  const errors = knowledgeCard.evidence.flatMap((evidence) =>
    validateEvidence(
      "knowledge-card",
      knowledgeCard.id,
      evidence,
      repositoryFiles,
    ),
  );

  if (approvedFindingIds === undefined) {
    return errors;
  }

  for (const evidence of knowledgeCard.evidence) {
    if (
      evidence.findingId !== undefined &&
      !approvedFindingIds.has(evidence.findingId)
    ) {
      const findingId = evidence.findingId;

      errors.push({
        code: "unapproved-finding-reference",
        artifactType: "knowledge-card",
        artifactId: knowledgeCard.id,
        evidenceFile: evidence.file,
        findingId,
        message: `Knowledge card evidence references an unapproved finding: ${findingId}`,
      });
    }
  }

  return errors;
}

function validateEvidence(
  artifactType: "finding" | "knowledge-card",
  artifactId: string,
  evidence: Evidence,
  repositoryFiles: ReadonlyMap<string, EvidenceRepositoryFile>,
): EvidenceValidationError[] {
  if (!isRepositoryRelativePath(evidence.file)) {
    return [
      {
        code: "path-outside-repository",
        artifactType,
        artifactId,
        evidenceFile: evidence.file,
        message: `Evidence path escapes the inspected repository: ${evidence.file}`,
      },
    ];
  }

  const normalizedPath = normalizeRepositoryPath(evidence.file);
  const file = repositoryFiles.get(normalizedPath);

  if (file === undefined) {
    return [
      {
        code: "missing-file",
        artifactType,
        artifactId,
        evidenceFile: evidence.file,
        message: `Evidence file does not exist in repository: ${evidence.file}`,
      },
    ];
  }

  if (evidence.lineStart > evidence.lineEnd || evidence.lineEnd > file.lineCount) {
    return [
      {
        code: "invalid-line-range",
        artifactType,
        artifactId,
        evidenceFile: evidence.file,
        message: `Evidence line range ${evidence.lineStart}-${evidence.lineEnd} is invalid for ${evidence.file}`,
      },
    ];
  }

  return [];
}

function normalizeRepositoryPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^(\.\/)+/, "");
}

function isRepositoryRelativePath(path: string): boolean {
  const normalizedPath = normalizeRepositoryPath(path);
  const segments = normalizedPath.split("/");

  return (
    normalizedPath.length > 0 &&
    !normalizedPath.startsWith("/") &&
    !/^[A-Za-z]:/.test(normalizedPath) &&
    !segments.includes("..")
  );
}
