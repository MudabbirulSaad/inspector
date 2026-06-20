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
    ["scout", "architecture", "pattern_miner", "qa_verifier", "final_reviewer"],
  );

  assert.deepEqual(
    contracts.map((contract) => ({
      id: contract.id,
      outputSchema: contract.outputSchema,
      required: contract.required,
    })),
    [
      { id: "scout", outputSchema: "finding", required: true },
      { id: "architecture", outputSchema: "finding", required: true },
      { id: "pattern_miner", outputSchema: "finding", required: true },
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
    [
      "flow_tracer",
      "testing_strategy",
      "tradeoff_analyst",
      "rag_card_distiller",
    ],
  );

  assert.deepEqual(
    laterContracts.map((contract) => ({
      id: contract.id,
      outputSchema: contract.outputSchema,
      required: contract.required,
    })),
    [
      { id: "flow_tracer", outputSchema: "finding", required: false },
      { id: "testing_strategy", outputSchema: "finding", required: false },
      { id: "tradeoff_analyst", outputSchema: "finding", required: false },
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
    pattern_miner: ["scout"],
    qa_verifier: ["architecture", "pattern_miner"],
    final_reviewer: ["qa_verifier"],
  });
});

test("agent registry returns contracts in deterministic execution order", () => {
  const expectedOrder = [
    "scout",
    "architecture",
    "pattern_miner",
    "qa_verifier",
    "final_reviewer",
    "flow_tracer",
    "testing_strategy",
    "tradeoff_analyst",
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

test("agent registry callers cannot mutate stored contract definitions", () => {
  const [scout] = getAgentContracts();
  assert.ok(scout);
  scout.dependencies.push("final_reviewer");
  scout.outputArtifacts.push("unexpected.json");
  scout.qaRevisionOwnership.ownsRevisionFor.push("final_reviewer");

  assert.deepEqual(getAgentContract("scout").dependencies, []);
  assert.deepEqual(getAgentContract("scout").outputArtifacts, [
    "agents/scout/findings.json",
  ]);
  assert.deepEqual(getAgentContract("scout").qaRevisionOwnership, {
    ownsRevisionFor: ["scout"],
  });
});
