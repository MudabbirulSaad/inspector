import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { getAgentContract } from "../../agents/index.js";
import {
  appendSwarmFinding,
  appendSwarmBlackboardSnapshot,
  buildAgentPrompt,
  createInspectionRunWorkspace,
  executeAgentRun,
  indexTargetRepository,
  validateAgentOutput,
  validateEvidenceReferences,
} from "../../application/index.js";
import type {
  ArchitectureOutput,
  Evidence,
  Finding,
  RunConfig,
  ScoutOutput,
} from "../../domain/types.js";
import type {
  AgentRunResult,
  AgentRunner,
  Clock,
  RepositoryEntry,
  RunWorkspace,
} from "../../ports/index.js";
import { createSchemaContractValidators } from "../../validation/index.js";
import { FakeAgentRunner } from "../codex/index.js";
import {
  NodeRepositoryIndexWriter,
  NodeRepositoryReader,
  NodePromptArtifactWriter,
  NodePromptTemplateReader,
  NodeRunWorkspaceStore,
  NodeSwarmMemoryStore,
  NodeValidationReportWriter,
} from "../filesystem/index.js";

export const cliAdapterBoundary = "adapters.cli" as const;

export interface InspectorCliRequest {
  argv: string[];
  clock?: Clock;
  runner?: AgentRunner;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

export interface InspectorCliResult {
  exitCode: number;
  workspace?: RunWorkspace;
}

interface ParsedRunCommand {
  repoPath: string;
  objectivePath: string;
  outPath: string;
  verbose: boolean;
}

const systemClock: Clock = {
  now: () => new Date(),
};

export async function runInspectorCli(
  request: InspectorCliRequest,
): Promise<InspectorCliResult> {
  const stdout = request.stdout ?? console.log;
  const stderr = request.stderr ?? console.error;

  try {
    const command = parseRunCommand(request.argv);
    await assertDirectory(command.repoPath, "Repository path");
    await assertFile(command.objectivePath, "Objective file");

    const objective = await readFile(command.objectivePath, "utf8");
    const repoRoot = resolve(command.repoPath);
    const config: RunConfig = {
      target: {
        name: basename(repoRoot),
        root: repoRoot,
      },
      outputDirectory: resolve(command.outPath),
      agentRoles: ["documentation"],
      validationCommands: [],
      verbose: command.verbose,
    };

    printProgress(stdout, command.verbose, "Creating run workspace");
    const workspace = await createInspectionRunWorkspace({
      config,
      clock: request.clock ?? systemClock,
      workspaces: new NodeRunWorkspaceStore(),
    });

    const repositoryReader = new NodeRepositoryReader(repoRoot);
    const repositoryEntries = await repositoryReader.listEntries();
    const repositoryFiles = await repositoryFilesWithLineCounts(
      repositoryReader,
      repositoryEntries,
    );

    printProgress(stdout, command.verbose, "Indexing repository");
    await indexTargetRepository({
      target: config.target,
      reader: repositoryReader,
      writer: new NodeRepositoryIndexWriter(),
      workspace,
    });

    printProgress(stdout, command.verbose, "Initializing memory");
    await appendSwarmBlackboardSnapshot({
      title: "Run initialized",
      body: `Objective: ${objective.trim()}`,
      memory: new NodeSwarmMemoryStore(workspace),
    });

    const validators = await createSchemaContractValidators();
    const scoutPrompt = await buildAgentPrompt({
      agentId: "scout",
      attempt: 1,
      workspace,
      templates: new NodePromptTemplateReader("prompts"),
      artifacts: new NodePromptArtifactWriter(),
      objective,
      targetRepoContext: config.target,
      repoIndexSummary: await readRepositoryIndexPromptContext(workspace),
      previousOutputs: [],
      memorySnapshot: await readFile(
        join(workspace.folders.memory, "blackboard.md"),
        "utf8",
      ),
      outputSchema: JSON.parse(
        await readFile("schemas/scout-output.schema.json", "utf8"),
      ) as unknown,
    });

    printProgress(stdout, command.verbose, "Running Scout");
    const runner = request.runner ?? createDefaultRunner(repositoryFiles);
    const scoutRun = await executeAgentRun({
      runner,
      agentId: "scout",
      attempt: 1,
      prompt: scoutPrompt.prompt,
      workspaceRoot: workspace.root,
      onStreamingEvent: (event) => {
        if (command.verbose) {
          stdout(`[scout:${event.kind}] ${event.message}`);
        }
      },
    });
    await writeScoutOutput(workspace, scoutRun.stdout);

    printProgress(stdout, command.verbose, "Validating Scout schema");
    const schemaResult = await validateAgentOutput({
      workspace,
      agent: getAgentContract("scout"),
      attempt: 1,
      rawOutput: scoutRun.stdout,
      validators,
      reports: new NodeValidationReportWriter(),
    });

    if (!schemaResult.valid) {
      stderr(`Scout schema validation failed: ${schemaResult.errors[0]?.message}`);
      return { exitCode: 1, workspace };
    }

    const scoutOutput = schemaResult.value as ScoutOutput;

    printProgress(stdout, command.verbose, "Validating Scout evidence");
    const evidenceResult = await validateEvidenceReferences({
      repositoryFiles,
      findings: scoutEvidenceFindings(scoutOutput),
    });

    await writeEvidenceValidationReport(workspace, evidenceResult);

    if (!evidenceResult.valid) {
      stderr(`Scout evidence validation failed: ${evidenceResult.errors[0]?.message}`);
      return { exitCode: 1, workspace };
    }

    const memory = new NodeSwarmMemoryStore(workspace);
    for (const finding of scoutOutput.findings) {
      await appendSwarmFinding({
        finding,
        memory,
        validator: validators.finding,
      });
    }

    const architecturePrompt = await buildAgentPrompt({
      agentId: "architecture",
      attempt: 1,
      workspace,
      templates: new NodePromptTemplateReader("prompts"),
      artifacts: new NodePromptArtifactWriter(),
      objective,
      targetRepoContext: config.target,
      repoIndexSummary: await readRepositoryIndexPromptContext(workspace),
      previousOutputs: { scout: scoutOutput },
      memorySnapshot: await readFile(
        join(workspace.folders.memory, "blackboard.md"),
        "utf8",
      ),
      outputSchema: JSON.parse(
        await readFile("schemas/architecture-output.schema.json", "utf8"),
      ) as unknown,
    });

    printProgress(stdout, command.verbose, "Running Architecture");
    const architectureRun = await executeAgentRun({
      runner,
      agentId: "architecture",
      attempt: 1,
      prompt: architecturePrompt.prompt,
      workspaceRoot: workspace.root,
      onStreamingEvent: (event) => {
        if (command.verbose) {
          stdout(`[architecture:${event.kind}] ${event.message}`);
        }
      },
    });
    await writeAgentOutput(workspace, "architecture", architectureRun.stdout);

    printProgress(stdout, command.verbose, "Validating Architecture schema");
    const architectureSchemaResult = await validateAgentOutput({
      workspace,
      agent: getAgentContract("architecture"),
      attempt: 1,
      rawOutput: architectureRun.stdout,
      validators,
      reports: new NodeValidationReportWriter(),
    });

    if (!architectureSchemaResult.valid) {
      stderr(
        `Architecture schema validation failed: ${architectureSchemaResult.errors[0]?.message}`,
      );
      return { exitCode: 1, workspace };
    }

    const architectureOutput =
      architectureSchemaResult.value as ArchitectureOutput;

    printProgress(stdout, command.verbose, "Validating Architecture evidence");
    const architectureEvidenceResult = await validateEvidenceReferences({
      repositoryFiles,
      findings: architectureEvidenceFindings(architectureOutput),
    });

    await writeEvidenceValidationReport(
      workspace,
      "architecture",
      architectureEvidenceResult,
    );

    if (!architectureEvidenceResult.valid) {
      stderr(
        `Architecture evidence validation failed: ${architectureEvidenceResult.errors[0]?.message}`,
      );
      return { exitCode: 1, workspace };
    }

    for (const finding of architectureOutput.findings) {
      await appendSwarmFinding({
        finding,
        memory,
        validator: validators.finding,
      });
    }

    stdout(`Inspection run workspace: ${workspace.root}`);
    return { exitCode: 0, workspace };
  } catch (error) {
    stderr(error instanceof Error ? error.message : "Unknown CLI error");
    return { exitCode: 1 };
  }
}

function parseRunCommand(argv: string[]): ParsedRunCommand {
  if (argv[0] !== "run") {
    throw new Error("Usage: inspector run <repo-path> --objective <objective-file> --out <output-path> [--verbose]");
  }

  const repoPath = argv[1];
  if (repoPath === undefined || repoPath.startsWith("--")) {
    throw new Error("Missing repository path");
  }

  const objectivePath = readOption(argv, "--objective");
  const outPath = readOption(argv, "--out");

  return {
    repoPath,
    objectivePath,
    outPath,
    verbose: argv.includes("--verbose"),
  };
}

function readOption(argv: string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];

  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }

  return value;
}

