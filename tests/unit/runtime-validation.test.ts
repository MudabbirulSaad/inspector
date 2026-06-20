import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createSchemaContractValidators } from "../../src/validation/index.js";

type JsonObject = Record<string, unknown>;

const runtimeContracts = [
  "scout-output",
  "architecture-output",
  "pattern-miner-output",
  "flow-tracer-output",
  "finding",
  "qa-result",
  "knowledge-card",
  "memory-event",
  "qa-issue",
  "inspection-report",
] as const;

async function readExample(contract: string): Promise<JsonObject> {
  return JSON.parse(
    await readFile(`examples/${contract}.example.json`, "utf8"),
  ) as JsonObject;
}

test("runtime validators accept a valid finding example", async () => {
  const validators = await createSchemaContractValidators();
  const result = validators.finding.validate(await readExample("finding"));

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("runtime validators return clear errors for an invalid finding", async () => {
  const validators = await createSchemaContractValidators();
  const finding = await readExample("finding");
  const invalidFinding = { ...finding, evidence: [] };

  const result = validators.finding.validate(invalidFinding);

  assert.equal(result.valid, false);
  assert.match(result.errors[0]?.message ?? "", /Finding \/evidence/);
  assert.match(result.errors[0]?.message ?? "", /fewer than 1 items/);
});

test("runtime validators accept valid examples for every agent output contract", async () => {
  const validators = await createSchemaContractValidators();

  for (const contract of runtimeContracts) {
    const result = validators[contract].validate(await readExample(contract));
    assert.equal(result.valid, true, `${contract} example should be valid`);
    assert.deepEqual(result.errors, []);
  }
});

test("runtime validators reject invalid artifacts for every agent output contract", async () => {
  const validators = await createSchemaContractValidators();
  const invalidArtifacts = {
    "scout-output": {
      ...(await readExample("scout-output")),
      projectType: { value: "Node.js", evidence: [] },
    },
    "architecture-output": {
      ...(await readExample("architecture-output")),
      layerMap: [],
    },
    "pattern-miner-output": {
      ...(await readExample("pattern-miner-output")),
      patterns: [
        {
          ...((await readExample("pattern-miner-output")).patterns as JsonObject[])[0],
          tradeoffs: [],
        },
      ],
    },
    "flow-tracer-output": {
      ...(await readExample("flow-tracer-output")),
      flows: [
        {
          ...((await readExample("flow-tracer-output")).flows as JsonObject[])[0],
          dataPath: [],
        },
      ],
    },
    finding: { ...(await readExample("finding")), confidence: 1.5 },
    "qa-result": { ...(await readExample("qa-result")), status: "unknown" },
    "knowledge-card": {
      ...(await readExample("knowledge-card")),
      tags: ["architecture", "architecture"],
    },
    "memory-event": {
      ...(await readExample("memory-event")),
      timestamp: "not-a-date",
    },
    "qa-issue": {
      ...(await readExample("qa-issue")),
      status: "passed",
    },
    "inspection-report": {
      ...(await readExample("inspection-report")),
      generatedAt: "not-a-date",
    },
  };

  for (const contract of runtimeContracts) {
    const result = validators[contract].validate(invalidArtifacts[contract]);
    assert.equal(result.valid, false, `${contract} artifact should be invalid`);
    assert.equal(result.errors[0]?.contract, contract);
    assert.notEqual(result.errors[0]?.path, undefined);
    assert.match(result.errors[0]?.message ?? "", /\//);
  }
});
