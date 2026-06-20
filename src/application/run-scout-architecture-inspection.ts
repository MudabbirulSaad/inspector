import type { AgentContractId } from "../agents/index.js";
import type {
  ArchitectureOutput,
  Finding,
  FlowTracerOutput,
  PatternMinerOutput,
  RunConfig,
  ScoutOutput,
  TestingStrategyOutput,
  TradeoffAnalystOutput,
} from "../domain/types.js";
import type {
  AgentOutputArtifactWriter,
  AgentOutputSchemaReader,
  AgentRunner,
  AgentStatusArtifactWriter,
  CaseStudyDocumentWriter,
  Clock,
  EvidenceValidationReportWriter,
  PromptArtifactWriter,
  PromptTemplateReader,
  QaArtifactWriter,
  QualityCommandReportWriter,
  ProcessRunner,
  RagKnowledgeCardWriter,
  RepositoryEntry,
  RepositoryIndexPromptContextReader,
  RepositoryIndexWriter,
  RepositoryReader,
  RunWorkspace,
  RunWorkspaceStore,
  SwarmMemoryStore,
  ValidationReportWriter,
} from "../ports/index.js";
import type { SchemaContractValidators } from "../validation/index.js";
import {
  appendRejectedSwarmFinding,
  appendSwarmBlackboardSnapshot,
  appendSwarmFinding,
  appendSwarmQaIssue,
  appendVerifiedSwarmFinding,
} from "./append-swarm-memory.js";
import { createInspectionRunWorkspace } from "./create-inspection-run-workspace.js";
import { generateCaseStudyDocumentation } from "./generate-case-study-documentation.js";
import { generateRagKnowledgeCards } from "./generate-rag-knowledge-cards.js";
import { indexTargetRepository } from "./index-target-repository.js";
import { detectRepositoryCommands } from "./detect-repository-commands.js";
import {
  runQualityCommands,
  writeQualityCommandReport,
} from "./run-quality-commands.js";
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
  runAgentWorkflowStep,
  writeEvidenceLifecycleStatus,
} from "./run-agent-workflow-step.js";
import { routeQaRevisionRequests } from "./qa-revision-routing.js";
import {
  type EvidenceValidationResult,
  repositoryFilesForEvidence,
  validateEvidenceReferences,
} from "./validate-evidence-references.js";
import type { RepositoryIgnoreOptions } from "./repository-ignore-rules.js";
import {
  type QaEvidenceReport,
  type QaSchemaReport,
  verifyFindingsWithQa,
} from "./verify-findings-with-qa.js";

export interface RunScoutArchitectureInspectionInput {
  config: RunConfig;
  objective: string;
  clock: Clock;
  runner: AgentRunner;
  workspaces: RunWorkspaceStore;
  repositoryReader: RepositoryReader;
  repositoryIndexWriter: RepositoryIndexWriter;
  repositoryIndexContext: RepositoryIndexPromptContextReader;
  memory: (workspace: RunWorkspace) => SwarmMemoryStore;
  promptTemplates: PromptTemplateReader;
  promptArtifacts: PromptArtifactWriter;
  statusArtifacts: AgentStatusArtifactWriter;
  outputArtifacts: AgentOutputArtifactWriter;
  validationReports: ValidationReportWriter;
  evidenceReports: EvidenceValidationReportWriter;
  qaArtifacts: QaArtifactWriter;
  qualityCommandReports: QualityCommandReportWriter;
  finalDocs: CaseStudyDocumentWriter;
  ragCards: RagKnowledgeCardWriter;
  processRunner: ProcessRunner;
  validators: SchemaContractValidators;
  schemaReader: AgentOutputSchemaReader;
  progress?: (message: string) => void;
  stream?: (agentId: string, kind: string, message: string) => void;
}

export interface RunScoutArchitectureInspectionResult {
  workspace: RunWorkspace;
}

