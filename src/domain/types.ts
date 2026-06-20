export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type QaStatus = "passed" | "failed" | "needs-review";

export type QaIssueStatus = Exclude<QaStatus, "passed">;

export type KnowledgeCardAudience = "coding-agent" | "engineer" | "maintainer";

export type MemoryEventType =
  | "decision"
  | "milestone"
  | "validation"
  | "finding"
  | "qa"
  | "note";

export type ValidationCommandStatus = "passed" | "failed" | "not-run";

export type AgentId = string;

export type AgentRole =
  | "architecture"
  | "code-quality"
  | "security"
  | "testing"
  | "documentation"
  | "qa"
  | "knowledge"
  | "reporting";

export type AgentStatus =
  | "planned"
  | "ready"
  | "running"
  | "submitted"
  | "validating"
  | "accepted"
  | "rejected"
  | "rerouted";

export type InspectionRunStatus = "planned" | "running" | "completed" | "failed";

export interface Evidence {
  file: string;
  lineStart: number;
  lineEnd: number;
  excerpt?: string;
  findingId?: string;
}

export type FindingEvidence = Evidence;

export interface Finding {
  id: string;
  agent: AgentId;
  severity: Severity;
  claim: string;
  evidence: Evidence[];
  recommendation: string;
  confidence: number;
  validation?: string[];
}

export interface ScoutEvidenceSummary {
  value: string;
  evidence: Evidence[];
}

export interface ScoutStackSignal {
  name: string;
  version?: string;
  evidence: Evidence[];
}

export interface ScoutImportantFile {
  path: string;
  reason: string;
  evidence: Evidence[];
}

export interface ScoutEntryPoint {
  path: string;
  kind: string;
  evidence: Evidence[];
}

export interface ScoutArchitectureImpression {
  summary: string;
  evidence: Evidence[];
}

export interface ScoutOutput {
  projectType: ScoutEvidenceSummary;
  detectedStack: ScoutStackSignal[];
  importantFiles: ScoutImportantFile[];
  entryPoints: ScoutEntryPoint[];
  architectureImpression: ScoutArchitectureImpression;
  openQuestions: string[];
  findings: Finding[];
}

export interface ArchitectureObservation {
  name: string;
  observedFacts: string[];
  interpretation?: string;
  evidence: Evidence[];
}

export interface ArchitectureDependencyDirection extends ArchitectureObservation {
  source: string;
  target: string;
  direction: string;
}

export interface ArchitectureOutput {
  layerMap: ArchitectureObservation[];
  dependencyDirection: ArchitectureDependencyDirection[];
  moduleBoundaries: ArchitectureObservation[];
  businessLogicLocations: ArchitectureObservation[];
  frameworkGlueLocations: ArchitectureObservation[];
  architectureRisks: ArchitectureObservation[];
  findings: Finding[];
}

export interface QaCheck {
  name: string;
  status: QaStatus;
  notes?: string;
}

export interface QaResult {
  id: string;
  qaAgent: AgentId;
  findingId: string;
  status: QaStatus;
  rationale: string;
  checks: QaCheck[];
  requiresFollowUp: boolean;
  followUpAgent?: AgentId;
  createdAt?: string;
}

export interface QaIssue {
  check: string;
  status: QaIssueStatus;
  message: string;
  evidence?: Evidence[];
}

export interface RevisionRequest {
  id: string;
  findingId: string;
  qaResultId: string;
  requestedBy: AgentId;
  targetAgent: AgentId;
  issues: QaIssue[];
  requiredCorrections: string[];
  createdAt: string;
}

export type KnowledgeCardEvidence = Evidence;

export interface KnowledgeCard {
  id: string;
  topic: string;
  summary: string;
  evidence: Evidence[];
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

export interface RepositoryTarget {
  name: string;
  root: string;
  commit?: string;
}

export type InspectionRepository = RepositoryTarget;

export interface AgentAttempt {
  id: string;
  agentId: AgentId;
  role: AgentRole;
  status: AgentStatus;
  startedAt: string;
  completedAt?: string;
  findings?: Finding[];
}

export interface RunConfig {
  target: RepositoryTarget;
  outputDirectory: string;
  agentRoles: AgentRole[];
  validationCommands: string[];
  verbose: boolean;
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
  repository: RepositoryTarget;
  generatedAt: string;
  summary: string;
  findings: Finding[];
  qaResults: QaResult[];
  knowledgeCards: KnowledgeCard[];
  validation: InspectionReportValidation;
}

export interface InspectionRun {
  id: string;
  target: RepositoryTarget;
  config: RunConfig;
  status: InspectionRunStatus;
  attempts: AgentAttempt[];
  findings: Finding[];
  qaResults: QaResult[];
  revisionRequests: RevisionRequest[];
  memoryEvents: MemoryEvent[];
  knowledgeCards: KnowledgeCard[];
  report?: InspectionReport;
  createdAt: string;
  updatedAt: string;
}
