import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

import {
  InspectionRunFailedError,
  resumeScoutArchitectureInspection,
  runScoutArchitectureInspection,
  type QualityCommandReport,
  type ResumeSpecialistState,
  type RuntimeSpecialistAgentId,
} from "../../application/index.js";
import type { RunConfig } from "../../domain/types.js";
import type {
  AgentRunner,
  Clock,
  InspectionEvent,
  InspectionEventSink,
  ProcessRunner,
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
  NodeAgentStatusArtifactWriter,
  NodeCaseStudyDocumentWriter,
  NodeEvidenceValidationReportWriter,
  NodeQaArtifactWriter,
  NodePromptArtifactWriter,
  NodePromptTemplateReader,
  NodePublicCaseStudyDocumentWriter,
  NodeQualityCommandReportWriter,
  NodeRagKnowledgeCardWriter,
  NodeRepositoryIndexPromptContextReader,
  NodeRepositoryIndexWriter,
  NodeRepositoryReader,
  NodeRunDataWorkspaceStore,
  NodeRunWorkspaceStore,
  NodeSplitCaseStudyDocumentWriter,
  NodeSwarmMemoryStore,
  NodeUserDataDirectoryProvider,
  NodeValidationReportWriter,
} from "../filesystem/index.js";
import { NodeProcessRunner } from "../process/index.js";

export const cliAdapterBoundary = "adapters.cli" as const;

export interface InspectorCliRequest {
  argv: string[];
  clock?: Clock;
  runner?: AgentRunner;
  processRunner?: ProcessRunner;
  events?: InspectionEventSink;
  stdin?: NodeJS.ReadableStream;
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
  runQualityCommands: boolean;
  runner?: InspectionConfigRunner;
  publicDocsDirectory?: string;
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
  runQualityCommands?: boolean;
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
    if (isHelpRequest(request.argv)) {
      printHelp(stdout);
      return { exitCode: 0 };
    }
    if (request.argv.length === 0) {
      return await runInteractiveWizard(request, stdout);
    }
    if (request.argv[0] === "status") {
      await printRunStatus(request.argv, stdout);
      return { exitCode: 0 };
    }
    if (request.argv[0] === "resume") {
      const result = await resumeRunCommand(request, stdout);
      stdout(`Inspection run workspace: ${result.workspace.root}`);
      return { exitCode: 0, workspace: result.workspace };
    }

    const command = await parseRunCommand(request.argv);
    debug = command.debug;
    const result = await executeRunCommand({
      request,
      command,
      stdout,
      workspaces: new NodeRunWorkspaceStore(),
      eventSink: createCliEventSink({
        stdout,
        verbose: command.verbose,
        external: request.events,
      }),
    });

