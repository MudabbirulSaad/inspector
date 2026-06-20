import type { AgentContractId } from "../agents/index.js";
import type {
  PromptArtifactWriter,
  PromptTemplateReader,
  RunWorkspace,
} from "../ports/index.js";

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
