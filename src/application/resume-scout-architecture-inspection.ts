import type { AgentContractId } from "../agents/index.js";
import type {
  ArchitectureOutput,
  Finding,
  FlowTracerOutput,
  PatternMinerOutput,
  ScoutOutput,
  TestingStrategyOutput,
  TradeoffAnalystOutput,
} from "../domain/types.js";
import type { RunWorkspace } from "../ports/index.js";
import {
  appendRejectedSwarmFinding,
  appendSwarmFinding,
  appendSwarmQaIssue,
  appendVerifiedSwarmFinding,
} from "./append-swarm-memory.js";
import { generateCaseStudyDocumentation } from "./generate-case-study-documentation.js";
import { generateRagKnowledgeCards } from "./generate-rag-knowledge-cards.js";
import { routeQaRevisionRequests } from "./qa-revision-routing.js";
import {
  runAgentWorkflowStep,
  writeEvidenceLifecycleStatus,
  type RuntimeSpecialistAgentId,
} from "./run-agent-workflow-step.js";
import type { QualityCommandReport } from "./run-quality-commands.js";
import {
  type RunScoutArchitectureInspectionInput,
  type RunScoutArchitectureInspectionResult,
  validateEvidenceForAgent,
  validateRuntimeConfig,
  InspectionRunFailedError,
} from "./run-scout-architecture-inspection.js";
import {
  architectureEvidenceFindings,
  flowTracerEvidenceFindings,
  patternMinerEvidenceFindings,
  renderInitialMemorySnapshot,
  scoutEvidenceFindings,
  testingStrategyEvidenceFindings,
  tradeoffAnalystEvidenceFindings,
} from "./specialist-output-mappers.js";
import {
  type QaEvidenceReport,
  type QaSchemaReport,
  verifyFindingsWithQa,
} from "./verify-findings-with-qa.js";

export interface ResumeSpecialistState {
  agentId: RuntimeSpecialistAgentId;
  status: string;
  attempt: number;
  output?: unknown;
}

export interface ResumeScoutArchitectureInspectionInput
  extends RunScoutArchitectureInspectionInput {
  workspace: RunWorkspace;
  commandReport: QualityCommandReport;
  stages: ResumeSpecialistState[];
}

