import { getAgentContract, type AgentContractId } from "../agents/index.js";
import type {
  ArchitectureOutput,
  Evidence,
  Finding,
  PatternMinerOutput,
  RevisionRequest,
  RunConfig,
  ScoutOutput,
} from "../domain/types.js";
import type {
  AgentOutputArtifactWriter,
  AgentOutputSchemaReader,
  AgentRunner,
  Clock,
  EvidenceValidationReportWriter,
  PromptArtifactWriter,
  PromptTemplateReader,
  QaArtifactWriter,
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
import { buildAgentPrompt } from "./build-agent-prompt.js";
import { createInspectionRunWorkspace } from "./create-inspection-run-workspace.js";
import { executeAgentRun } from "./execute-agent-run.js";
import { indexTargetRepository } from "./index-target-repository.js";
import { validateAgentOutput } from "./validate-agent-output.js";
import {
  type EvidenceValidationResult,
  repositoryFilesForEvidence,
  validateEvidenceReferences,
} from "./validate-evidence-references.js";
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
  outputArtifacts: AgentOutputArtifactWriter;
  validationReports: ValidationReportWriter;
  evidenceReports: EvidenceValidationReportWriter;
  qaArtifacts: QaArtifactWriter;
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
  input.progress?.("Creating run workspace");
  const workspace = await createInspectionRunWorkspace({
    config: input.config,
    clock: input.clock,
    workspaces: input.workspaces,
  });

  const entries = await input.repositoryReader.listEntries();

  input.progress?.("Indexing repository");
  await indexTargetRepository({
    target: input.config.target,
    reader: input.repositoryReader,
    writer: input.repositoryIndexWriter,
    workspace,
  });
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

  const scoutOutput = scoutSchemaResult.value as ScoutOutput;
  agentOutputs.scout = scoutOutput;
  const scoutEvidence = scoutEvidenceFindings(scoutOutput);

  input.progress?.("Validating Scout evidence");
  const scoutEvidenceResult = await validateEvidenceForAgent({
    agentId: "scout",
    workspace,
    repositoryReader: input.repositoryReader,
    entries,
    findings: scoutEvidence,
    evidenceReports: input.evidenceReports,
  });

  if (!scoutEvidenceResult.valid) {
    throw new InspectionRunFailedError(
      `Scout evidence validation failed: ${scoutEvidenceResult.errors[0]?.message}`,
      workspace,
    );
  }
  evidenceReports.push({ agentId: "scout", valid: true, errors: [] });

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

  const architectureOutput =
    architectureSchemaResult.value as ArchitectureOutput;
  agentOutputs.architecture = architectureOutput;

  input.progress?.("Validating Architecture evidence");
  const architectureEvidenceResult = await validateEvidenceForAgent({
    agentId: "architecture",
    workspace,
    repositoryReader: input.repositoryReader,
    entries,
    findings: architectureEvidenceFindings(architectureOutput),
    evidenceReports: input.evidenceReports,
  });

  if (!architectureEvidenceResult.valid) {
    throw new InspectionRunFailedError(
      `Architecture evidence validation failed: ${architectureEvidenceResult.errors[0]?.message}`,
      workspace,
    );
  }
  evidenceReports.push({ agentId: "architecture", valid: true, errors: [] });

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

  const patternMinerOutput =
    patternMinerSchemaResult.value as PatternMinerOutput;
  agentOutputs.pattern_miner = patternMinerOutput;

  input.progress?.("Validating Pattern Miner evidence");
  const patternMinerEvidenceResult = await validateEvidenceForAgent({
    agentId: "pattern_miner",
    workspace,
    repositoryReader: input.repositoryReader,
    entries,
    findings: patternMinerEvidenceFindings(patternMinerOutput),
    evidenceReports: input.evidenceReports,
  });

  if (!patternMinerEvidenceResult.valid) {
    throw new InspectionRunFailedError(
      `Pattern Miner evidence validation failed: ${patternMinerEvidenceResult.errors[0]?.message}`,
      workspace,
    );
  }
  evidenceReports.push({ agentId: "pattern_miner", valid: true, errors: [] });

  for (const finding of patternMinerOutput.findings) {
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
  return { workspace };
}

async function runAgentWorkflowStep(input: {
  input: RunScoutArchitectureInspectionInput;
  workspace: RunWorkspace;
  agentId: "scout" | "architecture" | "pattern_miner";
  progressName: string;
  repoIndexSummary: unknown;
  memorySnapshot: string;
  previousOutputs: unknown;
  attempt?: number;
  revisionRequest?: unknown;
}): ReturnType<typeof validateAgentOutput> {
  const agent = getAgentContract(input.agentId);
  const attempt = input.attempt ?? 1;
  const prompt = await buildAgentPrompt({
    agentId: input.agentId,
    attempt,
    workspace: input.workspace,
    templates: input.input.promptTemplates,
    artifacts: input.input.promptArtifacts,
    objective: input.input.objective,
    targetRepoContext: input.input.config.target,
    repoIndexSummary: input.repoIndexSummary,
    previousOutputs: input.previousOutputs,
    memorySnapshot: input.memorySnapshot,
    revisionRequest: input.revisionRequest,
    outputSchema: await input.input.schemaReader.readAgentOutputSchema(
      agent.outputSchema,
    ),
  });

  input.input.progress?.(
    attempt === 1
      ? `Running ${input.progressName}`
      : `Running ${input.progressName} revision attempt ${attempt}`,
  );
  const run = await executeAgentRun({
    runner: input.input.runner,
    agentId: input.agentId,
    attempt,
    prompt: prompt.prompt,
    workspaceRoot: input.workspace.root,
    onStreamingEvent: (event) => {
      input.input.stream?.(input.agentId, event.kind, event.message);
    },
  });
  await input.input.outputArtifacts.writeAgentOutput({
    workspace: input.workspace,
    agentId: input.agentId,
    attempt,
    content: run.stdout,
  });

  input.input.progress?.(`Validating ${input.progressName} schema`);
  return validateAgentOutput({
    workspace: input.workspace,
    agent,
    attempt,
    rawOutput: run.stdout,
    validators: input.input.validators,
    reports: input.input.validationReports,
  });
}

async function validateEvidenceForAgent(input: {
  agentId: string;
  workspace: RunWorkspace;
  repositoryReader: RepositoryReader;
  entries: RepositoryEntry[];
  findings: Finding[];
  evidenceReports: EvidenceValidationReportWriter;
  attempt?: number;
}): Promise<EvidenceValidationResult> {
  const repositoryFiles = await repositoryFilesForEvidence(
    input.repositoryReader,
    input.entries,
    input.findings.flatMap((finding) => finding.evidence),
  );
  const result = validateEvidenceReferences({
    repositoryFiles,
    findings: input.findings,
  });

  await input.evidenceReports.writeEvidenceValidationReport({
    workspace: input.workspace,
    agentId: input.agentId,
    attempt: input.attempt ?? 1,
    content: `${JSON.stringify(result, null, 2)}\n`,
  });

  return result;
}

async function routeQaRevisionRequests(input: {
  input: RunScoutArchitectureInspectionInput;
  workspace: RunWorkspace;
  runMemory: SwarmMemoryStore;
  repoIndexSummary: unknown;
  memorySnapshot: string;
  entries: RepositoryEntry[];
  candidateFindings: Finding[];
  schemaReports: QaSchemaReport[];
  evidenceReports: QaEvidenceReport[];
  agentOutputs: Partial<Record<AgentContractId, unknown>>;
  revisionRequests: RevisionRequest[];
}): Promise<void> {
  const requestsByOwner = new Map<
    "scout" | "architecture" | "pattern_miner",
    RevisionRequest[]
  >();

  for (const request of input.revisionRequests) {
    if (
      request.targetAgent === "scout" ||
      request.targetAgent === "architecture" ||
      request.targetAgent === "pattern_miner"
    ) {
      requestsByOwner.set(request.targetAgent, [
        ...(requestsByOwner.get(request.targetAgent) ?? []),
        request,
      ]);
    }
  }

  for (const [agentId, revisionRequests] of requestsByOwner) {
    const agent = getAgentContract(agentId);
    const nextAttempt = 2;

    if (nextAttempt > agent.retryPolicy.maxAttempts) {
      continue;
    }

    const schemaResult = await runAgentWorkflowStep({
      input: input.input,
      workspace: input.workspace,
      agentId,
      progressName: displayNameForAgent(agentId),
      repoIndexSummary: input.repoIndexSummary,
      memorySnapshot: input.memorySnapshot,
      previousOutputs: {
        previousOwnerOutput: input.agentOutputs[agentId],
        allPreviousOutputs: input.agentOutputs,
      },
      attempt: nextAttempt,
      revisionRequest: revisionRequests,
    });

    replaceSchemaReport(input.schemaReports, {
      agentId,
      valid: schemaResult.valid,
      errors: schemaResult.errors.map((error) => ({
        message: error.message,
        path: error.path,
        keyword: error.keyword,
      })),
    });

    if (!schemaResult.valid) {
      continue;
    }

    const output = schemaResult.value;
    const findings = findingsForAgentOutput(agentId, output);
    input.agentOutputs[agentId] = output;
    replaceCandidateFindingsForAgent(input.candidateFindings, agentId, findings);

    const evidenceResult = await validateEvidenceForAgent({
      agentId,
      workspace: input.workspace,
      repositoryReader: input.input.repositoryReader,
      entries: input.entries,
      findings: evidenceFindingsForAgentOutput(agentId, output),
      evidenceReports: input.input.evidenceReports,
      attempt: nextAttempt,
    });

    replaceEvidenceReport(input.evidenceReports, {
      agentId,
      valid: evidenceResult.valid,
      errors: evidenceResult.errors,
    });

    if (!evidenceResult.valid) {
      continue;
    }

    for (const finding of findings) {
      await appendSwarmFinding({
        finding,
        memory: input.runMemory,
        validator: input.input.validators.finding,
      });
    }
  }
}

function displayNameForAgent(
  agentId: "scout" | "architecture" | "pattern_miner",
): string {
  return agentId === "pattern_miner"
    ? "Pattern Miner"
    : agentId[0]?.toUpperCase() + agentId.slice(1);
}

function replaceSchemaReport(
  reports: QaSchemaReport[],
  next: QaSchemaReport,
): void {
  const index = reports.findIndex((report) => report.agentId === next.agentId);
  if (index === -1) {
    reports.push(next);
    return;
  }
  reports[index] = next;
}

function replaceEvidenceReport(
  reports: QaEvidenceReport[],
  next: QaEvidenceReport,
): void {
  const index = reports.findIndex((report) => report.agentId === next.agentId);
  if (index === -1) {
    reports.push(next);
    return;
  }
  reports[index] = next;
}

function replaceCandidateFindingsForAgent(
  findings: Finding[],
  agentId: string,
  replacements: Finding[],
): void {
  const retained = findings.filter((finding) => finding.agent !== agentId);
  findings.splice(0, findings.length, ...retained, ...replacements);
}

function findingsForAgentOutput(
  agentId: "scout" | "architecture" | "pattern_miner",
  output: unknown,
): Finding[] {
  if (agentId === "scout") {
    return (output as ScoutOutput).findings;
  }
  if (agentId === "architecture") {
    return (output as ArchitectureOutput).findings;
  }
  return (output as PatternMinerOutput).findings;
}

function evidenceFindingsForAgentOutput(
  agentId: "scout" | "architecture" | "pattern_miner",
  output: unknown,
): Finding[] {
  if (agentId === "scout") {
    return scoutEvidenceFindings(output as ScoutOutput);
  }
  if (agentId === "architecture") {
    return architectureEvidenceFindings(output as ArchitectureOutput);
  }
  return patternMinerEvidenceFindings(output as PatternMinerOutput);
}

function renderInitialMemorySnapshot(objective: string): string {
  return [`## Run initialized`, "", `Objective: ${objective.trim()}`, "", ""].join(
    "\n",
  );
}

function scoutEvidenceFindings(output: ScoutOutput): Finding[] {
  return [
    evidenceFinding(
      "finding-scout-project-type",
      `Scout identified project type: ${output.projectType.value}`,
      output.projectType.evidence,
    ),
    ...output.detectedStack.map((signal, index) =>
      evidenceFinding(
        `finding-scout-stack-${index + 1}`,
        `Scout detected stack signal: ${signal.name}`,
        signal.evidence,
      ),
    ),
    ...output.importantFiles.map((file, index) =>
      evidenceFinding(
        `finding-scout-important-file-${index + 1}`,
        `Scout marked ${file.path} as important: ${file.reason}`,
        file.evidence,
      ),
    ),
    ...output.entryPoints.map((entryPoint, index) =>
      evidenceFinding(
        `finding-scout-entrypoint-${index + 1}`,
        `Scout marked ${entryPoint.path} as an entry point: ${entryPoint.kind}`,
        entryPoint.evidence,
      ),
    ),
    evidenceFinding(
      "finding-scout-architecture-impression",
      output.architectureImpression.summary,
      output.architectureImpression.evidence,
    ),
    ...output.findings,
  ];
}

function evidenceFinding(id: string, claim: string, evidence: Evidence[]): Finding {
  return {
    id,
    agent: "scout",
    severity: "info",
    claim,
    evidence,
    recommendation: "Use this Scout observation only as initial inspection context.",
    confidence: 0.5,
  };
}

function architectureEvidenceFindings(output: ArchitectureOutput): Finding[] {
  return [
    ...output.layerMap.map((item, index) =>
      architectureObservationFinding("layer-map", index, item),
    ),
    ...output.dependencyDirection.map((item, index) =>
      architectureObservationFinding(
        "dependency-direction",
        index,
        item,
        `${item.source} -> ${item.target}: ${item.direction}`,
      ),
    ),
    ...output.moduleBoundaries.map((item, index) =>
      architectureObservationFinding("module-boundary", index, item),
    ),
    ...output.businessLogicLocations.map((item, index) =>
      architectureObservationFinding("business-logic", index, item),
    ),
    ...output.frameworkGlueLocations.map((item, index) =>
      architectureObservationFinding("framework-glue", index, item),
    ),
    ...output.architectureRisks.map((item, index) =>
      architectureObservationFinding("risk", index, item),
    ),
    ...output.findings,
  ];
}

function patternMinerEvidenceFindings(output: PatternMinerOutput): Finding[] {
  return [
    ...output.patterns.map((pattern, index) => ({
      id: `finding-pattern-miner-pattern-${index + 1}`,
      agent: "pattern_miner",
      severity: "info" as const,
      claim: `${pattern.name}: ${pattern.problemSolved}`,
      evidence: pattern.evidence,
      recommendation: pattern.adaptationValue,
      confidence: pattern.confidence,
    })),
    ...output.findings,
  ];
}

function architectureObservationFinding(
  kind: string,
  index: number,
  observation: {
    name: string;
    observedFacts: string[];
    interpretation?: string;
    evidence: Evidence[];
  },
  detail = observation.name,
): Finding {
  return {
    id: `finding-architecture-${kind}-${index + 1}`,
    agent: "architecture",
    severity: "info",
    claim: `${detail}: ${observation.observedFacts.join(" ")}`,
    evidence: observation.evidence,
    recommendation:
      observation.interpretation ??
      "Treat this architecture observation as evidence-backed context.",
    confidence: 0.5,
  };
}
