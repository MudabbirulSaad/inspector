import type { AgentContract, AgentContractId } from "../agents/index.js";

export type ScheduledAgentStatus = "succeeded" | "failed";

export interface ScheduledAgentRunResult {
  status: ScheduledAgentStatus;
  reason?: string;
}

export interface ScheduleAgentGraphRequest {
  agents: AgentContract[];
  maxParallelism: number;
  runAgent: (agent: AgentContract) => Promise<ScheduledAgentRunResult>;
}

export interface ScheduleAgentGraphResult {
  completedAgentIds: AgentContractId[];
  failedAgentIds: AgentContractId[];
  blockedAgentIds: AgentContractId[];
}

interface RunningAgentResult {
  contract: AgentContract;
  result: ScheduledAgentRunResult;
}

export async function scheduleAgentGraph(
  request: ScheduleAgentGraphRequest,
): Promise<ScheduleAgentGraphResult> {
  if (!Number.isInteger(request.maxParallelism) || request.maxParallelism < 1) {
    throw new Error("Scheduler maxParallelism must be at least 1.");
  }

  const completedAgentIds: AgentContractId[] = [];
  const failedAgentIds: AgentContractId[] = [];
  const blockedAgentIds: AgentContractId[] = [];
  const completed = new Set<AgentContractId>();
  const failedOptional = new Set<AgentContractId>();
  const contractsById = new Map(
    request.agents.map((contract) => [contract.id, contract]),
  );
  const pending = [...request.agents];
  const running = new Map<AgentContractId, Promise<RunningAgentResult>>();

  while (pending.length > 0 || running.size > 0) {
    let launched = false;

    for (let index = 0; index < pending.length;) {
      if (running.size >= request.maxParallelism) {
        break;
      }

      const contract = pending[index];

      if (contract === undefined) {
        break;
      }

      if (
        contract.dependencies.some(
          (dependency) =>
            !completed.has(dependency) && !failedOptional.has(dependency),
        )
      ) {
        index += 1;
        continue;
      }

      pending.splice(index, 1);
      running.set(
        contract.id,
        runScheduledAgent(request, contract),
      );
      launched = true;
    }

    if (running.size === 0) {
      blockedAgentIds.push(...pending.map((contract) => contract.id));
      pending.splice(0, pending.length);
      break;
    }

    if (launched && running.size < request.maxParallelism && pending.length > 0) {
      continue;
    }

    const { contract, result } = await Promise.race(running.values());
    running.delete(contract.id);

    if (result.status === "succeeded") {
      completed.add(contract.id);
      completedAgentIds.push(contract.id);
    } else {
      failedAgentIds.push(contract.id);
      if (!contractsById.get(contract.id)?.required) {
        failedOptional.add(contract.id);
      }
    }
  }

  return {
    completedAgentIds,
    failedAgentIds,
    blockedAgentIds,
  };
}

async function runScheduledAgent(
  request: ScheduleAgentGraphRequest,
  contract: AgentContract,
): Promise<RunningAgentResult> {
  try {
    const result = await request.runAgent(contract);
    return { contract, result };
  } catch (error) {
    return {
      contract,
      result: {
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