export class InspectionRunFailedError extends Error {
  constructor(
    message: string,
    readonly workspace: RunWorkspace,
  ) {
    super(message);
  }
}

export async function runScoutArchitectureInspection(
  input: RunScoutArchitectureInspectionInput,
): Promise<RunScoutArchitectureInspectionResult> {
  validateRuntimeConfig(input.config);

  input.progress?.("Run workspace creation started");
  const workspace = await createInspectionRunWorkspace({
    config: input.config,
    clock: input.clock,
    workspaces: input.workspaces,
  });
  input.progress?.("Run workspace creation finished");

  const entries = await input.repositoryReader.listEntries();

  input.progress?.("Repository indexing started");
  await indexTargetRepository({
    target: input.config.target,
    outputDirectory: input.config.outputDirectory,
    reader: input.repositoryReader,
    writer: input.repositoryIndexWriter,
    workspace,
  });
  input.progress?.("Repository indexing finished");

  input.progress?.("Validation command execution started");
  const detectedCommands = await detectRepositoryCommands(
    input.repositoryReader,
    entries,
  );
  const commandReport = await runQualityCommands({
    detectedCommands,
    cwd: input.config.target.root,
    runner: input.processRunner,
    enabled: input.config.runQualityCommands === true,
    ...(input.config.runner?.timeoutMs === undefined
      ? {}
      : { timeoutMs: input.config.runner.timeoutMs }),
  });
  await writeQualityCommandReport({
    workspace,
    report: commandReport,
    writer: input.qualityCommandReports,
  });
  input.progress?.("Validation command execution finished");

  const repoIndexSummary =
    await input.repositoryIndexContext.readRepositoryIndexPromptContext(workspace);

  input.progress?.("Initializing memory");
  const runMemory = input.memory(workspace);
  const memorySnapshot = renderInitialMemorySnapshot(input.objective);
  const candidateFindings: Finding[] = [];
  const schemaReports: QaSchemaReport[] = [];
  const evidenceReports: QaEvidenceReport[] = [];
  const agentOutputs: Partial<Record<AgentContractId, unknown>> = {};
  await appendSwarmBlackboardSnapshot({
    title: "Run initialized",
    body: `Objective: ${input.objective.trim()}`,
    memory: runMemory,
  });

  const scoutSchemaResult = await runAgentWorkflowStep({
    input,
    workspace,
    agentId: "scout",
    progressName: "Scout",
    repoIndexSummary,
    memorySnapshot,
    previousOutputs: [],
  });

  if (!scoutSchemaResult.valid) {
    throw new InspectionRunFailedError(
      `Scout schema validation failed: ${scoutSchemaResult.errors[0]?.message}`,
      workspace,
    );
  }
  schemaReports.push({ agentId: "scout", valid: true, errors: [] });
  input.progress?.("Validation passed: Scout schema");

  const scoutOutput = scoutSchemaResult.value as ScoutOutput;
  agentOutputs.scout = scoutOutput;
  const scoutEvidence = scoutEvidenceFindings(scoutOutput);

  input.progress?.("Validating Scout evidence");
  const scoutEvidenceResult = await validateEvidenceForAgent({
    agentId: "scout",
    workspace,
    repositoryReader: input.repositoryReader,
    entries,
    ignoreOptions: {
      targetRoot: input.config.target.root,
      outputDirectory: input.config.outputDirectory,
    },
    findings: scoutEvidence,
    evidenceReports: input.evidenceReports,
  });
  await writeEvidenceLifecycleStatus({
    input,
    workspace,
    lifecycle: scoutSchemaResult.lifecycle,
    valid: scoutEvidenceResult.valid,
    reason: scoutEvidenceResult.errors[0]?.message,
  });

  if (!scoutEvidenceResult.valid) {
    throw new InspectionRunFailedError(
      `Scout evidence validation failed: ${scoutEvidenceResult.errors[0]?.message}`,
      workspace,
    );
  }
  evidenceReports.push({ agentId: "scout", valid: true, errors: [] });
  input.progress?.("Validation passed: Scout evidence");

  for (const finding of scoutOutput.findings) {
    candidateFindings.push(finding);
    await appendSwarmFinding({
      finding,
      memory: runMemory,
      validator: input.validators.finding,
    });
  }

  const architectureSchemaResult = await runAgentWorkflowStep({
    input,
    workspace,
    agentId: "architecture",
    progressName: "Architecture",
    repoIndexSummary,
    memorySnapshot,
    previousOutputs: { scout: scoutOutput },
  });

  if (!architectureSchemaResult.valid) {
    throw new InspectionRunFailedError(
      `Architecture schema validation failed: ${architectureSchemaResult.errors[0]?.message}`,
      workspace,
    );
  }
  schemaReports.push({ agentId: "architecture", valid: true, errors: [] });
  input.progress?.("Validation passed: Architecture schema");

  const architectureOutput =
    architectureSchemaResult.value as ArchitectureOutput;
  agentOutputs.architecture = architectureOutput;

  input.progress?.("Validating Architecture evidence");
  const architectureEvidenceResult = await validateEvidenceForAgent({
    agentId: "architecture",
    workspace,
    repositoryReader: input.repositoryReader,
    entries,
    ignoreOptions: {
      targetRoot: input.config.target.root,
      outputDirectory: input.config.outputDirectory,
    },
    findings: architectureEvidenceFindings(architectureOutput),
    evidenceReports: input.evidenceReports,
  });
  await writeEvidenceLifecycleStatus({
    input,
    workspace,
    lifecycle: architectureSchemaResult.lifecycle,
    valid: architectureEvidenceResult.valid,
    reason: architectureEvidenceResult.errors[0]?.message,
  });

  if (!architectureEvidenceResult.valid) {
    throw new InspectionRunFailedError(
      `Architecture evidence validation failed: ${architectureEvidenceResult.errors[0]?.message}`,
      workspace,
    );
  }
  evidenceReports.push({ agentId: "architecture", valid: true, errors: [] });
  input.progress?.("Validation passed: Architecture evidence");

  for (const finding of architectureOutput.findings) {
    candidateFindings.push(finding);
    await appendSwarmFinding({
      finding,
      memory: runMemory,
      validator: input.validators.finding,
    });
  }

  const patternMinerSchemaResult = await runAgentWorkflowStep({
    input,
    workspace,
    agentId: "pattern_miner",
    progressName: "Pattern Miner",
    repoIndexSummary,
    memorySnapshot,
    previousOutputs: { scout: scoutOutput, architecture: architectureOutput },
  });

  if (!patternMinerSchemaResult.valid) {
    throw new InspectionRunFailedError(
      `Pattern Miner schema validation failed: ${patternMinerSchemaResult.errors[0]?.message}`,
      workspace,
    );
  }
  schemaReports.push({ agentId: "pattern_miner", valid: true, errors: [] });
  input.progress?.("Validation passed: Pattern Miner schema");

  const patternMinerOutput =
    patternMinerSchemaResult.value as PatternMinerOutput;
  agentOutputs.pattern_miner = patternMinerOutput;

  input.progress?.("Validating Pattern Miner evidence");
  const patternMinerEvidenceResult = await validateEvidenceForAgent({
    agentId: "pattern_miner",
    workspace,
    repositoryReader: input.repositoryReader,
    entries,
    ignoreOptions: {
      targetRoot: input.config.target.root,
      outputDirectory: input.config.outputDirectory,
    },
    findings: patternMinerEvidenceFindings(patternMinerOutput),
    evidenceReports: input.evidenceReports,
  });
  await writeEvidenceLifecycleStatus({
    input,
    workspace,
    lifecycle: patternMinerSchemaResult.lifecycle,
    valid: patternMinerEvidenceResult.valid,
    reason: patternMinerEvidenceResult.errors[0]?.message,
  });

  if (!patternMinerEvidenceResult.valid) {
    throw new InspectionRunFailedError(
      `Pattern Miner evidence validation failed: ${patternMinerEvidenceResult.errors[0]?.message}`,
      workspace,
    );
  }
  evidenceReports.push({ agentId: "pattern_miner", valid: true, errors: [] });
  input.progress?.("Validation passed: Pattern Miner evidence");

  for (const finding of patternMinerOutput.findings) {
    candidateFindings.push(finding);
    await appendSwarmFinding({
      finding,
      memory: runMemory,
      validator: input.validators.finding,
    });
  }

  const flowTracerSchemaResult = await runAgentWorkflowStep({
    input,
    workspace,
    agentId: "flow_tracer",
    progressName: "Flow Tracer",
    repoIndexSummary,
    memorySnapshot,
    previousOutputs: {
      scout: scoutOutput,
      architecture: architectureOutput,
      pattern_miner: patternMinerOutput,
    },
  });

  if (!flowTracerSchemaResult.valid) {
    throw new InspectionRunFailedError(
      `Flow Tracer schema validation failed: ${flowTracerSchemaResult.errors[0]?.message}`,
      workspace,
    );
  }
  schemaReports.push({ agentId: "flow_tracer", valid: true, errors: [] });
  input.progress?.("Validation passed: Flow Tracer schema");

  const flowTracerOutput = flowTracerSchemaResult.value as FlowTracerOutput;
  agentOutputs.flow_tracer = flowTracerOutput;

  input.progress?.("Validating Flow Tracer evidence");
  const flowTracerEvidenceResult = await validateEvidenceForAgent({
    agentId: "flow_tracer",
    workspace,
    repositoryReader: input.repositoryReader,
    entries,
    ignoreOptions: {
      targetRoot: input.config.target.root,
      outputDirectory: input.config.outputDirectory,
    },
    findings: flowTracerEvidenceFindings(flowTracerOutput),
    evidenceReports: input.evidenceReports,
  });
  await writeEvidenceLifecycleStatus({
    input,
    workspace,
    lifecycle: flowTracerSchemaResult.lifecycle,
    valid: flowTracerEvidenceResult.valid,
    reason: flowTracerEvidenceResult.errors[0]?.message,
  });

  if (!flowTracerEvidenceResult.valid) {
    throw new InspectionRunFailedError(
      `Flow Tracer evidence validation failed: ${flowTracerEvidenceResult.errors[0]?.message}`,
      workspace,
    );
  }
  evidenceReports.push({ agentId: "flow_tracer", valid: true, errors: [] });
  input.progress?.("Validation passed: Flow Tracer evidence");

  for (const finding of flowTracerOutput.findings) {
    candidateFindings.push(finding);
    await appendSwarmFinding({
      finding,
      memory: runMemory,
      validator: input.validators.finding,
    });
  }

  const testingStrategySchemaResult = await runAgentWorkflowStep({
    input,
    workspace,
    agentId: "testing_strategy",
    progressName: "Testing Strategy",
    repoIndexSummary,
    memorySnapshot,
    previousOutputs: {
      scout: scoutOutput,
      architecture: architectureOutput,
      pattern_miner: patternMinerOutput,
      flow_tracer: flowTracerOutput,
      qualityCommandReport: commandReport,
    },
    qualityCommandReport: commandReport,
  });

  if (!testingStrategySchemaResult.valid) {
    throw new InspectionRunFailedError(
      `Testing Strategy schema validation failed: ${testingStrategySchemaResult.errors[0]?.message}`,
      workspace,
    );
  }
  schemaReports.push({ agentId: "testing_strategy", valid: true, errors: [] });
  input.progress?.("Validation passed: Testing Strategy schema");

  const testingStrategyOutput =
    testingStrategySchemaResult.value as TestingStrategyOutput;
  agentOutputs.testing_strategy = testingStrategyOutput;

  input.progress?.("Validating Testing Strategy evidence");
  const testingStrategyEvidenceResult = await validateEvidenceForAgent({
    agentId: "testing_strategy",
    workspace,
    repositoryReader: input.repositoryReader,
    entries,
    ignoreOptions: {
      targetRoot: input.config.target.root,
      outputDirectory: input.config.outputDirectory,
    },
    findings: testingStrategyEvidenceFindings(testingStrategyOutput),
    evidenceReports: input.evidenceReports,
  });
  await writeEvidenceLifecycleStatus({
    input,
    workspace,
    lifecycle: testingStrategySchemaResult.lifecycle,
    valid: testingStrategyEvidenceResult.valid,
    reason: testingStrategyEvidenceResult.errors[0]?.message,
  });

  if (!testingStrategyEvidenceResult.valid) {
    throw new InspectionRunFailedError(
      `Testing Strategy evidence validation failed: ${testingStrategyEvidenceResult.errors[0]?.message}`,
      workspace,
    );
  }
  evidenceReports.push({ agentId: "testing_strategy", valid: true, errors: [] });
  input.progress?.("Validation passed: Testing Strategy evidence");

  for (const finding of testingStrategyOutput.findings) {
    candidateFindings.push(finding);
    await appendSwarmFinding({
      finding,
      memory: runMemory,
      validator: input.validators.finding,
    });
  }

  const tradeoffAnalystSchemaResult = await runAgentWorkflowStep({
    input,
    workspace,
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
  });

  if (!tradeoffAnalystSchemaResult.valid) {
    throw new InspectionRunFailedError(
      `Tradeoff Analyst schema validation failed: ${tradeoffAnalystSchemaResult.errors[0]?.message}`,
      workspace,
    );
  }
  schemaReports.push({ agentId: "tradeoff_analyst", valid: true, errors: [] });
  input.progress?.("Validation passed: Tradeoff Analyst schema");

  const tradeoffAnalystOutput =
    tradeoffAnalystSchemaResult.value as TradeoffAnalystOutput;
  agentOutputs.tradeoff_analyst = tradeoffAnalystOutput;

  input.progress?.("Validating Tradeoff Analyst evidence");
  const tradeoffAnalystEvidenceResult = await validateEvidenceForAgent({
    agentId: "tradeoff_analyst",
    workspace,
    repositoryReader: input.repositoryReader,
    entries,
    ignoreOptions: {
      targetRoot: input.config.target.root,
      outputDirectory: input.config.outputDirectory,
    },
    findings: tradeoffAnalystEvidenceFindings(tradeoffAnalystOutput),
    evidenceReports: input.evidenceReports,
  });
  await writeEvidenceLifecycleStatus({
    input,
    workspace,
    lifecycle: tradeoffAnalystSchemaResult.lifecycle,
    valid: tradeoffAnalystEvidenceResult.valid,
    reason: tradeoffAnalystEvidenceResult.errors[0]?.message,
  });

  if (!tradeoffAnalystEvidenceResult.valid) {
    throw new InspectionRunFailedError(
      `Tradeoff Analyst evidence validation failed: ${tradeoffAnalystEvidenceResult.errors[0]?.message}`,
      workspace,
    );
  }
  evidenceReports.push({ agentId: "tradeoff_analyst", valid: true, errors: [] });
  input.progress?.("Validation passed: Tradeoff Analyst evidence");

  for (const finding of tradeoffAnalystOutput.findings) {
    candidateFindings.push(finding);
    await appendSwarmFinding({
      finding,
      memory: runMemory,
      validator: input.validators.finding,
    });
  }

  input.progress?.("Running QA verification");
  let qa = await verifyFindingsWithQa({
    candidateFindings,
    schemaReports,
    evidenceReports,
    agentReports: [],
    memory: memorySnapshot,
    now: input.clock.now(),
    workspace,
    artifacts: input.qaArtifacts,
  });

  for (const issue of qa.qaIssues) {
    await appendSwarmQaIssue({
      issue,
      memory: runMemory,
      validator: input.validators["qa-issue"],
    });
  }
  input.progress?.(`QA issues found: ${qa.qaIssues.length}`);

  if (qa.revisionRequests.length > 0) {
    input.progress?.("Routing QA revisions to owner agents");
    await routeQaRevisionRequests({
      input,
      workspace,
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

    input.progress?.("Re-running QA verification after revisions");
    qa = await verifyFindingsWithQa({
      candidateFindings,
      schemaReports,
      evidenceReports,
      agentReports: [],
      memory: memorySnapshot,
      now: input.clock.now(),
      workspace,
      artifacts: input.qaArtifacts,
    });

    for (const issue of qa.qaIssues) {
      await appendSwarmQaIssue({
        issue,
        memory: runMemory,
        validator: input.validators["qa-issue"],
      });
    }
    input.progress?.(`QA issues found after retry: ${qa.qaIssues.length}`);
  }

  input.progress?.(
    `QA verification passed: ${qa.approvedFindings.length} approved, ${qa.rejectedFindings.length} rejected`,
  );

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

  input.progress?.("Writing final case-study documentation");
  await generateCaseStudyDocumentation({
    workspace,
    writer: input.finalDocs,
    repository: input.config.target,
    objective: input.objective,
    approvedFindings: qa.approvedFindings,
    rejectedFindings: qa.rejectedFindings,
    qaResults: qa.qaResults,
    generatedAt: input.clock.now(),
  });

  input.progress?.("Writing final RAG knowledge cards");
  await generateRagKnowledgeCards({
    workspace,
    writer: input.ragCards,
    repository: input.config.target,
    approvedFindings: qa.approvedFindings,
    rejectedFindings: qa.rejectedFindings,
    validator: input.validators["knowledge-card"],
    generatedAt: input.clock.now(),
  });

  return { workspace };
}

const implementedSpecialistSequence = [
  "scout",
  "architecture",
  "pattern_miner",
  "flow_tracer",
  "testing_strategy",
  "tradeoff_analyst",
] as const;

export function validateRuntimeConfig(config: RunConfig): void {
  if (config.parallelism !== undefined && config.parallelism > 1) {
    throw new Error(
      "parallelism > 1 is reserved for scheduler-driven orchestration and is not active before Milestone 34+",
    );
  }

  if (config.agents === undefined) {
    return;
  }

  if (
    config.agents.length !== implementedSpecialistSequence.length ||
    config.agents.some(
      (agentId, index) => agentId !== implementedSpecialistSequence[index],
    )
  ) {
    throw new Error(
      "custom agent selection is reserved for scheduler-driven orchestration and is not active in the current runtime slice",
    );
  }
}

export async function validateEvidenceForAgent(input: {
  agentId: string;
  workspace: RunWorkspace;
  repositoryReader: RepositoryReader;
  entries: RepositoryEntry[];
  ignoreOptions?: RepositoryIgnoreOptions;
  findings: Finding[];
  evidenceReports: EvidenceValidationReportWriter;
  attempt?: number;
}): Promise<EvidenceValidationResult> {
  const repositoryFiles = await repositoryFilesForEvidence(
    input.repositoryReader,
    input.entries,
    input.findings.flatMap((finding) => finding.evidence),
    undefined,
    input.ignoreOptions,
  );
  const result = validateEvidenceReferences({
    repositoryFiles,
    findings: input.findings,
    ignoreOptions: input.ignoreOptions,
  });

  await input.evidenceReports.writeEvidenceValidationReport({
    workspace: input.workspace,
    agentId: input.agentId,
    attempt: input.attempt ?? 1,
    content: `${JSON.stringify(result, null, 2)}\n`,
  });

  return result;
}
