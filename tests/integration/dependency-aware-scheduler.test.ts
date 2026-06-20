import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";

import { scheduleAgentGraph } from "../../src/application/index.js";
import type { AgentContract } from "../../src/agents/index.js";

function agent(
  id: string,
  dependencies: string[] = [],
  required = true,
): AgentContract {
  return {
    id: id as AgentContract["id"],
    role: `${id} role`,
    description: `${id} description`,
    lifecycle: "v1",
    dependencies: dependencies as AgentContract["dependencies"],
    outputArtifacts: [`agents/${id}/output.json`],
    outputSchema: "finding",
    retryPolicy: {
      maxAttempts: 1,
      retryableFailures: ["failed"],
    },
    required,
    qaRevisionOwnership: { ownsRevisionFor: [] },
  };
}

test("scheduler runs dependent agents after their dependencies complete", async () => {
  const order: string[] = [];

  const result = await scheduleAgentGraph({
    agents: [agent("scout"), agent("architecture", ["scout"])],
    maxParallelism: 2,
    runAgent: async (contract) => {
      order.push(contract.id);
      return { status: "succeeded" };
    },
  });

  assert.deepEqual(order, ["scout", "architecture"]);
  assert.deepEqual(result.completedAgentIds, ["scout", "architecture"]);
  assert.deepEqual(result.failedAgentIds, []);
  assert.deepEqual(result.blockedAgentIds, []);
});

test("scheduler runs independent agents in parallel", async () => {
  const started: string[] = [];
  const release: Array<() => void> = [];

  const schedule = scheduleAgentGraph({
    agents: [agent("architecture"), agent("pattern_miner")],
    maxParallelism: 2,
    runAgent: async (contract) => {
      started.push(contract.id);
      await new Promise<void>((resolve) => {
        release.push(resolve);
      });
      return { status: "succeeded" };
    },
  });

  await Promise.resolve();

  assert.deepEqual(started, ["architecture", "pattern_miner"]);

  for (const resolve of release) {
    resolve();
  }

  const result = await schedule;

  assert.deepEqual(result.completedAgentIds, ["architecture", "pattern_miner"]);
});

test("scheduler enforces the configured parallelism limit", async () => {
  const started: string[] = [];
  const release: Array<() => void> = [];

  const schedule = scheduleAgentGraph({
    agents: [
      agent("architecture"),
      agent("pattern_miner"),
      agent("testing_strategy"),
    ],
    maxParallelism: 2,
    runAgent: async (contract) => {
      started.push(contract.id);
      await new Promise<void>((resolve) => {
        release.push(resolve);
      });
      return { status: "succeeded" };
    },
  });

  await Promise.resolve();

  assert.deepEqual(started, ["architecture", "pattern_miner"]);

  release[0]?.();
  await setImmediate();

  assert.deepEqual(started, [
    "architecture",
    "pattern_miner",
    "testing_strategy",
  ]);

  release[1]?.();
  release[2]?.();

  const result = await schedule;

  assert.deepEqual(result.completedAgentIds, [
    "architecture",
    "pattern_miner",
    "testing_strategy",
  ]);
});

test("scheduler blocks dependents when a required dependency fails", async () => {
  const started: string[] = [];

  const result = await scheduleAgentGraph({
    agents: [agent("scout"), agent("architecture", ["scout"])],
    maxParallelism: 2,
    runAgent: async (contract) => {
      started.push(contract.id);

      if (contract.id === "scout") {
        return { status: "failed", reason: "missing evidence" };
      }

      return { status: "succeeded" };
    },
  });

  assert.deepEqual(started, ["scout"]);
  assert.deepEqual(result.completedAgentIds, []);
  assert.deepEqual(result.failedAgentIds, ["scout"]);
  assert.deepEqual(result.blockedAgentIds, ["architecture"]);
});

test("scheduler treats thrown required agent errors as failed agent results", async () => {
  const result = await scheduleAgentGraph({
    agents: [agent("scout"), agent("architecture", ["scout"])],
    maxParallelism: 2,
    runAgent: async (contract) => {
      if (contract.id === "scout") {
        throw new Error("runner crashed");
      }

      return { status: "succeeded" };
    },
  });

  assert.deepEqual(result.completedAgentIds, []);
  assert.deepEqual(result.failedAgentIds, ["scout"]);
  assert.deepEqual(result.blockedAgentIds, ["architecture"]);
});

test("scheduler allows safe continuation when optional dependencies fail", async () => {
  const started: string[] = [];

  const result = await scheduleAgentGraph({
    agents: [
      agent("flow_tracer", [], false),
      agent("final_reviewer", ["flow_tracer"]),
    ],
    maxParallelism: 2,
    runAgent: async (contract) => {
      started.push(contract.id);

      if (contract.id === "flow_tracer") {
        return { status: "failed", reason: "optional inspection unavailable" };
      }

      return { status: "succeeded" };
    },
  });

  assert.deepEqual(started, ["flow_tracer", "final_reviewer"]);
  assert.deepEqual(result.completedAgentIds, ["final_reviewer"]);
  assert.deepEqual(result.failedAgentIds, ["flow_tracer"]);
  assert.deepEqual(result.blockedAgentIds, []);
});

test("scheduler allows continuation when an optional dependency throws", async () => {
  const result = await scheduleAgentGraph({
    agents: [
      agent("flow_tracer", [], false),
      agent("final_reviewer", ["flow_tracer"]),
    ],
    maxParallelism: 2,
    runAgent: async (contract) => {
      if (contract.id === "flow_tracer") {
        throw new Error("runner crashed");
      }

      return { status: "succeeded" };
    },
  });

  assert.deepEqual(result.completedAgentIds, ["final_reviewer"]);
  assert.deepEqual(result.failedAgentIds, ["flow_tracer"]);
  assert.deepEqual(result.blockedAgentIds, []);
});

test("scheduler launches ready agents in deterministic input order", async () => {
  const started: string[] = [];

  const result = await scheduleAgentGraph({
    agents: [
      agent("scout"),
      agent("architecture", ["scout"]),
      agent("pattern_miner", ["scout"]),
      agent("qa_verifier", ["architecture", "pattern_miner"]),
    ],
    maxParallelism: 2,
    runAgent: async (contract) => {
      started.push(contract.id);
      return { status: "succeeded" };
    },
  });

  assert.deepEqual(started, [
    "scout",
    "architecture",
    "pattern_miner",
    "qa_verifier",
  ]);
  assert.deepEqual(result.completedAgentIds, started);
});
