import type {
  AgentRunner,
  AgentRunRequest,
  AgentRunResult,
  ProcessRunner,
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