    printProgress(stdout, command.verbose, `Final output: ${result.docsPath}`);
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

function isHelpRequest(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

function printHelp(stdout: (line: string) => void): void {
  stdout("Usage: inspector <command>");
  stdout("");
  stdout("Commands:");
  stdout("  run <repo-path> --objective <objective-file> --out <output-path>");
  stdout("  run <inspection.yaml> [--repo <repo-path>] [--objective <objective-file>] [--out <output-path>]");
  stdout("  status <run-dir>");
  stdout("  resume <run-dir>");
  stdout("");
  stdout("Flags:");
  stdout("  --verbose");
  stdout("  --debug");
  stdout("  --run-quality-commands");
  stdout("  --help");
}

async function runInteractiveWizard(
  request: InspectorCliRequest,
  stdout: (line: string) => void,
): Promise<InspectorCliResult> {
  stdout("Interactive Inspector Wizard");
  const input = await createWizardQuestioner(request.stdin);

  try {
    const repositoryPath = await askWithDefault(input, stdout, "Repository path", ".");
    const repoRoot = resolve(repositoryPath);
    const docsDefault = "./docs/inspector";
    const docsInput = await askWithDefault(
      input,
      stdout,
      "Public docs output path",
      docsDefault,
    );
    const defaultDataRoot = await new NodeUserDataDirectoryProvider().getInspectorDataRoot();
    const internalDataDirectory = await askWithDefault(
      input,
      stdout,
      "Internal run data directory",
      defaultDataRoot,
    );
    const runnerChoice = normalizeRunnerChoice(
      await askWithDefault(
        input,
        stdout,
        "Runner (fake/process)",
        "fake",
      ),
    );
    const runner =
      runnerChoice === "fake"
        ? { provider: "fake" }
        : await askProcessRunner(input, stdout);

    const runQualityCommands = await askYesNo(
      input,
      stdout,
      "Execute quality commands?",
      false,
    );
    if (runQualityCommands) {
      stdout(
        "Detected package scripts can execute arbitrary project code. Enable only for trusted repositories.",
      );
      const confirmed = await askExplicitConfirmation(
        input,
        stdout,
        "Type yes to enable quality command execution",
      );
      if (!confirmed) {
        throw new Error("Quality command execution requires explicit confirmation");
      }
    }

    stdout("Specialist Agents");
    for (const stage of runtimeStageIds) {
      stdout(`- ${stage}: pending`);
    }
    stdout(`Final docs: ${resolveDocsPath(repoRoot, docsInput)}`);
    stdout(`Internal data: ${resolve(internalDataDirectory)}`);

    const confirmed = await askYesNo(input, stdout, "Start inspection?", false);
    if (!confirmed) {
      return { exitCode: 1 };
    }

    const docsPath = resolveDocsPath(repoRoot, docsInput);
    const command: ParsedRunCommand = {
      repoPath: repoRoot,
      objective: "Inspect the repository and produce evidence-backed documentation.\n",
      outPath: resolve(internalDataDirectory, "runs"),
      verbose: false,
      debug: false,
      runQualityCommands,
      runner,
      publicDocsDirectory: docsPath,
    };
    const eventSink = createWizardEventSink({
      stdout,
      external: request.events,
    });
    const result = await executeRunCommand({
      request,
      command,
      stdout,
      workspaces: new NodeRunDataWorkspaceStore({
        dataRoot: resolve(internalDataDirectory),
      }),
      eventSink,
    });

    stdout(`Final docs: ${result.docsPath}`);
    stdout(`Internal data: ${result.workspace.root}`);
    return { exitCode: 0, workspace: result.workspace };
  } finally {
    input.close();
  }
}

interface WizardQuestioner {
  question(prompt: string): Promise<string>;
  close(): void;
}

async function createWizardQuestioner(
  stdin: NodeJS.ReadableStream | undefined,
): Promise<WizardQuestioner> {
  if (stdin !== undefined) {
    const chunks: string[] = [];
    for await (const chunk of stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
    }
    const lines = chunks.join("").split(/\r?\n/);
    let index = 0;
    return {
      async question() {
        const answer = lines[index] ?? "";
        index += 1;
        return answer;
      },
      close() {
        return undefined;
      },
    };
  }

  const readline = createInterface({
    input: process.stdin,
    terminal: true,
  });
  return readline;
}

async function askProcessRunner(
  input: WizardQuestioner,
  stdout: (line: string) => void,
): Promise<InspectionConfigRunner> {
  const command = await askWithDefault(input, stdout, "Codex command", "codex");
  const args = splitArgs(
    await askWithDefault(input, stdout, "Codex command args", "exec {prompt}"),
  );
  const useFullAuto = await askYesNo(
    input,
    stdout,
    "Use Codex full-auto/YOLO flag if supported?",
    false,
  );

  const fullAutoArgs = useFullAuto ? addCodexFullAutoArg(args) : args;
  if (useFullAuto) {
    stdout(
      "This grants Codex permission to run commands in this trusted local repository. Use only on repositories you trust.",
    );
    const confirmed = await askExplicitConfirmation(
      input,
      stdout,
      "Type yes to enable Codex full-auto/YOLO",
    );
    if (!confirmed) {
      throw new Error("Codex full-auto/YOLO requires explicit confirmation");
    }
  }

  return {
    provider: "codex",
    command,
    args: fullAutoArgs,
  };
}

async function askWithDefault(
  input: WizardQuestioner,
  stdout: (line: string) => void,
  label: string,
  defaultValue: string,
): Promise<string> {
  stdout(`${label} [${defaultValue}]`);
  const answer = (await input.question("")).trim();
  return answer.length === 0 ? defaultValue : answer;
}

async function askYesNo(
  input: WizardQuestioner,
  stdout: (line: string) => void,
  label: string,
  defaultValue: boolean,
): Promise<boolean> {
  const suffix = defaultValue ? "Y/n" : "y/N";
  stdout(`${label} [${suffix}]`);
  const answer = (await input.question("")).trim().toLowerCase();
  if (answer.length === 0) {
    return defaultValue;
  }
  return answer === "y" || answer === "yes";
}

async function askExplicitConfirmation(
  input: WizardQuestioner,
  stdout: (line: string) => void,
  label: string,
): Promise<boolean> {
  stdout(label);
  return (await input.question("")).trim() === "yes";
}

function normalizeRunnerChoice(choice: string): "fake" | "process" {
  const normalized = choice.trim().toLowerCase();
  if (normalized === "fake" || normalized.length === 0) {
    return "fake";
  }
  if (["process", "codex", "codex cli"].includes(normalized)) {
    return "process";
  }
  throw new Error("Runner must be fake or process");
}

function splitArgs(input: string): string[] {
  return input
    .split(/\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function addCodexFullAutoArg(args: string[]): string[] {
  const flag = "--dangerously-bypass-approvals-and-sandbox";
  if (args.includes(flag)) {
    return args;
  }
  const promptIndex = args.indexOf("{prompt}");
  if (promptIndex === -1) {
    return [...args, flag];
  }
  return [...args.slice(0, promptIndex), flag, ...args.slice(promptIndex)];
}

function resolveDocsPath(repoRoot: string, input: string): string {
  return isAbsolute(input) ? input : resolve(repoRoot, input);
}

async function executeRunCommand(input: {
  request: InspectorCliRequest;
  command: ParsedRunCommand;
  stdout: (line: string) => void;
  workspaces: NodeRunWorkspaceStore | NodeRunDataWorkspaceStore;
  eventSink: InspectionEventSink;
}): Promise<{ workspace: RunWorkspace; docsPath: string }> {
  const { request, command, stdout } = input;
  await assertDirectory(command.repoPath, "Repository path");

  const objective = appendTargetContext(command.objective, command.targetContext);
  const repoRoot = resolve(command.repoPath);
  const repositoryReader = new NodeRepositoryReader(repoRoot);
  const repositoryEntries = await repositoryReader.listEntries();
  const processRunner = request.processRunner ?? new NodeProcessRunner();
  const docsPath = command.publicDocsDirectory ?? `${repoRoot}/docs/inspector`;
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
    runQualityCommands: command.runQualityCommands,
    ...(command.publicDocsDirectory === undefined
      ? {}
      : { publicDocsDirectory: command.publicDocsDirectory }),
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
    workspaces: input.workspaces,
    repositoryReader,
    repositoryIndexWriter: new NodeRepositoryIndexWriter(),
    repositoryIndexContext: new NodeRepositoryIndexPromptContextReader(),
    memory: (workspace) => new NodeSwarmMemoryStore(workspace),
    promptTemplates: new NodePromptTemplateReader(promptRoot),
    promptArtifacts: new NodePromptArtifactWriter(),
    statusArtifacts: new NodeAgentStatusArtifactWriter(),
    outputArtifacts: new NodeAgentOutputArtifactWriter(),
    validationReports: new NodeValidationReportWriter(),
    evidenceReports: new NodeEvidenceValidationReportWriter(),
    qaArtifacts: new NodeQaArtifactWriter(),
    qualityCommandReports: new NodeQualityCommandReportWriter(),
    finalDocs: new NodeSplitCaseStudyDocumentWriter(
      new NodeCaseStudyDocumentWriter(),
      new NodePublicCaseStudyDocumentWriter(repoRoot, command.publicDocsDirectory),
    ),
    ragCards: new NodeRagKnowledgeCardWriter(),
    processRunner,
    validators: await createSchemaContractValidators(),
    schemaReader: new NodeAgentOutputSchemaReader(schemaRoot),
    events: input.eventSink,
    progress: (message) => printProgress(stdout, command.verbose, message),
  });

  return { workspace: result.workspace, docsPath };
}

const runtimeStageIds = [
  "scout",
  "architecture",
  "pattern_miner",
  "flow_tracer",
  "testing_strategy",
  "tradeoff_analyst",
] as const;

type RuntimeStageStatus =
  | "PENDING"
  | "RUNNING"
  | "OUTPUT_RECEIVED"
  | "SCHEMA_VALIDATED"
  | "EVIDENCE_VALIDATED"
  | "QA_REVIEWED"
  | "APPROVED"
  | "SCHEMA_FAILED"
  | "EVIDENCE_FAILED"
  | "QA_FAILED"
  | "RETRYING"
  | "FAILED";

async function printRunStatus(
  argv: string[],
  stdout: (line: string) => void,
): Promise<void> {
  const runDirectory = argv[1];
  if (runDirectory === undefined || runDirectory.startsWith("--")) {
    throw new Error("Usage: inspector status <run-dir>");
  }

  await assertDirectory(runDirectory, "Run directory");
  const statuses = await readRunStageStatuses(runDirectory);
  const completed = statuses.filter((status) => isCompletedStatus(status)).length;
  const failed = statuses.filter((status) => isFailedStatus(status)).length;
  const running = statuses.filter((status) => status === "RUNNING").length;
  const pending = statuses.filter((status) => status === "PENDING").length;

  stdout(`Run status: ${resolve(runDirectory)}`);
  stdout(`Completed: ${completed}`);
  stdout(`Failed: ${failed}`);
  stdout(`Running: ${running}`);
  stdout(`Pending: ${pending}`);
}

async function resumeRunCommand(
  request: InspectorCliRequest,
  stdout: (line: string) => void,
): Promise<InspectorCliResult & { workspace: RunWorkspace }> {
  const runDirectory = request.argv[1];
  if (runDirectory === undefined || runDirectory.startsWith("--")) {
    throw new Error("Usage: inspector resume <run-dir>");
  }

  await assertDirectory(runDirectory, "Run directory");
  const workspace = toExistingRunWorkspace(resolve(runDirectory));
  const config = await readRunConfig(workspace.configFile);
  const objective = await readRunObjective(workspace);
  const repositoryReader = new NodeRepositoryReader(config.target.root);
  const repositoryEntries = await repositoryReader.listEntries();
  const commandReport = await readQualityCommandReport(workspace);
  const processRunner = request.processRunner ?? new NodeProcessRunner();

  printProgress(stdout, config.verbose === true, `Resuming inspection: ${config.target.name}`);
  const eventSink = createCliEventSink({
    stdout,
    verbose: config.verbose === true,
    external: request.events,
  });
  const result = await resumeScoutArchitectureInspection({
    config,
    objective,
    workspace,
    commandReport,
    stages: await readRunStageState(workspace.root),
    clock: request.clock ?? systemClock,
    runner:
      request.runner ??
      (await createRunnerFromConfig(config.runner, repositoryReader, repositoryEntries)),
    workspaces: new NodeRunWorkspaceStore(),
    repositoryReader,
    repositoryIndexWriter: new NodeRepositoryIndexWriter(),
    repositoryIndexContext: new NodeRepositoryIndexPromptContextReader(),
    memory: (runWorkspace) => new NodeSwarmMemoryStore(runWorkspace),
    promptTemplates: new NodePromptTemplateReader(promptRoot),
    promptArtifacts: new NodePromptArtifactWriter(),
    statusArtifacts: new NodeAgentStatusArtifactWriter(),
    outputArtifacts: new NodeAgentOutputArtifactWriter(),
    validationReports: new NodeValidationReportWriter(),
    evidenceReports: new NodeEvidenceValidationReportWriter(),
    qaArtifacts: new NodeQaArtifactWriter(),
    qualityCommandReports: new NodeQualityCommandReportWriter(),
    finalDocs: new NodeSplitCaseStudyDocumentWriter(
      new NodeCaseStudyDocumentWriter(),
      new NodePublicCaseStudyDocumentWriter(config.target.root),
    ),
    ragCards: new NodeRagKnowledgeCardWriter(),
    processRunner,
    validators: await createSchemaContractValidators(),
    schemaReader: new NodeAgentOutputSchemaReader(schemaRoot),
    events: eventSink,
    progress: (message) => printProgress(stdout, config.verbose === true, message),
  });
  return { exitCode: 0, workspace: result.workspace };
}

function toExistingRunWorkspace(root: string): RunWorkspace {
  return {
    name: basename(root),
    root,
    configFile: join(root, "config.json"),
    folders: {
      input: join(root, "input"),
      repoIndex: join(root, "repo_index"),
      memory: join(root, "memory"),
      agents: join(root, "agents"),
      validation: join(root, "validation"),
      qa: join(root, "qa"),
      final: join(root, "final"),
    },
  };
}

async function readRunConfig(path: string): Promise<RunConfig> {
  const value = JSON.parse(await readFile(path, "utf8")) as RunConfig;
  if (
    !isRecord(value) ||
    !isRecord(value.target) ||
    typeof value.target.name !== "string" ||
    typeof value.target.root !== "string" ||
    typeof value.outputDirectory !== "string"
  ) {
    throw new Error("Corrupted run state: invalid config.json");
  }
  return value;
}

async function readRunObjective(workspace: RunWorkspace): Promise<string> {
  const blackboard = await readFile(
    join(workspace.folders.memory, "blackboard.md"),
    "utf8",
  );
  const match = /^Objective: (?<objective>.+)$/m.exec(blackboard);
  const objective = match?.groups?.objective;
  if (objective === undefined || objective.trim().length === 0) {
    throw new Error("Ambiguous run state: missing original objective");
  }
  return `${objective.trim()}\n`;
}

async function readQualityCommandReport(
  workspace: RunWorkspace,
): Promise<QualityCommandReport> {
  return JSON.parse(
    await readFile(
      join(workspace.folders.validation, "command_report.json"),
      "utf8",
    ),
  ) as QualityCommandReport;
}

async function readRunStageStatuses(
  runDirectory: string,
): Promise<RuntimeStageStatus[]> {
  return Promise.all(
    runtimeStageIds.map(async (agentId) => {
      const status = await readLatestAgentStatus(runDirectory, agentId);
      return status ?? "PENDING";
    }),
  );
}

async function readRunStageState(
  runDirectory: string,
): Promise<ResumeSpecialistState[]> {
  return Promise.all(
    runtimeStageIds.map(async (agentId) => {
      const latest = await readLatestAgentStatusSnapshot(runDirectory, agentId);
      if (latest === undefined) {
        return { agentId, status: "PENDING", attempt: 0 };
      }
      return {
        agentId,
        status: latest.status,
        attempt: latest.attempt,
        ...(latest.output === undefined ? {} : { output: latest.output }),
      };
    }),
  );
}

async function readLatestAgentStatus(
  runDirectory: string,
  agentId: RuntimeSpecialistAgentId,
): Promise<RuntimeStageStatus | undefined> {
  return (await readLatestAgentStatusSnapshot(runDirectory, agentId))?.status;
}

async function readLatestAgentStatusSnapshot(
  runDirectory: string,
  agentId: RuntimeSpecialistAgentId,
): Promise<
  | {
      status: RuntimeStageStatus;
      attempt: number;
      output?: unknown;
    }
  | undefined
> {
  const agentDirectory = join(runDirectory, "agents", agentId);
  let entries: string[];
  try {
    entries = await readdir(agentDirectory);
  } catch {
    return undefined;
  }

  const attempts = entries
    .map((entry) => /^attempt-(\d+)$/.exec(entry)?.[1])
    .filter((attempt): attempt is string => attempt !== undefined)
    .map(Number)
    .sort((left, right) => right - left);
  const latestAttempt = attempts[0];
  if (latestAttempt === undefined) {
    return undefined;
  }

  const statusJson = JSON.parse(
    await readFile(
      join(agentDirectory, `attempt-${latestAttempt}`, "status.json"),
      "utf8",
    ),
  ) as { status?: unknown };

  if (!isRuntimeStageStatus(statusJson.status)) {
    throw new Error(`Corrupted run state: invalid status for ${agentId}`);
  }

  const output = await readOptionalAgentOutput(
    join(agentDirectory, `attempt-${latestAttempt}`, "output.json"),
    agentId,
    latestAttempt,
  );

  return {
    status: statusJson.status,
    attempt: latestAttempt,
    ...(output === undefined ? {} : { output }),
  };
}

function isRuntimeStageStatus(value: unknown): value is RuntimeStageStatus {
  return (
    typeof value === "string" &&
    [
      "PENDING",
      "RUNNING",
      "OUTPUT_RECEIVED",
      "SCHEMA_VALIDATED",
      "EVIDENCE_VALIDATED",
      "QA_REVIEWED",
      "APPROVED",
      "SCHEMA_FAILED",
      "EVIDENCE_FAILED",
      "QA_FAILED",
      "RETRYING",
      "FAILED",
    ].includes(value)
  );
}

function isCompletedStatus(status: RuntimeStageStatus): boolean {
  return ["EVIDENCE_VALIDATED", "QA_REVIEWED", "APPROVED"].includes(status);
}

function isFailedStatus(status: RuntimeStageStatus): boolean {
  return ["SCHEMA_FAILED", "EVIDENCE_FAILED", "QA_FAILED", "FAILED"].includes(
    status,
  );
}

async function readOptionalAgentOutput(
  path: string,
  agentId: RuntimeSpecialistAgentId,
  attempt: number,
): Promise<unknown | undefined> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw new Error(
      `Corrupted run state: cannot read output for ${agentId} attempt ${attempt}`,
      { cause: error },
    );
  }

  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(
      `Corrupted run state: malformed output for ${agentId} attempt ${attempt}`,
      { cause: error },
    );
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
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
    runQualityCommands: argv.includes("--run-quality-commands"),
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
    runQualityCommands:
      argv.includes("--run-quality-commands") || config.runQualityCommands === true,
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
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid inspection config: ${message}`, { cause: error });
  }

  if (parsed === null) {
    return normalizeInspectionConfig({});
  }
  if (!isRecord(parsed)) {
    throw new Error("Invalid inspection config: root must be an object");
  }

  assertKnownConfigKeys(parsed);
  return normalizeInspectionConfig(parsed);
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
    "runQualityCommands",
    "verbose",
    "runner",
  ].includes(key);
}

function assertKnownConfigKeys(config: Record<string, unknown>): void {
  for (const key of Object.keys(config)) {
    if (!isKnownConfigKey(key)) {
      throw new Error(`Invalid inspection config: unknown field '${key}'`);
    }
  }
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
    runQualityCommands: optionalBoolean(
      config.runQualityCommands,
      "runQualityCommands",
    ),
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

function createCliEventSink(input: {
  stdout: (line: string) => void;
  verbose: boolean;
  external?: InspectionEventSink;
}): InspectionEventSink {
  return {
    async emit(event) {
      await input.external?.emit(event);
      const line = renderInspectionEvent(event);
      if (line !== undefined && input.verbose) {
        input.stdout(line);
      }
    },
  };
}

function createWizardEventSink(input: {
  stdout: (line: string) => void;
  external?: InspectionEventSink;
}): InspectionEventSink {
  return {
    async emit(event) {
      await input.external?.emit(event);
      const line = renderWizardInspectionEvent(event);
      if (line !== undefined) {
        input.stdout(line);
      }
    },
  };
}

function renderWizardInspectionEvent(event: InspectionEvent): string | undefined {
  switch (event.type) {
    case "stage.started":
      return `Stage: ${event.label}`;
    case "agent.started":
      return `Current (${event.agentId}): ${event.task}`;
    case "agent.output.received":
      return `Output received: ${event.agentId}`;
    case "agent.schema.passed":
      return `Schema passed: ${event.agentId}`;
    case "agent.evidence.passed":
      return `Evidence passed: ${event.agentId}`;
    case "agent.failed":
      return `Agent failed: ${event.agentId} - ${event.reason}`;
    case "qa.completed":
      return `QA: ${event.approved} approved, ${event.rejected} rejected, ${event.issues} issue(s)`;
    case "docs.written":
      return `Final docs: ${event.path}`;
    case "run.completed":
      return `Internal data: ${event.dataPath}`;
    case "run.started":
      return `Internal data: ${event.dataPath}`;
    default:
      return undefined;
  }
}

function renderInspectionEvent(event: InspectionEvent): string | undefined {
  switch (event.type) {
    case "agent.activity":
      return `Agent activity: ${event.agentId} - ${event.message}`;
    case "docs.written":
      return `Final docs written: ${event.path}`;
    case "rag.written":
      return `RAG cards written: ${event.path}`;
    default:
      return undefined;
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
