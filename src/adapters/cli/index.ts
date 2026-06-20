import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { getAgentContract } from "../../agents/index.js";
import {
  appendSwarmBlackboardSnapshot,
  createInspectionRunWorkspace,
  executeAgentRun,
  indexTargetRepository,
  validateAgentOutput,
  validateEvidenceReferences,
} from "../../application/index.js";
import type { Finding, RunConfig } from "../../domain/types.js";
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

    printProgress(stdout, command.verbose, "Running Scout");
    const runner = request.runner ?? createDefaultScoutRunner(repositoryFiles);
    const scoutRun = await executeAgentRun({
      runner,
      agentId: "scout",
      attempt: 1,
      prompt: objective,
      workspaceRoot: workspace.root,
      onStreamingEvent: (event) => {
        if (command.verbose) {
          stdout(`[scout:${event.kind}] ${event.message}`);
        }
      },
    });
    await writeScoutOutput(workspace, scoutRun.stdout);

    printProgress(stdout, command.verbose, "Validating Scout schema");
    const validators = await createSchemaContractValidators();
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

    printProgress(stdout, command.verbose, "Validating Scout evidence");
    const evidenceResult = await validateEvidenceReferences({
      repositoryFiles,
      findings: [schemaResult.value as Finding],
    });

    await writeEvidenceValidationReport(workspace, evidenceResult);

    if (!evidenceResult.valid) {
      stderr(`Scout evidence validation failed: ${evidenceResult.errors[0]?.message}`);
      return { exitCode: 1, workspace };
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

function createDefaultScoutRunner(
  repositoryFiles: { path: string; lineCount: number }[],
): AgentRunner {
  const citedFile =
    repositoryFiles.find((file) => file.lineCount > 0) ??
    repositoryFiles[0] ??
    { path: "README.md", lineCount: 1 };
  const lineEnd = Math.max(1, Math.min(citedFile.lineCount, 1));
  const result: AgentRunResult = {
    stdout: `${JSON.stringify({
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
    })}\n`,
    stderr: "",
    exitCode: 0,
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(0).toISOString(),
    outputArtifactPaths: [],
    streamingEvents: [],
  };

  return new FakeAgentRunner({ results: [result] });
}

async function writeScoutOutput(
  workspace: RunWorkspace,
  content: string,
): Promise<void> {
  const directory = join(workspace.folders.agents, "scout", "attempt-1");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "output.json"), content);
}

async function writeEvidenceValidationReport(
  workspace: RunWorkspace,
  result: unknown,
): Promise<void> {
  const directory = join(workspace.folders.validation, "scout", "attempt-1");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "evidence.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
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