export async function resumeScoutArchitectureInspection(
  input: ResumeScoutArchitectureInspectionInput,
): Promise<RunScoutArchitectureInspectionResult> {
  validateRuntimeConfig(input.config);

  const entries = await input.repositoryReader.listEntries();
  const repoIndexSummary =
    await input.repositoryIndexContext.readRepositoryIndexPromptContext(
      input.workspace,
    );
  const runMemory = input.memory(input.workspace);
  const memorySnapshot = renderInitialMemorySnapshot(input.objective);
  const candidateFindings: Finding[] = [];
  const schemaReports: QaSchemaReport[] = [];
  const evidenceReports: QaEvidenceReport[] = [];
  const agentOutputs: Partial<Record<AgentContractId, unknown>> = {};
  const stageState = new Map(
    input.stages.map((stage) => [stage.agentId, stage] as const),
  );

  const scoutOutput = await loadOrRunAgent<ScoutOutput>({
    input,
    agentId: "scout",
    progressName: "Scout",
    repoIndexSummary,
    memorySnapshot,
    previousOutputs: [],
    stageState,
    schemaReports,
    evidenceReports,
    candidateFindings,
    agentOutputs,
    evidenceFindings: scoutEvidenceFindings,
  });

  const architectureOutput = await loadOrRunAgent<ArchitectureOutput>({
    input,
    agentId: "architecture",
    progressName: "Architecture",
    repoIndexSummary,
    memorySnapshot,
    previousOutputs: { scout: scoutOutput },
    stageState,
    schemaReports,
    evidenceReports,
    candidateFindings,
    agentOutputs,
    evidenceFindings: architectureEvidenceFindings,
  });

  const patternMinerOutput = await loadOrRunAgent<PatternMinerOutput>({
    input,
    agentId: "pattern_miner",
    progressName: "Pattern Miner",
    repoIndexSummary,
    memorySnapshot,
    previousOutputs: {
      scout: scoutOutput,
      architecture: architectureOutput,
    },
    stageState,
    schemaReports,
    evidenceReports,
    candidateFindings,
    agentOutputs,
    evidenceFindings: patternMinerEvidenceFindings,
  });

  const flowTracerOutput = await loadOrRunAgent<FlowTracerOutput>({
    input,
    agentId: "flow_tracer",
    progressName: "Flow Tracer",
    repoIndexSummary,
    memorySnapshot,
    previousOutputs: {
      scout: scoutOutput,
      architecture: architectureOutput,
      pattern_miner: patternMinerOutput,
    },
    stageState,
    schemaReports,
    evidenceReports,
    candidateFindings,
    agentOutputs,
    evidenceFindings: flowTracerEvidenceFindings,
  });

  const testingStrategyOutput = await loadOrRunAgent<TestingStrategyOutput>({
    input,
    agentId: "testing_strategy",
    progressName: "Testing Strategy",
    repoIndexSummary,
    memorySnapshot,
    previousOutputs: {
      scout: scoutOutput,
      architecture: architectureOutput,
      pattern_miner: patternMinerOutput,
      flow_tracer: flowTracerOutput,
      qualityCommandReport: input.commandReport,
    },
    qualityCommandReport: input.commandReport,
    stageState,
    schemaReports,
    evidenceReports,
    candidateFindings,
    agentOutputs,
    evidenceFindings: testingStrategyEvidenceFindings,
  });

  await loadOrRunAgent<TradeoffAnalystOutput>({
    input,
    agentId: "tradeoff_analyst",
    progressName: "Tradeoff Analyst",
    repoIndexSummary,
    memorySnapshot,
    previousOutputs: {
      scout: scoutOutput,
      architecture: architectureOutput,
      pattern_miner: patternMinerOutput,
      flow_tracer: flowTracerOutput,
      testing_strategy: testingStrategyOutput,
    },
    stageState,
    schemaReports,
    evidenceReports,
    candidateFindings,
    agentOutputs,
    evidenceFindings: tradeoffAnalystEvidenceFindings,
  });

  input.progress?.("Running QA verification");
  let qa = await verifyFindingsWithQa({
    candidateFindings,
    schemaReports,
    evidenceReports,
    agentReports: [],
    memory: memorySnapshot,
    now: input.clock.now(),
    workspace: input.workspace,
    artifacts: input.qaArtifacts,
  });

  for (const issue of qa.qaIssues) {
    await appendSwarmQaIssue({
      issue,
      memory: runMemory,
      validator: input.validators["qa-issue"],
    });
  }

  if (qa.revisionRequests.length > 0) {
    await routeQaRevisionRequests({
      input,
      workspace: input.workspace,
      runMemory,
      repoIndexSummary,
      memorySnapshot,
      entries,
      candidateFindings,
      schemaReports,
      evidenceReports,
      agentOutputs,
      revisionRequests: qa.revisionRequests,
    });

    qa = await verifyFindingsWithQa({
      candidateFindings,
      schemaReports,
      evidenceReports,
      agentReports: [],
      memory: memorySnapshot,
      now: input.clock.now(),
      workspace: input.workspace,
      artifacts: input.qaArtifacts,
    });
  }

  for (const finding of qa.approvedFindings) {
    await appendVerifiedSwarmFinding({
      finding,
      memory: runMemory,
      validator: input.validators.finding,
    });
  }
  for (const finding of qa.rejectedFindings) {
    await appendRejectedSwarmFinding({
      finding,
      memory: runMemory,
      validator: input.validators.finding,
    });
  }

  await generateCaseStudyDocumentation({
    workspace: input.workspace,
    writer: input.finalDocs,
    repository: input.config.target,
    objective: input.objective,
    approvedFindings: qa.approvedFindings,
    rejectedFindings: qa.rejectedFindings,
    qaResults: qa.qaResults,
    generatedAt: input.clock.now(),
  });

  await generateRagKnowledgeCards({
    workspace: input.workspace,
    writer: input.ragCards,
    repository: input.config.target,
    approvedFindings: qa.approvedFindings,
    rejectedFindings: qa.rejectedFindings,
    validator: input.validators["knowledge-card"],
    generatedAt: input.clock.now(),
  });

  return { workspace: input.workspace };
}

