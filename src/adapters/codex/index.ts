import type {
  AgentRunner,
  AgentRunRequest,
  AgentRunResult,
} from "../../ports/index.js";

export const codexAdapterBoundary = "adapters.codex" as const;

export interface FakeAgentRunnerOptions {
  results: AgentRunResult[];
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
