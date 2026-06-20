import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import {
  InspectionRunFailedError,
  runScoutArchitectureInspection,
} from "../../application/index.js";
import type { RunConfig } from "../../domain/types.js";
import type {
  AgentOutputArtifactWriter,
  AgentOutputSchemaReader,
  AgentRunResult,
  AgentRunner,
  Clock,
  EvidenceValidationReportWriter,
  RepositoryEntry,
  RepositoryIndexPromptContextReader,
  RepositoryReader,
  RunWorkspace,
} from "../../ports/index.js";
import { createSchemaContractValidators } from "../../validation/index.js";
import { FakeAgentRunner } from "../codex/index.js";
import {
  NodePromptArtifactWriter,
  NodePromptTemplateReader,
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
        (await createDefaultRunner(repositoryReader, repositoryEntries)),
      workspaces: new NodeRunWorkspaceStore(),
      repositoryReader,
      repositoryIndexWriter: new NodeRepositoryIndexWriter(),
      repositoryIndexContext: new NodeRepositoryIndexPromptContextReader(),
      memory: (workspace) => new NodeSwarmMemoryStore(workspace),
      promptTemplates: new NodePromptTemplateReader("prompts"),
      promptArtifacts: new NodePromptArtifactWriter(),
      outputArtifacts: new NodeAgentOutputArtifactWriter(),
      validationReports: new NodeValidationReportWriter(),
      evidenceReports: new NodeEvidenceValidationReportWriter(),
      validators: await createSchemaContractValidators(),
      schemaReader: new NodeAgentOutputSchemaReader(),
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

async function createDefaultRunner(
  reader: RepositoryReader,
  entries: RepositoryEntry[],
): Promise<AgentRunner> {
  const citedFile = await chooseDefaultEvidenceFile(reader, entries);
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
        summary:
          "Scout has only enough evidence for a shallow initial repository impression.",
        evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
      },
      openQuestions: [
        "Which source entrypoint should deeper agents inspect first?",
      ],
      findings: [
        {
          id: "finding-scout-001",
          agent: "scout",
          severity: "info",
          claim:
            "The inspected repository has an initial file for Scout review.",
          evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
          recommendation:
            "Use this repository inventory as the starting point for deeper inspection.",
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
          direction:
            "repository evidence is consumed by the architecture agent",
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
          evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
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

async function chooseDefaultEvidenceFile(
  reader: RepositoryReader,
  entries: RepositoryEntry[],
): Promise<{ path: string; lineCount: number }> {
  const candidate =
    entries.find(
      (entry) =>
        entry.kind === "file" &&
        !isIgnoredRepositoryEntry(entry.path) &&
        (entry.sizeBytes ?? 0) <= 1_000_000,
    ) ?? entries.find((entry) => entry.kind === "file");

  if (candidate === undefined) {
    return { path: "README.md", lineCount: 1 };
  }

  try {
    return {
      path: candidate.path,
      lineCount: countLines(await reader.readTextFile(candidate.path)),
    };
  } catch {
    return { path: candidate.path, lineCount: 1 };
  }
}

class NodeAgentOutputArtifactWriter implements AgentOutputArtifactWriter {
  async writeAgentOutput(request: {
    workspace: RunWorkspace;
    agentId: string;
    attempt: number;
    content: string;
  }): Promise<{ path: string }> {
    const directory = join(
      request.workspace.folders.agents,
      request.agentId,
      `attempt-${request.attempt}`,
    );
    const path = join(directory, "output.json");

    await mkdir(directory, { recursive: true });
    await writeFile(path, request.content);

    return { path };
  }
}

class NodeEvidenceValidationReportWriter
  implements EvidenceValidationReportWriter
{
  async writeEvidenceValidationReport(request: {
    workspace: RunWorkspace;
    agentId: string;
    attempt: number;
    content: string;
  }): Promise<{ path: string }> {
    const directory = join(
      request.workspace.folders.validation,
      request.agentId,
      `attempt-${request.attempt}`,
    );
    const path = join(directory, "evidence.json");

    await mkdir(directory, { recursive: true });
    await writeFile(path, request.content);

    return { path };
  }
}

class NodeAgentOutputSchemaReader implements AgentOutputSchemaReader {
  async readAgentOutputSchema(contract: string): Promise<unknown> {
    return JSON.parse(
      await readFile(`schemas/${contract}.schema.json`, "utf8"),
    ) as unknown;
  }
}

class NodeRepositoryIndexPromptContextReader
  implements RepositoryIndexPromptContextReader
{
  async readRepositoryIndexPromptContext(
    workspace: RunWorkspace,
  ): Promise<unknown> {
    return {
      repo_summary: JSON.parse(
        await readFile(
          join(workspace.folders.repoIndex, "repo_summary.json"),
          "utf8",
        ),
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
}

function isIgnoredRepositoryEntry(path: string): boolean {
  return path
    .split("/")
    .some((segment) =>
      new Set([
        ".cache",
        ".git",
        ".next",
        "build",
        "coverage",
        "dist",
        "node_modules",
        "vendor",
      ]).has(segment),
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
