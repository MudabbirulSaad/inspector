import { readFile, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
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
import {
  createDefaultScoutArchitectureFakeRunner,
  ProcessCodexAgentRunner,
} from "../codex/index.js";
import {
  NodeAgentOutputArtifactWriter,
  NodeAgentOutputSchemaReader,
  NodeCaseStudyDocumentWriter,
  NodeEvidenceValidationReportWriter,
  NodeQaArtifactWriter,
  NodePromptArtifactWriter,
  NodePromptTemplateReader,
  NodeQualityCommandReportWriter,
  NodeRagKnowledgeCardWriter,
  NodeRepositoryIndexPromptContextReader,
  NodeRepositoryIndexWriter,
  NodeRepositoryReader,
  NodeRunWorkspaceStore,
  NodeSwarmMemoryStore,
  NodeValidationReportWriter,
} from "../filesystem/index.js";
import { NodeProcessRunner } from "../process/index.js";

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
  objective: string;
  outPath: string;
  verbose: boolean;
  debug: boolean;
  targetContext?: string;
  agents?: string[];
  parallelism?: number;
  maxRetries?: number;
  runner?: InspectionConfigRunner;
}

interface InspectionConfigRunner {
  provider: string;
  command?: string;
  args?: string[];
  timeoutMs?: number;
  env?: Record<string, string>;
}

interface InspectionConfigFile {
  repoPath?: string;
  outputPath?: string;
  objective?: string;
  targetContext?: string;
  agents?: string[];
  parallelism?: number;
  maxRetries?: number;
  verbose?: boolean;
  runner?: InspectionConfigRunner;
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

  let debug = request.argv.includes("--debug");
  try {
    const command = await parseRunCommand(request.argv);
    debug = command.debug;
    await assertDirectory(command.repoPath, "Repository path");

    const objective = appendTargetContext(command.objective, command.targetContext);
    const repoRoot = resolve(command.repoPath);
    const repositoryReader = new NodeRepositoryReader(repoRoot);
    const repositoryEntries = await repositoryReader.listEntries();
    const processRunner = new NodeProcessRunner();
    const config: RunConfig = {
      target: {
        name: basename(repoRoot),
        root: repoRoot,
      },
      outputDirectory: resolve(command.outPath),
      agentRoles: ["documentation"],
      validationCommands: [],
      verbose: command.verbose,
      ...(command.targetContext === undefined
        ? {}
        : { targetContext: command.targetContext }),
      ...(command.agents === undefined ? {} : { agents: command.agents }),
      ...(command.parallelism === undefined
        ? {}
        : { parallelism: command.parallelism }),
      ...(command.maxRetries === undefined ? {} : { maxRetries: command.maxRetries }),
      ...(command.runner === undefined ? {} : { runner: command.runner }),
    };

    printProgress(stdout, command.verbose, `Inspection started: ${config.target.name}`);
    const result = await runScoutArchitectureInspection({
      config,
      objective,
      clock: request.clock ?? systemClock,
      runner:
        request.runner ??
        (await createRunnerFromConfig(command.runner, repositoryReader, repositoryEntries)),
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
      qualityCommandReports: new NodeQualityCommandReportWriter(),
      finalDocs: new NodeCaseStudyDocumentWriter(),
      ragCards: new NodeRagKnowledgeCardWriter(),
      processRunner,
      validators: await createSchemaContractValidators(),
      schemaReader: new NodeAgentOutputSchemaReader(schemaRoot),
      progress: (message) => printProgress(stdout, command.verbose, message),
      stream: (agentId, kind, message) => {
        if (command.verbose) {
          stdout(`[${agentId}:${kind}] ${message}`);
        }
      },
    });

    printProgress(
      stdout,
      command.verbose,
      `Final output: ${result.workspace.root}/final/docs`,
    );
    stdout(`Inspection run workspace: ${result.workspace.root}`);
    return { exitCode: 0, workspace: result.workspace };
  } catch (error) {
    printCliError(stderr, error, debug);
    return {
      exitCode: 1,
      workspace:
        error instanceof InspectionRunFailedError ? error.workspace : undefined,
    };
  }
}

async function parseRunCommand(argv: string[]): Promise<ParsedRunCommand> {
  if (argv[0] !== "run") {
    throw new Error(
      "Usage: inspector run <repo-path> --objective <objective-file> --out <output-path> [--verbose] [--debug]",
    );
  }

  const repoPath = argv[1];
  if (repoPath === undefined || repoPath.startsWith("--")) {
    throw new Error("Missing repository path");
  }

  if (isInspectionConfigPath(repoPath)) {
    return parseConfigRunCommand(argv, repoPath);
  }

  const objectivePath = readOption(argv, "--objective");
  const outPath = readOption(argv, "--out");
  await assertFile(objectivePath, "Objective file");

  return {
    repoPath,
    objective: await readFile(objectivePath, "utf8"),
    outPath,
    verbose: argv.includes("--verbose"),
    debug: argv.includes("--debug"),
  };
}

