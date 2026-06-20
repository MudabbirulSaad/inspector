import type { AgentLifecycle } from "../domain/agent-lifecycle.js";
import { serializeAgentLifecycleStatus } from "../domain/agent-lifecycle.js";
import type { AgentStatusArtifactWriter, RunWorkspace } from "../ports/index.js";

export interface WriteAgentLifecycleStatusRequest {
  workspace: RunWorkspace;
  lifecycle: AgentLifecycle;
  artifacts: AgentStatusArtifactWriter;
}

export interface WriteAgentLifecycleStatusResult {
  artifactPath: string;
}

export async function writeAgentLifecycleStatus(
  request: WriteAgentLifecycleStatusRequest,
): Promise<WriteAgentLifecycleStatusResult> {
  const result = await request.artifacts.writeAgentStatus({
    workspace: request.workspace,
    agentId: request.lifecycle.agentId,
    attempt: request.lifecycle.attempts,
    content: serializeAgentLifecycleStatus(request.lifecycle),
  });

  return {
    artifactPath: result.path,
  };
}
