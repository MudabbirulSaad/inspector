import assert from "node:assert/strict";
import test from "node:test";

import {
  agentOutputContracts,
  domainModelContracts,
} from "../src/domain/contracts.js";

test("domain exposes the supported agent output contract names", () => {
  assert.deepEqual(agentOutputContracts, [
    "scout-output",
    "architecture-output",
    "pattern-miner-output",
    "flow-tracer-output",
    "testing-strategy-output",
    "tradeoff-analyst-output",
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
    "scout-output",
    "architecture-output",
    "pattern-miner-output",
    "flow-tracer-output",
    "testing-strategy-output",
    "tradeoff-analyst-output",
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