async function parseConfigRunCommand(
  argv: string[],
  configPath: string,
): Promise<ParsedRunCommand> {
  await assertFile(configPath, "Config file");
  const configRoot = dirname(resolve(configPath));
  const config = parseInspectionConfigFile(await readFile(configPath, "utf8"));
  const repoPath = readOptionOrUndefined(argv, "--repo") ?? config.repoPath;
  const outPath = readOptionOrUndefined(argv, "--out") ?? config.outputPath;
  const objectivePath = readOptionOrUndefined(argv, "--objective");
  const objective =
    objectivePath === undefined
      ? config.objective
      : await readConfigOverrideObjective(objectivePath);

  if (repoPath === undefined) {
    throw new Error("Invalid inspection config: missing repoPath");
  }
  if (outPath === undefined) {
    throw new Error("Invalid inspection config: missing outputPath");
  }
  if (objective === undefined || objective.trim().length === 0) {
    throw new Error("Invalid inspection config: missing objective");
  }

  return {
    repoPath: resolveConfigPath(configRoot, repoPath),
    objective,
    outPath: resolveConfigPath(configRoot, outPath),
    verbose: argv.includes("--verbose") || config.verbose === true,
    debug: argv.includes("--debug"),
    targetContext: config.targetContext,
    agents: config.agents,
    parallelism: config.parallelism,
    maxRetries: config.maxRetries,
    runner: config.runner,
  };
}

function readOption(argv: string[], name: string): string {
  const value = readOptionOrUndefined(argv, name);

  if (value === undefined) {
    throw new Error(`Missing value for ${name}`);
  }

  return value;
}

function readOptionOrUndefined(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];

  if (value === undefined || value.startsWith("--")) {
    return undefined;
  }

  return value;
}

function isInspectionConfigPath(path: string): boolean {
  return path.endsWith(".yaml") || path.endsWith(".yml");
}

async function readConfigOverrideObjective(path: string): Promise<string> {
  await assertFile(path, "Objective file");
  return readFile(path, "utf8");
}

function resolveConfigPath(root: string, path: string): string {
  return isAbsolute(path) ? path : resolve(root, path);
}

function parseInspectionConfigFile(content: string): InspectionConfigFile {
  const config: Record<string, unknown> = {};
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = stripYamlComment(lines[index] ?? "");
    if (line.trim().length === 0) {
      continue;
    }
    if (line.startsWith(" ")) {
      throw new Error(`Invalid inspection config: unexpected indentation on line ${index + 1}`);
    }

    const separator = line.indexOf(":");
    if (separator === -1) {
      throw new Error(`Invalid inspection config: expected key/value on line ${index + 1}`);
    }

    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (!isKnownConfigKey(key)) {
      throw new Error(`Invalid inspection config: unknown field '${key}'`);
    }

    if (rawValue.length > 0) {
      config[key] = parseYamlScalar(rawValue, key);
      continue;
    }

    const nestedLines: string[] = [];
    while (index + 1 < lines.length && (lines[index + 1] ?? "").startsWith(" ")) {
      index += 1;
      const nestedLine = stripYamlComment(lines[index] ?? "");
      if (nestedLine.trim().length > 0) {
        nestedLines.push(nestedLine);
      }
    }

    config[key] = parseYamlBlock(key, nestedLines);
  }

  return normalizeInspectionConfig(config);
}

function stripYamlComment(line: string): string {
  const commentIndex = line.indexOf(" #");
  return commentIndex === -1 ? line : line.slice(0, commentIndex);
}

function isKnownConfigKey(key: string): boolean {
  return [
    "repoPath",
    "outputPath",
    "objective",
    "targetContext",
    "agents",
    "parallelism",
    "maxRetries",
    "verbose",
    "runner",
  ].includes(key);
}

function parseYamlBlock(key: string, lines: string[]): unknown {
  if (lines.length === 0) {
    throw new Error(`Invalid inspection config: '${key}' must not be empty`);
  }

  if (lines.every((line) => line.trimStart().startsWith("- "))) {
    return lines.map((line) => parseYamlScalar(line.trimStart().slice(2), key));
  }

  const object: Record<string, unknown> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    const separator = trimmed.indexOf(":");
    if (separator === -1) {
      throw new Error(`Invalid inspection config: invalid '${key}' block`);
    }

    const nestedKey = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    object[nestedKey] = parseYamlScalar(rawValue, `${key}.${nestedKey}`);
  }
  return object;
}

