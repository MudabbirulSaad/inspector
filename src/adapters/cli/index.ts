import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  InspectionRunFailedError,
  runScoutArchitectureInspection,
} from "../../application/index.js";
import type { RunConfig } from "../../domain/types.js";
import type {
  AgentRunner,
  Clock,
  RunWorkspace,
} from "../../ports/index.js";
import { createSchemaContractValidators } from "../../validation/index.js";
import { createDefaultScoutArchitectureFakeRunner } from "../codex/index.js";
import {
  NodeAgentOutputArtifactWriter,
  NodeAgentOutputSchemaReader,
  NodeEvidenceValidationReportWriter,
  NodeQaArtifactWriter,
  NodePromptArtifactWriter,
  NodePromptTemplateReader,
  NodeRepositoryIndexPromptContextReader,
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

const promptRoot = fileURLToPath(new URL("../../../prompts/", import.meta.url));
const schemaRoot = fileURLToPath(new URL("../../../schemas/", import.meta.url));

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
    const repositoryReader = new NodeRepositoryReader(repoRoot);
    const repositoryEntries = await repositoryReader.listEntries();
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

    const result = await runScoutArchitectureInspection({
      config,
      objective,
      clock: request.clock ?? systemClock,
      runner:
        request.runner ??
        (await createDefaultScoutArchitectureFakeRunner(
          repositoryReader,
          repositoryEntries,
        )),
      workspaces: new NodeRunWorkspaceStore(),
      repositoryReader,
      repositoryIndexWriter: new NodeRepositoryIndexWriter(),
      repositoryIndexContext: new NodeRepositoryIndexPromptContextReader(),
      memory: (workspace) => new NodeSwarmMemoryStore(workspace),
      promptTemplates: new NodePromptTemplateReader(promptRoot),
      promptArtifacts: new NodePromptArtifactWriter(),
      outputArtifacts: new NodeAgentOutputArtifactWriter(),
      validationReports: new NodeValidationReportWriter(),
      evidenceReports: new NodeEvidenceValidationReportWriter(),
      qaArtifacts: new NodeQaArtifactWriter(),
      validators: await createSchemaContractValidators(),
      schemaReader: new NodeAgentOutputSchemaReader(schemaRoot),
      progress: (message) => printProgress(stdout, command.verbose, message),
      stream: (agentId, kind, message) => {
        if (command.verbose) {
          stdout(`[${agentId}:${kind}] ${message}`);
        }
      },
    });

    stdout(`Inspection run workspace: ${result.workspace.root}`);
    return { exitCode: 0, workspace: result.workspace };
  } catch (error) {
    stderr(error instanceof Error ? error.message : "Unknown CLI error");
    return {
      exitCode: 1,
      workspace:
        error instanceof InspectionRunFailedError ? error.workspace : undefined,
    };
  }
}

function parseRunCommand(argv: string[]): ParsedRunCommand {
  if (argv[0] !== "run") {
    throw new Error(
      "Usage: inspector run <repo-path> --objective <objective-file> --out <output-path> [--verbose]",
    );
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
