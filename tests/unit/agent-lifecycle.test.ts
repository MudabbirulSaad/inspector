import assert from "node:assert/strict";
import test from "node:test";

import {
  type AgentLifecycle,
  type AgentLifecycleStatus,
  createAgentLifecycle,
  serializeAgentLifecycleStatus,
  transitionAgentLifecycle,
} from "../../src/domain/agent-lifecycle.js";

function transitionThrough(
  lifecycle: AgentLifecycle,
  statuses: readonly AgentLifecycleStatus[],
): AgentLifecycle {
  return statuses.reduce(
    (current, status, index) =>
      transitionAgentLifecycle(current, {
        to: status,
        timestamp: `2026-06-20T10:${String(index + 1).padStart(2, "0")}:00.000Z`,
      }),
    lifecycle,
  );
}

test("agent lifecycle accepts the valid approval path and tracks the first attempt", () => {
  const lifecycle = transitionThrough(
    createAgentLifecycle({
      agentId: "architecture",
      timestamp: "2026-06-20T10:00:00.000Z",
    }),
    [
      "RUNNING",
      "OUTPUT_RECEIVED",
      "SCHEMA_VALIDATED",
      "EVIDENCE_VALIDATED",
      "QA_REVIEWED",
      "APPROVED",
    ],
  );

  assert.equal(lifecycle.status, "APPROVED");
  assert.equal(lifecycle.attempts, 1);
  assert.equal(lifecycle.history.length, 7);
});

test("agent lifecycle rejects invalid transitions without changing state", () => {
  const lifecycle = createAgentLifecycle({
    agentId: "scout",
    timestamp: "2026-06-20T10:00:00.000Z",
  });

  assert.throws(
    () =>
      transitionAgentLifecycle(lifecycle, {
        to: "SCHEMA_VALIDATED",
        timestamp: "2026-06-20T10:01:00.000Z",
      }),
    /Invalid agent lifecycle transition from PENDING to SCHEMA_VALIDATED/,
  );

  assert.equal(lifecycle.status, "PENDING");
  assert.equal(lifecycle.attempts, 0);
  assert.equal(lifecycle.history.length, 1);
});

test("agent lifecycle retries validation failures and increments attempts per run", () => {
  let lifecycle = createAgentLifecycle({
    agentId: "pattern_miner",
    timestamp: "2026-06-20T10:00:00.000Z",
  });

  for (const status of [
    "RUNNING",
    "OUTPUT_RECEIVED",
    "SCHEMA_FAILED",
    "RETRYING",
    "RUNNING",
  ] as const) {
    lifecycle = transitionAgentLifecycle(lifecycle, {
      to: status,
      timestamp: "2026-06-20T10:01:00.000Z",
      reason: status === "RETRYING" ? "schema output was invalid" : undefined,
    });
  }

  assert.equal(lifecycle.status, "RUNNING");
  assert.equal(lifecycle.attempts, 2);
  assert.equal(lifecycle.history.at(-2)?.reason, "schema output was invalid");
});

test("agent lifecycle can fail at evidence and QA gates before retrying", () => {
  const evidenceLifecycle = transitionThrough(
    createAgentLifecycle({
      agentId: "architecture",
      timestamp: "2026-06-20T10:00:00.000Z",
    }),
    [
      "RUNNING",
      "OUTPUT_RECEIVED",
      "SCHEMA_VALIDATED",
      "EVIDENCE_FAILED",
      "RETRYING",
    ],
  );

  const qaLifecycle = transitionThrough(
    createAgentLifecycle({
      agentId: "qa_verifier",
      timestamp: "2026-06-20T10:00:00.000Z",
    }),
    [
      "RUNNING",
      "OUTPUT_RECEIVED",
      "SCHEMA_VALIDATED",
      "EVIDENCE_VALIDATED",
      "QA_REVIEWED",
      "QA_FAILED",
      "RETRYING",
    ],
  );

  assert.equal(evidenceLifecycle.status, "RETRYING");
  assert.equal(qaLifecycle.status, "RETRYING");
});

test("agent lifecycle terminal states reject further transitions", () => {
  const approved = transitionThrough(
    createAgentLifecycle({
      agentId: "final_reviewer",
      timestamp: "2026-06-20T10:00:00.000Z",
    }),
    [
      "RUNNING",
      "OUTPUT_RECEIVED",
      "SCHEMA_VALIDATED",
      "EVIDENCE_VALIDATED",
      "QA_REVIEWED",
      "APPROVED",
    ],
  );

  const failed = transitionThrough(
    createAgentLifecycle({
      agentId: "scout",
      timestamp: "2026-06-20T10:00:00.000Z",
    }),
    ["RUNNING", "OUTPUT_RECEIVED", "SCHEMA_FAILED"],
  );
  const terminalFailed = transitionAgentLifecycle(failed, {
    to: "FAILED",
    timestamp: "2026-06-20T10:04:00.000Z",
  });

  assert.throws(
    () =>
      transitionAgentLifecycle(approved, {
        to: "RETRYING",
        timestamp: "2026-06-20T10:07:00.000Z",
      }),
    /Invalid agent lifecycle transition from APPROVED to RETRYING/,
  );
  assert.throws(
    () =>
      transitionAgentLifecycle(terminalFailed, {
        to: "RETRYING",
        timestamp: "2026-06-20T10:05:00.000Z",
      }),
    /Invalid agent lifecycle transition from FAILED to RETRYING/,
  );
});

test("agent lifecycle serializes status deterministically", () => {
  const lifecycle = transitionAgentLifecycle(
    createAgentLifecycle({
      agentId: "architecture",
      timestamp: "2026-06-20T10:00:00.000Z",
    }),
    {
      to: "RUNNING",
      timestamp: "2026-06-20T10:01:00.000Z",
    },
  );

  assert.equal(
    serializeAgentLifecycleStatus(lifecycle),
    JSON.stringify(
      {
        agentId: "architecture",
        status: "RUNNING",
        attempts: 1,
        createdAt: "2026-06-20T10:00:00.000Z",
        updatedAt: "2026-06-20T10:01:00.000Z",
        history: [
          {
            from: null,
            to: "PENDING",
            timestamp: "2026-06-20T10:00:00.000Z",
          },
          {
            from: "PENDING",
            to: "RUNNING",
            timestamp: "2026-06-20T10:01:00.000Z",
          },
        ],
      },
      null,
      2,
    ),
  );
});