function parseYamlScalar(value: string, key: string): string | number | boolean {
  const unquoted = stripYamlQuotes(value);
  if (unquoted === "true") {
    return true;
  }
  if (unquoted === "false") {
    return false;
  }
  if (/^\d+$/.test(unquoted)) {
    return Number(unquoted);
  }
  if (unquoted.length === 0) {
    throw new Error(`Invalid inspection config: '${key}' must not be empty`);
  }
  return unquoted;
}

function stripYamlQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function normalizeInspectionConfig(config: Record<string, unknown>): InspectionConfigFile {
  return {
    repoPath: optionalString(config.repoPath, "repoPath"),
    outputPath: optionalString(config.outputPath, "outputPath"),
    objective: optionalString(config.objective, "objective"),
    targetContext: optionalString(config.targetContext, "targetContext"),
    agents: optionalStringArray(config.agents, "agents"),
    parallelism: optionalNonNegativeInteger(config.parallelism, "parallelism", 1),
    maxRetries: optionalNonNegativeInteger(config.maxRetries, "maxRetries", 0),
    verbose: optionalBoolean(config.verbose, "verbose"),
    runner: optionalRunner(config.runner),
  };
}

function optionalString(value: unknown, key: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid inspection config: '${key}' must be a non-empty string`);
  }
  return value;
}

function optionalStringArray(value: unknown, key: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid inspection config: '${key}' must be a list of strings`);
  }
  return value;
}

function optionalNonNegativeInteger(
  value: unknown,
  key: string,
  minimum: number,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    throw new Error(
      `Invalid inspection config: '${key}' must be an integer greater than or equal to ${minimum}`,
    );
  }
  return value;
}

function optionalBoolean(value: unknown, key: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`Invalid inspection config: '${key}' must be a boolean`);
  }
  return value;
}

function optionalRunner(value: unknown): InspectionConfigRunner | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error("Invalid inspection config: 'runner' must be an object");
  }
  const provider = optionalString(value.provider, "runner.provider");
  if (provider === undefined) {
    throw new Error("Invalid inspection config: runner.provider is required");
  }

  return {
    provider,
    command: optionalString(value.command, "runner.command"),
    args: optionalStringArray(value.args, "runner.args"),
    timeoutMs: optionalNonNegativeInteger(value.timeoutMs, "runner.timeoutMs", 1),
    env: optionalStringRecord(value.env, "runner.env"),
  };
}

function optionalStringRecord(
  value: unknown,
  key: string,
): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`Invalid inspection config: '${key}' must be an object`);
  }
  const entries = Object.entries(value);
  if (entries.some(([, entryValue]) => typeof entryValue !== "string")) {
    throw new Error(`Invalid inspection config: '${key}' values must be strings`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function appendTargetContext(objective: string, targetContext: string | undefined): string {
  if (targetContext === undefined || targetContext.trim().length === 0) {
    return objective;
  }

  return `${objective.trim()}\n\nTarget context:\n${targetContext.trim()}\n`;
}

async function createRunnerFromConfig(
  runner: InspectionConfigRunner | undefined,
  repositoryReader: NodeRepositoryReader,
  repositoryEntries: Awaited<ReturnType<NodeRepositoryReader["listEntries"]>>,
): Promise<AgentRunner> {
  if (runner === undefined || runner.provider === "fake") {
    return createDefaultScoutArchitectureFakeRunner(
      repositoryReader,
      repositoryEntries,
    );
  }

  if (runner.provider === "process" || runner.provider === "codex") {
    if (runner.command === undefined) {
      throw new Error("Invalid inspection config: runner.command is required");
    }

    return new ProcessCodexAgentRunner({
      processRunner: new NodeProcessRunner(),
      command: runner.command,
      args: runner.args ?? [],
      timeoutMs: runner.timeoutMs,
      env: runner.env,
    });
  }

  throw new Error(`Invalid inspection config: unsupported runner provider '${runner.provider}'`);
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

function printCliError(
  stderr: (line: string) => void,
  error: unknown,
  debug: boolean,
): void {
  if (!(error instanceof Error)) {
    stderr("Unknown CLI error");
    return;
  }

  stderr(error.message);

  if (error instanceof InspectionRunFailedError) {
    stderr(`Run workspace: ${error.workspace.root}`);
  }

  if (debug) {
    stderr(error.stack ?? error.message);
  } else {
    stderr("Use --debug to show the stack trace.");
  }
}