async function assertDirectory(path: string, label: string): Promise<void> {
  try {
    const metadata = await stat(path);
    if (!metadata.isDirectory()) {
      throw new Error(`${label} is not a directory: ${path}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(label)) {
      throw error;
    }

    throw new Error(`${label} does not exist: ${path}`, { cause: error });
  }
}

async function assertFile(path: string, label: string): Promise<void> {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) {
      throw new Error(`${label} is not a file: ${path}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(label)) {
      throw error;
    }

    throw new Error(`${label} does not exist: ${path}`, { cause: error });
  }
}

function printProgress(
  stdout: (line: string) => void,
  verbose: boolean,
  message: string,
): void {
  if (verbose) {
    stdout(message);
  }
}

function createDefaultRunner(
  repositoryFiles: { path: string; lineCount: number }[],
): AgentRunner {
  const citedFile =
    repositoryFiles.find((file) => file.lineCount > 0) ??
    repositoryFiles[0] ??
    { path: "README.md", lineCount: 1 };
  const lineEnd = Math.max(1, Math.min(citedFile.lineCount, 1));
  const scoutResult: AgentRunResult = {
    stdout: `${JSON.stringify({
      projectType: {
        value: "repository requiring inspection",
        evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
      },
      detectedStack: [],
      importantFiles: [
        {
          path: citedFile.path,
          reason: "Initial file available for Scout review.",
          evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
        },
      ],
      entryPoints: [
        {
          path: citedFile.path,
          kind: "initial inspection file",
          evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
        },
      ],
      architectureImpression: {
        summary: "Scout has only enough evidence for a shallow initial repository impression.",
        evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
      },
      openQuestions: ["Which source entrypoint should deeper agents inspect first?"],
      findings: [
        {
          id: "finding-scout-001",
          agent: "scout",
          severity: "info",
          claim: "The inspected repository has an initial file for Scout review.",
          evidence: [
            {
              file: citedFile.path,
              lineStart: 1,
              lineEnd,
            },
          ],
          recommendation: "Use this repository inventory as the starting point for deeper inspection.",
          confidence: 0.5,
          validation: ["schema-valid", "evidence-valid"],
        },
      ],
    })}\n`,
    stderr: "",
    exitCode: 0,
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(0).toISOString(),
    outputArtifactPaths: [],
    streamingEvents: [],
  };

  const architectureResult: AgentRunResult = {
    stdout: `${JSON.stringify({
      layerMap: [
        {
          name: "Initial repository context",
          observedFacts: [
            `${citedFile.path} is available for architecture inspection.`,
          ],
          interpretation:
            "The default runner can only provide a shallow architecture map.",
          evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
        },
      ],
      dependencyDirection: [
        {
          name: "Inspection input direction",
          source: citedFile.path,
          target: "architecture agent",
          direction: "repository evidence is consumed by the architecture agent",
          observedFacts: [
            `${citedFile.path} is cited as the available repository evidence.`,
          ],
          interpretation:
            "No source-code dependency direction is proven by the default runner.",
          evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
        },
      ],
      moduleBoundaries: [
        {
          name: "Initial file boundary",
          observedFacts: [`${citedFile.path} exists in the repository index.`],
          interpretation:
            "Runtime module boundaries require a real architecture agent result.",
          evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
        },
      ],
      businessLogicLocations: [
        {
          name: "Business logic not located",
          observedFacts: [
            "The default runner has not inspected source-level business rules.",
          ],
          interpretation:
            "Business logic location is unknown until a real agent inspects the repository.",
          evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
        },
      ],
      frameworkGlueLocations: [
        {
          name: "Framework glue not located",
          observedFacts: [
            "The default runner has not inspected framework bootstrapping code.",
          ],
          interpretation:
            "Framework glue location is unknown until a real agent inspects the repository.",
          evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
        },
      ],
      architectureRisks: [
        {
          name: "Architecture evidence is shallow",
          observedFacts: [
            "The default Architecture result is derived from a single cited file.",
          ],
          interpretation:
            "Candidate findings from the default runner should remain low confidence.",
          evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
        },
      ],
      findings: [
        {
          id: "finding-architecture-001",
          agent: "architecture",
          severity: "info",
          claim:
            "The default Architecture result has only shallow repository evidence.",
          evidence: [
            {
              file: citedFile.path,
              lineStart: 1,
              lineEnd,
            },
          ],
          recommendation:
            "Configure a real agent runner before relying on architecture findings.",
          confidence: 0.4,
          validation: ["schema-valid", "evidence-valid"],
        },
      ],
    })}\n`,
    stderr: "",
    exitCode: 0,
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(0).toISOString(),
    outputArtifactPaths: [],
    streamingEvents: [],
  };

  return new FakeAgentRunner({ results: [scoutResult, architectureResult] });
}

async function readRepositoryIndexPromptContext(
  workspace: RunWorkspace,
): Promise<Record<string, unknown>> {
  return {
    repo_summary: JSON.parse(
      await readFile(join(workspace.folders.repoIndex, "repo_summary.json"), "utf8"),
    ) as unknown,
    important_files: JSON.parse(
      await readFile(
        join(workspace.folders.repoIndex, "important_files.json"),
        "utf8",
      ),
    ) as unknown,
    detected_stack: JSON.parse(
      await readFile(
        join(workspace.folders.repoIndex, "detected_stack.json"),
        "utf8",
      ),
    ) as unknown,
    detected_commands: JSON.parse(
      await readFile(
        join(workspace.folders.repoIndex, "detected_commands.json"),
        "utf8",
      ),
    ) as unknown,
    file_tree: await readFile(
      join(workspace.folders.repoIndex, "file_tree.txt"),
      "utf8",
    ),
  };
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

async function writeScoutOutput(
  workspace: RunWorkspace,
  content: string,
): Promise<void> {
  await writeAgentOutput(workspace, "scout", content);
}

async function writeAgentOutput(
  workspace: RunWorkspace,
  agentId: string,
  content: string,
): Promise<void> {
  const directory = join(workspace.folders.agents, agentId, "attempt-1");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "output.json"), content);
}

async function writeEvidenceValidationReport(
  workspace: RunWorkspace,
  agentIdOrResult: string | unknown,
  maybeResult?: unknown,
): Promise<void> {
  const agentId = typeof agentIdOrResult === "string" ? agentIdOrResult : "scout";
  const result = typeof agentIdOrResult === "string" ? maybeResult : agentIdOrResult;
  const directory = join(workspace.folders.validation, agentId, "attempt-1");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "evidence.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
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

async function repositoryFilesWithLineCounts(
  reader: NodeRepositoryReader,
  entries: RepositoryEntry[],
): Promise<{ path: string; lineCount: number }[]> {
  return Promise.all(
    entries
      .filter((entry) => entry.kind === "file")
      .map(async (entry) => ({
        path: entry.path,
        lineCount: countLines(await reader.readTextFile(entry.path)),
      })),
  );
}

function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  return content.endsWith("\n")
    ? content.split("\n").length - 1
    : content.split("\n").length;
}
