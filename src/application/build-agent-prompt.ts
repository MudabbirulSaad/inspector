import type { AgentContractId } from "../agents/index.js";
import type {
  PromptArtifactWriter,
  PromptTemplateReader,
  RunWorkspace,
} from "../ports/index.js";
import type { QualityCommandReport } from "./run-quality-commands.js";

const sharedPromptTemplatePaths = [
  "shared/senior-engineer-rules.md",
  "shared/evidence-rules.md",
  "shared/output-contract-rules.md",
  "shared/revision-rules.md",
] as const;

export interface BuildAgentPromptRequest {
  agentId: AgentContractId;
  attempt: number;
  workspace: RunWorkspace;
  templates: PromptTemplateReader;
  artifacts: PromptArtifactWriter;
  objective: string;
  targetRepoContext: unknown;
  repoIndexSummary: unknown;
  previousOutputs: unknown;
  memorySnapshot: unknown;
  outputSchema: unknown;
  revisionRequest?: unknown;
  qualityCommandReport?: QualityCommandReport;
}

export interface BuiltAgentPrompt {
  prompt: string;
  artifactPath: string;
}

export async function buildAgentPrompt(
  request: BuildAgentPromptRequest,
): Promise<BuiltAgentPrompt> {
  const sharedTemplates = await Promise.all(
    sharedPromptTemplatePaths.map(async (path) => ({
      path,
      content: await request.templates.readTemplate(path),
    })),
  );
  const agentTemplatePath = `agents/${agentTemplateName(request.agentId)}.md`;
  const agentTemplate = await request.templates.readTemplate(agentTemplatePath);

  const values = {
    objective: request.objective,
    targetRepoContext: formatPromptValue(request.targetRepoContext),
    repoIndexSummary: formatPromptValue(request.repoIndexSummary),
    previousOutputs: formatPromptValue(request.previousOutputs),
    memorySnapshot: formatPromptValue(request.memorySnapshot),
    outputSchema: formatPromptValue(request.outputSchema),
    revisionRequest: formatPromptValue(request.revisionRequest ?? "None."),
    trustedQualityCommandReport: renderTrustedQualityCommandReport(
      request.qualityCommandReport,
    ),
  };

  const prompt = [
    `# Agent Prompt: ${request.agentId}`,
    "",
    `## Agent Template`,
    interpolateTemplate(agentTemplate, values),
    "",
    "## Shared Rules",
    ...sharedTemplates.flatMap((template) => [
      `### ${template.path}`,
      interpolateTemplate(template.content, values),
      "",
    ]),
    "## Objective",
    request.objective,
    "",
    "## Target Repository Context",
    values.targetRepoContext,
    "",
    "## Repository Index Summary",
    values.repoIndexSummary,
    "",
    "## Previous Outputs",
    values.previousOutputs,
    "",
    ...(request.qualityCommandReport === undefined
      ? []
      : ["## Trusted Quality Command Report", values.trustedQualityCommandReport, ""]),
    "## Memory Snapshot",
    values.memorySnapshot,
    "",
    "## Output Schema",
    values.outputSchema,
    "",
    "## Revision Request",
    values.revisionRequest,
    "",
  ].join("\n");

  const artifact = await request.artifacts.writeAgentPrompt({
    workspace: request.workspace,
    agentId: request.agentId,
    attempt: request.attempt,
    content: prompt,
  });

  return { prompt, artifactPath: artifact.path };
}

function agentTemplateName(agentId: AgentContractId): string {
  return agentId.replaceAll("_", "-");
}

function interpolateTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) =>
    values[key] ?? match,
  );
}

function formatPromptValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, undefined, 2);
}

function renderTrustedQualityCommandReport(
  report: QualityCommandReport | undefined,
): string {
  if (report === undefined) {
    return "No quality command report was provided.";
  }

  const commandLines =
    report.commands.length === 0
      ? ["- No commands appear in the command report."]
      : report.commands.map((command) =>
          [
            `- ${qualityCommandText(command)}`,
            `status=${command.status}`,
            `exitCode=${command.exitCode === null ? "null" : command.exitCode}`,
            `durationMs=${command.durationMs}`,
          ].join(" "),
        );

  return [
    "This report is authoritative. You may only claim a command passed or failed if it appears here with that status.",
    "Do not invent or aggregate commands.",
    "Do not claim npm run validate passed unless npm run validate appears in the command report.",
    "If command execution was skipped, mark commands as not-run.",
    report.skipped === true
      ? `Command execution was skipped: ${report.reason ?? "no reason provided"}`
      : "Command execution was not marked skipped.",
    "",
    "Commands:",
    ...commandLines,
    "",
    "Raw report:",
    formatPromptValue(report),
  ].join("\n");
}

function qualityCommandText(
  command: QualityCommandReport["commands"][number],
): string {
  return [command.command, ...command.args].join(" ");
}
