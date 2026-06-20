import assert from "node:assert/strict";
import test from "node:test";

import { agentOutputContracts } from "../src/domain/contracts.js";

test("domain exposes the supported agent output contract names", () => {
  assert.deepEqual(agentOutputContracts, [
    "finding",
    "qa-result",
    "knowledge-card",
    "memory-event",
    "inspection-report",
  ]);
});
