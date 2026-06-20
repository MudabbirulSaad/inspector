import { getAgentContract, type AgentContractId } from "../agents/index.js";
import type { Finding, RevisionRequest } from "../domain/types.js";
import type {
  EvidenceValidationReportWriter,
  RepositoryEntry,
  RepositoryReader,
  RunWorkspace,
  SwarmMemoryStore,
} from "../ports/index.js";
import { appendSwarmFinding } from "./append-swarm-memory.js";
import type { RunScoutArchitectureInspectionInput } from "./run-scout-architecture-inspection.js";
import {
  runAgentWorkflowStep,
  writeEvidenceLifecycleStatus,
  type RuntimeSpecialistAgentId,
} from "./run-agent-workflow-step.js";
import {
  displayNameForAgent,
  evidenceFindingsForAgentOutput,
  findingsForAgentOutput,
  replaceCandidateFindingsForAgent,
  replaceEvidenceReport,
  replaceSchemaReport,
} from "./specialist-output-mappers.js";
import {
  type EvidenceValidationResult,
  repositoryFilesForEvidence,
  validateEvidenceReferences,
} from "./validate-evidence-references.js";
import type { RepositoryIgnoreOptions } from "./repository-ignore-rules.js";
import type { QaEvidenceReport, QaSchemaReport } from "./verify-findings-with-qa.js";

export async function routeQaRevisionRequests(input: {
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
  const requestsByOwner = new Map<RuntimeSpecialistAgentId, RevisionRequest[]>();

  for (const request of input.revisionRequests) {
    if (isRuntimeSpecialistAgentId(request.targetAgent)) {
      requestsByOwner.set(request.targetAgent, [
        ...(requestsByOwner.get(request.targetAgent) ?? []),
        request,
      ]);
    }
  }

  for (const [agentId, revisionRequests] of requestsByOwner) {
    const agent = getAgentContract(agentId);
    const nextAttempt = 2;
    const retryNumber = nextAttempt - 1;

    if (
      input.input.config.maxRetries === undefined
        ? nextAttempt > agent.retryPolicy.maxAttempts
        : retryNumber > input.input.config.maxRetries
    ) {
      continue;
    }

    input.input.progress?.(
      `Retrying ${displayNameForAgent(agentId)} after QA feedback (attempt ${nextAttempt})`,
    );
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
      ignoreOptions: {
        targetRoot: input.input.config.target.root,
        outputDirectory: input.input.config.outputDirectory,
      },
      findings: evidenceFindingsForAgentOutput(agentId, output),
      evidenceReports: input.input.evidenceReports,
      attempt: nextAttempt,
    });
    await writeEvidenceLifecycleStatus({
      input: input.input,
      workspace: input.workspace,
      lifecycle: schemaResult.lifecycle,
      valid: evidenceResult.valid,
      reason: evidenceResult.errors[0]?.message,
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

function isRuntimeSpecialistAgentId(
  agentId: string,
): agentId is RuntimeSpecialistAgentId {
  return (
    agentId === "scout" ||
    agentId === "architecture" ||
    agentId === "pattern_miner" ||
    agentId === "flow_tracer" ||
    agentId === "testing_strategy" ||
    agentId === "tradeoff_analyst"
  );
}

async function validateEvidenceForAgent(input: {
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
