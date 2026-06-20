import { getAgentContract } from "../agents/index.js";
import {
  createAgentLifecycle,
  transitionAgentLifecycle,
  type AgentLifecycle,
  type AgentLifecycleStatus,
} from "../domain/agent-lifecycle.js";
import type { QualityCommandReport } from "./run-quality-commands.js";
import type { RunScoutArchitectureInspectionInput } from "./run-scout-architecture-inspection.js";
import type { RunWorkspace } from "../ports/index.js";
import { buildAgentPrompt } from "./build-agent-prompt.js";
import { executeAgentRun } from "./execute-agent-run.js";
import { validateAgentOutput } from "./validate-agent-output.js";
import { writeAgentLifecycleStatus } from "./write-agent-lifecycle-status.js";

export type RuntimeSpecialistAgentId =
  | "scout"
  | "architecture"
  | "pattern_miner"
  | "flow_tracer"
  | "testing_strategy"
  | "tradeoff_analyst";

export type AgentWorkflowStepResult = Awaited<
  ReturnType<typeof validateAgentOutput>
> & { lifecycle: AgentLifecycle };

export async function runAgentWorkflowStep(input: {
  input: RunScoutArchitectureInspectionInput;
  workspace: RunWorkspace;
  agentId: RuntimeSpecialistAgentId;
  progressName: string;
  repoIndexSummary: unknown;
  memorySnapshot: string;
  previousOutputs: unknown;
  attempt?: number;
  revisionRequest?: unknown;
  qualityCommandReport?: QualityCommandReport;
}): Promise<AgentWorkflowStepResult> {
  const agent = getAgentContract(input.agentId);
  const attempt = input.attempt ?? 1;
  let lifecycle = createAgentLifecycle({
    agentId: input.agentId,
    timestamp: input.input.clock.now().toISOString(),
  });
  lifecycle = { ...lifecycle, attempts: attempt - 1 };

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

  input.input.progress?.(`Agent started: ${input.progressName} (attempt ${attempt})`);
  lifecycle = await transitionAndWriteLifecycle({
    input: input.input,
    workspace: input.workspace,
    lifecycle,
    to: "RUNNING",
  });

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
  lifecycle = await transitionAndWriteLifecycle({
    input: input.input,
    workspace: input.workspace,
    lifecycle,
    to: "OUTPUT_RECEIVED",
  });
  input.input.progress?.(`Agent finished: ${input.progressName} (attempt ${attempt})`);

  input.input.progress?.(`Validating ${input.progressName} schema`);
  const validation = await validateAgentOutput({
    workspace: input.workspace,
    agent,
    attempt,
    rawOutput: run.stdout,
    validators: input.input.validators,
    reports: input.input.validationReports,
    ...(input.qualityCommandReport === undefined
      ? {}
      : { qualityCommandReport: input.qualityCommandReport }),
  });

  if (validation.valid) {
    lifecycle = await transitionAndWriteLifecycle({
      input: input.input,
      workspace: input.workspace,
      lifecycle,
      to: "SCHEMA_VALIDATED",
    });
  } else {
    lifecycle = await transitionAndWriteLifecycle({
      input: input.input,
      workspace: input.workspace,
      lifecycle,
      to: "SCHEMA_FAILED",
      reason: validation.errors[0]?.message,
    });
    lifecycle = await transitionAndWriteLifecycle({
      input: input.input,
      workspace: input.workspace,
      lifecycle,
      to: "FAILED",
      reason: validation.errors[0]?.message,
    });
  }

  return { ...validation, lifecycle };
}

export async function writeEvidenceLifecycleStatus(input: {
  input: RunScoutArchitectureInspectionInput;
  workspace: RunWorkspace;
  lifecycle: AgentLifecycle;
  valid: boolean;
  reason?: string;
}): Promise<AgentLifecycle> {
  if (input.valid) {
    return transitionAndWriteLifecycle({
      input: input.input,
      workspace: input.workspace,
      lifecycle: input.lifecycle,
      to: "EVIDENCE_VALIDATED",
    });
  }

  const failedEvidence = await transitionAndWriteLifecycle({
    input: input.input,
    workspace: input.workspace,
    lifecycle: input.lifecycle,
    to: "EVIDENCE_FAILED",
    reason: input.reason,
  });
  return transitionAndWriteLifecycle({
    input: input.input,
    workspace: input.workspace,
    lifecycle: failedEvidence,
    to: "FAILED",
    reason: input.reason,
  });
}

async function transitionAndWriteLifecycle(input: {
  input: RunScoutArchitectureInspectionInput;
  workspace: RunWorkspace;
  lifecycle: AgentLifecycle;
  to: AgentLifecycleStatus;
  reason?: string;
}): Promise<AgentLifecycle> {
  const lifecycle = transitionAgentLifecycle(input.lifecycle, {
    to: input.to,
    timestamp: input.input.clock.now().toISOString(),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  });
  await writeAgentLifecycleStatus({
    workspace: input.workspace,
    lifecycle,
    artifacts: input.input.statusArtifacts,
  });
  return lifecycle;
}
