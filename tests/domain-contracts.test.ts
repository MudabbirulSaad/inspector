import assert from "node:assert/strict";
import test from "node:test";

import {
  agentOutputContracts,
  domainModelContracts,
} from "../src/domain/contracts.js";

test("domain exposes the supported agent output contract names", () => {
  assert.deepEqual(agentOutputContracts, [
    "finding",
    "qa-result",
    "knowledge-card",
    "memory-event",
    "inspection-report",
  ]);
});

test("domain exposes schema-backed model contract names", () => {
  assert.deepEqual(domainModelContracts, [
    "evidence",
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
  ]);
});
