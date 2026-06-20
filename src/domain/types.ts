export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type QaStatus = "passed" | "failed" | "needs-review";

export type KnowledgeCardAudience = "coding-agent" | "engineer" | "maintainer";

export type MemoryEventType =
  | "decision"
  | "milestone"
  | "validation"
  | "finding"
  | "qa"
  | "note";

export type ValidationCommandStatus = "passed" | "failed" | "not-run";

export interface FindingEvidence {
  file: string;
  lineStart: number;
  lineEnd: number;
  excerpt?: string;
}

export interface Finding {
  id: string;
  agent: string;
  severity: Severity;
  claim: string;
  evidence: FindingEvidence[];
  recommendation: string;
  confidence: number;
  validation?: string[];
}

export interface QaCheck {
  name: string;
  status: QaStatus;
  notes?: string;
}

export interface QaResult {
  id: string;
  qaAgent: string;
  findingId: string;
  status: QaStatus;
  rationale: string;
  checks: QaCheck[];
  requiresFollowUp: boolean;
  followUpAgent?: string;
  createdAt?: string;
}

export interface KnowledgeCardEvidence {
  file: string;
  lineStart: number;
  lineEnd: number;
  findingId?: string;
}

export interface KnowledgeCard {
  id: string;
  topic: string;
  summary: string;
  evidence: KnowledgeCardEvidence[];
  tags: string[];
  audience: KnowledgeCardAudience;
  createdAt?: string;
}

export interface MemoryEvent {
  id: string;
  timestamp: string;
  actor: string;
  type: MemoryEventType;
  summary: string;
  relatedFiles?: string[];
  nextSteps?: string[];
}

export interface InspectionRepository {
  name: string;
  root: string;
  commit?: string;
}

export interface ValidationCommand {
  command: string;
  status: ValidationCommandStatus;
  notes?: string;
}

export interface InspectionReportValidation {
  schemaVersion: string;
  commands: ValidationCommand[];
}

export interface InspectionReport {
  id: string;
  repository: InspectionRepository;
  generatedAt: string;
  summary: string;
  findings: Finding[];
  qaResults: QaResult[];
  knowledgeCards: KnowledgeCard[];
  validation: InspectionReportValidation;
}
