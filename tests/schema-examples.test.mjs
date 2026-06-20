import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const contracts = [
  "finding",
  "qa-result",
  "knowledge-card",
  "memory-event",
  "inspection-report",
];

test("agent output examples validate against their JSON schemas", async () => {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);

  for (const contract of contracts) {
    const schema = JSON.parse(
      await readFile(`schemas/${contract}.schema.json`, "utf8"),
    );
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
