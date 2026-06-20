import assert from "node:assert/strict";
import test from "node:test";

import { sourceBoundaries } from "../../src/index.js";
import { cliAdapterBoundary } from "../../src/adapters/cli/index.js";

test("source boundaries and CLI adapter module load", () => {
  assert.deepEqual(sourceBoundaries, [
    "domain",
    "application",
    "ports",
    "adapters",
    "agents",
    "validation",
    "memory",
    "writers",
    "shared",
  ]);
  assert.equal(cliAdapterBoundary, "adapters.cli");
});
