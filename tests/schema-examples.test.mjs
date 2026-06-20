import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const contracts = [
  "evidence",
  "scout-output",
  "architecture-output",
  "pattern-miner-output",
  "flow-tracer-output",
  "testing-strategy-output",
  "finding",
  "qa-result",
  "qa-issue",
  "revision-request",
  "knowledge-card",
  "memory-event",
  "repository-target",
  "agent-attempt",
  "run-config",
  "inspection-run",
  "inspection-report",
];

test("agent output examples validate against their JSON schemas", async () => {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  const schemas = new Map();

  for (const contract of contracts) {
    const schema = JSON.parse(
      await readFile(`schemas/${contract}.schema.json`, "utf8"),
    );
    schemas.set(contract, schema);
    ajv.addSchema(schema);
  }

  for (const contract of contracts) {
    const schema = schemas.get(contract);
    const example = JSON.parse(
      await readFile(`examples/${contract}.example.json`, "utf8"),
    );

    const validate = ajv.compile(schema);
    assert.equal(
      validate(example),
      true,
      `${contract} example failed validation: ${ajv.errorsText(validate.errors)}`,
    );
  }
});
