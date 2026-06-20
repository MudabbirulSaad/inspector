import assert from "node:assert/strict";
import test from "node:test";

import {
  getAgentContract,
  getAgentContracts,
  getAgentDependencyGraph,
} from "../../src/agents/index.js";

test("agent registry exposes the fixed V1 agent contracts", () => {
  const contracts = getAgentContracts({ lifecycle: "v1" });

  assert.deepEqual(
    contracts.map((contract) => contract.id),
    [
      "scout",
      "architecture",
      "pattern_miner",
      "flow_tracer",
      "testing_strategy",
      "tradeoff_analyst",
      "qa_verifier",
      "final_reviewer",
    ],
  );

  assert.deepEqual(
    contracts.map((contract) => ({
      id: contract.id,
      outputSchema: contract.outputSchema,
      required: contract.required,
    })),
    [
      { id: "scout", outputSchema: "scout-output", required: true },
      { id: "architecture", outputSchema: "architecture-output", required: true },
      {
        id: "pattern_miner",
        outputSchema: "pattern-miner-output",
        required: true,
      },
      {
        id: "flow_tracer",
        outputSchema: "flow-tracer-output",
        required: true,
      },
      {
        id: "testing_strategy",
        outputSchema: "testing-strategy-output",
        required: true,
      },
      {
        id: "tradeoff_analyst",
        outputSchema: "tradeoff-analyst-output",
        required: true,
      },
      { id: "qa_verifier", outputSchema: "qa-result", required: true },
      {
        id: "final_reviewer",
        outputSchema: "inspection-report",
        required: true,
      },
    ],
  );
});

test("agent registry resolves known agents and rejects unknown agents", () => {
  assert.equal(getAgentContract("scout").role, "repository scout");

  assert.throws(
    () => getAgentContract("unknown_agent"),
    /Unknown agent contract: unknown_agent/,
  );
});

test("agent registry separates required V1 agents from optional later agents", () => {
  const laterContracts = getAgentContracts({ lifecycle: "later" });

  assert.deepEqual(
    laterContracts.map((contract) => contract.id),
    ["rag_card_distiller"],
  );

  assert.deepEqual(
    laterContracts.map((contract) => ({
      id: contract.id,
      outputSchema: contract.outputSchema,
      required: contract.required,
    })),
    [
      {
        id: "rag_card_distiller",
        outputSchema: "knowledge-card",
        required: false,
      },
    ],
  );
});

test("agent registry exposes the dependency graph for scheduled execution", () => {
  assert.deepEqual(getAgentDependencyGraph({ lifecycle: "v1" }), {
    scout: [],
    architecture: ["scout"],
    pattern_miner: ["architecture"],
    flow_tracer: ["architecture", "pattern_miner"],
    testing_strategy: ["architecture", "pattern_miner", "flow_tracer"],
    tradeoff_analyst: ["architecture", "pattern_miner", "testing_strategy"],
    qa_verifier: [
      "architecture",
      "pattern_miner",
      "flow_tracer",
      "testing_strategy",
      "tradeoff_analyst",
    ],
    final_reviewer: ["qa_verifier"],
  });
});

test("agent registry returns contracts in deterministic execution order", () => {
  const expectedOrder = [
    "scout",
    "architecture",
    "pattern_miner",
    "flow_tracer",
    "testing_strategy",
    "tradeoff_analyst",
    "qa_verifier",
    "final_reviewer",
    "rag_card_distiller",
  ];

  assert.deepEqual(
    getAgentContracts().map((contract) => contract.id),
    expectedOrder,
  );
  assert.deepEqual(
    getAgentContracts().map((contract) => contract.id),
    expectedOrder,
  );
});

test("every agent contract defines scheduling, artifact, retry, and revision ownership fields", () => {
  for (const contract of getAgentContracts()) {
    assert.notEqual(contract.role, "");
    assert.notEqual(contract.description, "");
    assert.ok(Array.isArray(contract.dependencies));
    assert.ok(contract.outputArtifacts.length > 0);
    assert.ok(contract.retryPolicy.maxAttempts >= 1);
    assert.ok(contract.retryPolicy.retryableFailures.length > 0);
    assert.ok(Array.isArray(contract.qaRevisionOwnership.ownsRevisionFor));
  }
});

test("agent registry output artifacts match the attempt-based runtime layout", () => {
  assert.deepEqual(getAgentContract("scout").outputArtifacts, [
    "agents/scout/attempt-{attempt}/output.json",
  ]);
  assert.deepEqual(getAgentContract("architecture").outputArtifacts, [
    "agents/architecture/attempt-{attempt}/output.json",
  ]);
  assert.deepEqual(getAgentContract("pattern_miner").outputArtifacts, [
    "agents/pattern_miner/attempt-{attempt}/output.json",
  ]);
  assert.deepEqual(getAgentContract("flow_tracer").outputArtifacts, [
    "agents/flow_tracer/attempt-{attempt}/output.json",
  ]);
  assert.deepEqual(getAgentContract("testing_strategy").outputArtifacts, [
    "agents/testing_strategy/attempt-{attempt}/output.json",
  ]);
  assert.deepEqual(getAgentContract("tradeoff_analyst").outputArtifacts, [
    "agents/tradeoff_analyst/attempt-{attempt}/output.json",
  ]);
  assert.deepEqual(getAgentContract("qa_verifier").outputArtifacts, [
    "qa/results.json",
  ]);
  assert.deepEqual(getAgentContract("final_reviewer").outputArtifacts, [
    "final/inspection-report.json",
    "final/case-study.md",
  ]);
});

test("agent registry callers cannot mutate stored contract definitions", () => {
  const [scout] = getAgentContracts();
  assert.ok(scout);
  scout.dependencies.push("final_reviewer");
  scout.outputArtifacts.push("unexpected.json");
  scout.qaRevisionOwnership.ownsRevisionFor.push("final_reviewer");

  assert.deepEqual(getAgentContract("scout").dependencies, []);
  assert.deepEqual(getAgentContract("scout").outputArtifacts, [
    "agents/scout/attempt-{attempt}/output.json",
  ]);
  assert.deepEqual(getAgentContract("scout").qaRevisionOwnership, {
    ownsRevisionFor: ["scout"],
  });
});
