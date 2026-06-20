import type {
  AgentRunner,
  AgentRunRequest,
  AgentRunResult,
  ProcessRunner,
  RepositoryEntry,
  RepositoryReader,
} from "../../ports/index.js";

export const codexAdapterBoundary = "adapters.codex" as const;

export interface FakeAgentRunnerOptions {
  results: AgentRunResult[];
}

export interface ProcessCodexAgentRunnerOptions {
  processRunner: ProcessRunner;
  command: string;
  args: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  outputArtifactPaths?: string[];
}

export class FakeAgentRunner implements AgentRunner {
  private readonly results: AgentRunResult[];

  requests: AgentRunRequest[] = [];

  constructor(options: FakeAgentRunnerOptions) {
    this.results = options.results.map(cloneAgentRunResult);
  }

  async runAgent(request: AgentRunRequest): Promise<AgentRunResult> {
    this.requests.push({ ...request });

    const result = this.results.shift();

    if (result === undefined) {
      throw new Error(`no fake agent result configured for ${request.agentId}`);
    }

    const clonedResult = cloneAgentRunResult(result);

    for (const event of clonedResult.streamingEvents) {
      await request.onStreamingEvent?.({ ...event });
    }

    return clonedResult;
  }
}

export async function createDefaultScoutArchitectureFakeRunner(
  reader: RepositoryReader,
  entries: RepositoryEntry[],
): Promise<FakeAgentRunner> {
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

  const patternMinerResult: AgentRunResult = {
    stdout: `${JSON.stringify({
      patterns: [
        {
          name: "Evidence-first inspection outputs",
          problemSolved:
            "Keeps default inspection output tied to repository files that were actually read.",
          implementationShape:
            "Default agent outputs cite the selected repository file and keep confidence low when evidence is shallow.",
          evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
          tradeoffs: [
            "This avoids unsupported claims but produces limited pattern value until a real agent inspects the codebase.",
          ],
          whenToUse:
            "Use for deterministic local runs and tests that need schema-valid placeholder output.",
          whenNotToUse:
            "Do not use as a substitute for real pattern mining in production inspection reports.",
          adaptationValue:
            "The same evidence discipline can guide future fake runners and fixtures.",
          tags: ["evidence", "testing"],
          confidence: 0.4,
        },
      ],
      findings: [
        {
          id: "finding-pattern-miner-001",
          agent: "pattern_miner",
          severity: "info",
          claim:
            "The default Pattern Miner result has only shallow repository evidence.",
          evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
          recommendation:
            "Configure a real agent runner before relying on pattern findings.",
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

  const flowTracerResult: AgentRunResult = {
    stdout: `${JSON.stringify({
      flows: [
        {
          name: "Default evidence inspection flow",
          action:
            "The default runner traces only the repository file available as safe evidence.",
          entryPoint: {
            path: citedFile.path,
            evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
          },
          mainFiles: [
            {
              path: citedFile.path,
              role: "Safe cited file selected for the default inspection run.",
              evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
            },
          ],
          dataPath: [
            {
              step: "The selected file is passed through Scout, Architecture, Pattern Miner, and Flow Tracer placeholder outputs.",
              evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
            },
          ],
          sideEffects: [
            {
              description:
                "The inspection runtime writes run artifacts outside the target repository.",
              evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
            },
          ],
          persistencePath: [
            {
              description:
                "No target-repository persistence path is visible to the default runner.",
              evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
            },
          ],
          errorPaths: [
            {
              description:
                "No target-repository error path is visible to the default runner.",
              evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
            },
          ],
          tests: [
            {
              description:
                "No target-repository test path is visible to the default runner.",
              evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
            },
          ],
          evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
        },
      ],
      insufficientEvidence: [],
      findings: [
        {
          id: "finding-flow-tracer-001",
          agent: "flow_tracer",
          severity: "info",
          claim:
            "The default Flow Tracer result has only shallow repository flow evidence.",
          evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
          recommendation:
            "Configure a real agent runner before relying on feature-flow traces.",
          confidence: 0.4,
          validation: ["schema-valid", "evidence-valid"],
          cardType: "flow",
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

  const testingStrategyResult: AgentRunResult = {
    stdout: `${JSON.stringify({
      testTypesFound: [
        {
          name: "Default runner testing evidence",
          summary:
            "The default runner only confirms that a repository file is available for testing-strategy inspection.",
          evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
        },
      ],
      qualityGates: [
        {
          command: "npm test",
          status: "not-run",
          summary:
            "The default runner does not execute repository validation commands.",
          evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
        },
      ],
      behaviorProtected: [
        {
          name: "Default inspection path",
          summary:
            "Only the deterministic placeholder inspection path is represented by the default runner.",
          evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
        },
      ],
      behaviorNotProtected: [
        {
          name: "Real repository test outcomes",
          summary:
            "No target-repository test outcome is proven because no validation command was run.",
          evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
        },
      ],
      commandEvidence: [
        {
          command: "npm test",
          status: "not-run",
          evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
        },
      ],
      testingRisks: [
        {
          name: "Unexecuted validation commands",
          summary:
            "Default output must not be treated as evidence that repository tests pass.",
          evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
        },
      ],
      recommendations: [
        {
          summary:
            "Run the repository validation commands before claiming quality gates pass.",
          priority: "high",
          evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
        },
      ],
      findings: [
        {
          id: "finding-testing-strategy-001",
          agent: "testing_strategy",
          severity: "medium",
          claim:
            "The default Testing Strategy result does not prove repository tests pass.",
          evidence: [{ file: citedFile.path, lineStart: 1, lineEnd }],
          recommendation:
            "Configure a real agent runner and run validation commands before relying on testing findings.",
          confidence: 0.4,
          validation: ["schema-valid", "evidence-valid"],
          tags: ["testing", "quality-gate"],
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

  return new FakeAgentRunner({
    results: [
      scoutResult,
      architectureResult,
      patternMinerResult,
      flowTracerResult,
      testingStrategyResult,
    ],
  });
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

function cloneAgentRunResult(result: AgentRunResult): AgentRunResult {
  return {
    ...result,
    outputArtifactPaths: [...result.outputArtifactPaths],
    streamingEvents: result.streamingEvents.map((event) => ({ ...event })),
  };
}

export class ProcessCodexAgentRunner implements AgentRunner {
  private readonly processRunner: ProcessRunner;
  private readonly command: string;
  private readonly args: string[];
  private readonly env?: Record<string, string>;
  private readonly timeoutMs?: number;
  private readonly outputArtifactPaths: string[];

  constructor(options: ProcessCodexAgentRunnerOptions) {
    this.processRunner = options.processRunner;
    this.command = options.command;
    this.args = [...options.args];
    this.env = options.env;
    this.timeoutMs = options.timeoutMs;
    this.outputArtifactPaths = [...(options.outputArtifactPaths ?? [])];
  }

  async runAgent(request: AgentRunRequest): Promise<AgentRunResult> {
    const processResult = await this.processRunner.run({
      command: this.command,
      args: this.args.map((arg) => interpolateCodexArg(arg, request)),
      cwd: request.workspaceRoot,
      env: this.env,
      timeoutMs: this.timeoutMs,
      onStreamingEvent: async (event) => {
        await request.onStreamingEvent?.({
          ...event,
          kind: event.kind === "status" ? "status" : event.kind,
        });
      },
    });

    return {
      stdout: processResult.stdout,
      stderr: processResult.stderr,
      exitCode: processResult.exitCode,
      startedAt: processResult.startedAt,
      completedAt: processResult.completedAt,
      outputArtifactPaths: [...this.outputArtifactPaths],
      streamingEvents: processResult.streamingEvents.map((event) => ({
        ...event,
        kind: event.kind === "status" ? "status" : event.kind,
      })),
      failureReason: processResult.failureReason,
    };
  }
}

function interpolateCodexArg(arg: string, request: AgentRunRequest): string {
  return arg
    .replaceAll("{prompt}", request.prompt)
    .replaceAll("{agentId}", request.agentId)
    .replaceAll("{attempt}", String(request.attempt))
    .replaceAll("{workspaceRoot}", request.workspaceRoot);
}
