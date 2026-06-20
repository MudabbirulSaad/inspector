import { getAgentContract } from "../agents/index.js";
import type {
  ArchitectureOutput,
  Evidence,
  Finding,
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
import { appendSwarmBlackboardSnapshot, appendSwarmFinding } from "./append-swarm-memory.js";
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
  await appendSwarmBlackboardSnapshot({
    title: "Run initialized",
    body: `Objective: ${input.objective.trim()}`,
    memory: runMemory,
  });

  const scoutPrompt = await buildAgentPrompt({
    agentId: "scout",
    attempt: 1,
    workspace,
    templates: input.promptTemplates,
    artifacts: input.promptArtifacts,
    objective: input.objective,
    targetRepoContext: input.config.target,
    repoIndexSummary,
    previousOutputs: [],
    memorySnapshot,
    outputSchema: await input.schemaReader.readAgentOutputSchema("scout-output"),
  });

  input.progress?.("Running Scout");
  const scoutRun = await executeAgentRun({
    runner: input.runner,
    agentId: "scout",
    attempt: 1,
    prompt: scoutPrompt.prompt,
    workspaceRoot: workspace.root,
    onStreamingEvent: (event) => {
      input.stream?.("scout", event.kind, event.message);
    },
  });
  await input.outputArtifacts.writeAgentOutput({
    workspace,
    agentId: "scout",
    attempt: 1,
    content: scoutRun.stdout,
  });

  input.progress?.("Validating Scout schema");
  const scoutSchemaResult = await validateAgentOutput({
    workspace,
    agent: getAgentContract("scout"),
    attempt: 1,
    rawOutput: scoutRun.stdout,
    validators: input.validators,
    reports: input.validationReports,
  });

  if (!scoutSchemaResult.valid) {
    throw new InspectionRunFailedError(
      `Scout schema validation failed: ${scoutSchemaResult.errors[0]?.message}`,
      workspace,
    );
  }

  const scoutOutput = scoutSchemaResult.value as ScoutOutput;
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

  for (const finding of scoutOutput.findings) {
    await appendSwarmFinding({
      finding,
      memory: runMemory,
      validator: input.validators.finding,
    });
  }

  const architecturePrompt = await buildAgentPrompt({
    agentId: "architecture",
    attempt: 1,
    workspace,
    templates: input.promptTemplates,
    artifacts: input.promptArtifacts,
    objective: input.objective,
    targetRepoContext: input.config.target,
    repoIndexSummary,
    previousOutputs: { scout: scoutOutput },
    memorySnapshot,
    outputSchema: await input.schemaReader.readAgentOutputSchema(
      "architecture-output",
    ),
  });

  input.progress?.("Running Architecture");
  const architectureRun = await executeAgentRun({
    runner: input.runner,
    agentId: "architecture",
    attempt: 1,
    prompt: architecturePrompt.prompt,
    workspaceRoot: workspace.root,
    onStreamingEvent: (event) => {
      input.stream?.("architecture", event.kind, event.message);
    },
  });
  await input.outputArtifacts.writeAgentOutput({
    workspace,
    agentId: "architecture",
    attempt: 1,
    content: architectureRun.stdout,
  });

  input.progress?.("Validating Architecture schema");
  const architectureSchemaResult = await validateAgentOutput({
    workspace,
    agent: getAgentContract("architecture"),
    attempt: 1,
    rawOutput: architectureRun.stdout,
    validators: input.validators,
    reports: input.validationReports,
  });

  if (!architectureSchemaResult.valid) {
    throw new InspectionRunFailedError(
      `Architecture schema validation failed: ${architectureSchemaResult.errors[0]?.message}`,
      workspace,
    );
  }

  const architectureOutput =
    architectureSchemaResult.value as ArchitectureOutput;

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

  for (const finding of architectureOutput.findings) {
    await appendSwarmFinding({
      finding,
      memory: runMemory,
      validator: input.validators.finding,
    });
  }

  return { workspace };
}

async function validateEvidenceForAgent(input: {
  agentId: string;
  workspace: RunWorkspace;
  repositoryReader: RepositoryReader;
  entries: RepositoryEntry[];
  findings: Finding[];
  evidenceReports: EvidenceValidationReportWriter;
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
    attempt: 1,
    content: `${JSON.stringify(result, null, 2)}\n`,
  });

  return result;
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
