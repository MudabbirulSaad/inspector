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
  tags?: string[];
  cardType?: "pattern" | "flow" | "decision" | "warning";
  audience?: KnowledgeCardAudience;
  whenToUse?: string;
  whenNotToUse?: string;
  risks?: string;
  adaptationNotes?: string;
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

export interface PatternMinerPattern {
  name: string;
  problemSolved: string;
  implementationShape: string;
  evidence: Evidence[];
  tradeoffs: string[];
  whenToUse: string;
  whenNotToUse: string;
  adaptationValue: string;
  tags: string[];
  confidence: number;
}

export interface PatternMinerOutput {
  patterns: PatternMinerPattern[];
  findings: Finding[];
}

export interface FlowTracerPathEvidence {
  path: string;
  evidence: Evidence[];
}

export interface FlowTracerFileRole extends FlowTracerPathEvidence {
  role: string;
}

export interface FlowTracerStepEvidence {
  step: string;
  evidence: Evidence[];
}

export interface FlowTracerDescriptionEvidence {
  description: string;
  evidence: Evidence[];
}

export interface FlowTracerFlow {
  name: string;
  action: string;
  entryPoint: FlowTracerPathEvidence;
  mainFiles: FlowTracerFileRole[];
  dataPath: FlowTracerStepEvidence[];
  sideEffects: FlowTracerDescriptionEvidence[];
  persistencePath: FlowTracerDescriptionEvidence[];
  errorPaths: FlowTracerDescriptionEvidence[];
  tests: FlowTracerDescriptionEvidence[];
  evidence: Evidence[];
}

export interface FlowTracerInsufficientEvidence {
  topic: string;
  reason: string;
  evidence: Evidence[];
}

export interface FlowTracerOutput {
  flows: FlowTracerFlow[];
  insufficientEvidence: FlowTracerInsufficientEvidence[];
  findings: Finding[];
}

export interface TestingStrategyEvidenceNote {
  name: string;
  summary: string;
  evidence: Evidence[];
}

export type TestingStrategyCommandStatus = "passed" | "failed" | "not-run";

export interface TestingStrategyQualityGate {
  command: string;
  status: TestingStrategyCommandStatus;
  summary: string;
  evidence: Evidence[];
}

export interface TestingStrategyCommandEvidence {
  command: string;
  status: TestingStrategyCommandStatus;
  exitCode?: number;
  ranAt?: string;
  evidence: Evidence[];
}

export interface TestingStrategyRecommendation {
  summary: string;
  priority: "low" | "medium" | "high";
  evidence: Evidence[];
}

export interface TestingStrategyOutput {
  testTypesFound: TestingStrategyEvidenceNote[];
  qualityGates: TestingStrategyQualityGate[];
  behaviorProtected: TestingStrategyEvidenceNote[];
  behaviorNotProtected: TestingStrategyEvidenceNote[];
  commandEvidence: TestingStrategyCommandEvidence[];
  testingRisks: TestingStrategyEvidenceNote[];
  recommendations: TestingStrategyRecommendation[];
  findings: Finding[];
}

export interface TradeoffAnalystDecision {
  decision: string;
  tradeoff: string;
  consequence: string;
  evidence: Evidence[];
  confidence: number;
}

export interface TradeoffAnalystRisk {
  risk: string;
  tradeoff: string;
  consequence: string;
  evidence: Evidence[];
  confidence: number;
}

export interface TradeoffAnalystWeakDecision {
  decision: string;
  tradeoff: string;
  risk: string;
  evidence: Evidence[];
  confidence: number;
}

export interface TradeoffAnalystAssumption {
  assumption: string;
  whyItMatters: string;
  evidence: Evidence[];
  confidence: number;
}

export interface TradeoffAnalystAdaptationWarning {
  warning: string;
  repoSpecificContext: string;
  adaptationAdvice: string;
  evidence: Evidence[];
  confidence: number;
}

export interface TradeoffAnalystOutput {
  strongDecisions: TradeoffAnalystDecision[];
  weakDecisions: TradeoffAnalystWeakDecision[];
  overengineeringRisks: TradeoffAnalystRisk[];
  underengineeringRisks: TradeoffAnalystRisk[];
  hiddenAssumptions: TradeoffAnalystAssumption[];
  agentSafetyRisks: TradeoffAnalystRisk[];
  adaptationWarnings: TradeoffAnalystAdaptationWarning[];
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
  sourceRepo: string;
  confidence: number;
  evidence: Evidence[];
  tags: string[];
  audience: KnowledgeCardAudience;
  whenToUse?: string;
  whenNotToUse?: string;
  risks?: string;
  adaptationNotes?: string;
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
  targetContext?: string;
  agents?: string[];
  parallelism?: number;
  maxRetries?: number;
  runQualityCommands?: boolean;
  runner?: {
    provider: string;
    command?: string;
    args?: string[];
    timeoutMs?: number;
    env?: Record<string, string>;
  };
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