async function loadOrRunAgent<T extends { findings: Finding[] }>(request: {
  input: ResumeScoutArchitectureInspectionInput;
  agentId: RuntimeSpecialistAgentId;
  progressName: string;
  repoIndexSummary: unknown;
  memorySnapshot: string;
  previousOutputs: unknown;
  qualityCommandReport?: QualityCommandReport;
  stageState: Map<RuntimeSpecialistAgentId, ResumeSpecialistState>;
  schemaReports: QaSchemaReport[];
  evidenceReports: QaEvidenceReport[];
  candidateFindings: Finding[];
  agentOutputs: Partial<Record<AgentContractId, unknown>>;
  evidenceFindings: (output: T) => Finding[];
}): Promise<T> {
  const state = request.stageState.get(request.agentId);
  if (state !== undefined && isResumeCompletedStatus(state.status)) {
    if (state.output === undefined) {
      throw new Error(
        `Ambiguous run state: completed ${request.agentId} is missing output`,
      );
    }
    const output = state.output as T;
    request.schemaReports.push({ agentId: request.agentId, valid: true, errors: [] });
    request.evidenceReports.push({ agentId: request.agentId, valid: true, errors: [] });
    request.agentOutputs[request.agentId] = output;
    await recordCandidateFindings(request.input, output.findings);
    request.candidateFindings.push(...output.findings);
    return output;
  }

  if (state?.status === "RUNNING") {
    throw new Error(`Ambiguous run state: ${request.agentId} is still RUNNING`);
  }

  const schemaResult = await runAgentWorkflowStep({
    input: request.input,
    workspace: request.input.workspace,
    agentId: request.agentId,
    progressName: request.progressName,
    repoIndexSummary: request.repoIndexSummary,
    memorySnapshot: request.memorySnapshot,
    previousOutputs: request.previousOutputs,
    attempt: (state?.attempt ?? 0) + 1,
    ...(request.qualityCommandReport === undefined
      ? {}
      : { qualityCommandReport: request.qualityCommandReport }),
  });

  if (!schemaResult.valid) {
    throw new InspectionRunFailedError(
      `${request.progressName} schema validation failed: ${schemaResult.errors[0]?.message}`,
      request.input.workspace,
    );
  }
  request.schemaReports.push({ agentId: request.agentId, valid: true, errors: [] });

  const output = schemaResult.value as T;
  const evidenceResult = await validateEvidenceForAgent({
    agentId: request.agentId,
    workspace: request.input.workspace,
    repositoryReader: request.input.repositoryReader,
    entries: await request.input.repositoryReader.listEntries(),
    findings: request.evidenceFindings(output),
    evidenceReports: request.input.evidenceReports,
    attempt: (state?.attempt ?? 0) + 1,
  });
  await writeEvidenceLifecycleStatus({
    input: request.input,
    workspace: request.input.workspace,
    lifecycle: schemaResult.lifecycle,
    valid: evidenceResult.valid,
    reason: evidenceResult.errors[0]?.message,
  });

  if (!evidenceResult.valid) {
    throw new InspectionRunFailedError(
      `${request.progressName} evidence validation failed: ${evidenceResult.errors[0]?.message}`,
      request.input.workspace,
    );
  }
  request.evidenceReports.push({ agentId: request.agentId, valid: true, errors: [] });
  request.agentOutputs[request.agentId] = output;
  await recordCandidateFindings(request.input, output.findings);
  request.candidateFindings.push(...output.findings);
  return output;
}

async function recordCandidateFindings(
  input: ResumeScoutArchitectureInspectionInput,
  findings: Finding[],
): Promise<void> {
  const memory = input.memory(input.workspace);
  for (const finding of findings) {
    await appendSwarmFinding({
      finding,
      memory,
      validator: input.validators.finding,
    });
  }
}

function isResumeCompletedStatus(status: string): boolean {
  return ["EVIDENCE_VALIDATED", "QA_REVIEWED", "APPROVED"].includes(status);
}
