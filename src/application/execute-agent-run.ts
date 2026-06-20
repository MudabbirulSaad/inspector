import type {
  AgentRunner,
  AgentRunRequest,
  AgentRunResult,
} from "../ports/index.js";

export interface ExecuteAgentRunRequest extends AgentRunRequest {
  runner: AgentRunner;
}

export async function executeAgentRun(
  request: ExecuteAgentRunRequest,
): Promise<AgentRunResult> {
  const { runner, ...agentRunRequest } = request;

  return runner.runAgent(agentRunRequest);
}
