import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import React from "react";
import { render } from "ink-testing-library";

import { CurrentActivity } from "../../src/adapters/tui/components/CurrentActivity.js";
import { StepList } from "../../src/adapters/tui/components/StepList.js";
import { ConfirmDanger } from "../../src/adapters/tui/components/ConfirmDanger.js";
import {
  createInitialTuiState,
  reduceInspectionEvent,
} from "../../src/adapters/tui/state/event-reducer.js";

test("event reducer turns agent.started into running state", () => {
  const state = reduceInspectionEvent(createInitialTuiState(), {
    type: "agent.started",
    agentId: "scout",
    attempt: 1,
    task: "Map repository shape",
  });

  assert.equal(state.steps[0]?.agentId, "scout");
  assert.equal(state.steps[0]?.status, "running");
  assert.equal(state.steps[0]?.attempt, 1);
  assert.equal(state.currentActivity?.message, "Map repository shape");
});

test("event reducer turns schema and evidence pass into completed phase", () => {
  const afterSchema = reduceInspectionEvent(createInitialTuiState(), {
    type: "agent.schema.passed",
    agentId: "architecture",
    attempt: 1,
  });

  assert.equal(afterSchema.steps[1]?.status, "validating");

  const afterEvidence = reduceInspectionEvent(afterSchema, {
    type: "agent.evidence.passed",
    agentId: "architecture",
    attempt: 1,
    citedFiles: 4,
  });

  assert.equal(afterEvidence.steps[1]?.status, "completed");
});

test("event reducer records failure reason", () => {
  const state = reduceInspectionEvent(createInitialTuiState(), {
    type: "agent.failed",
    agentId: "testing_strategy",
    attempt: 1,
    reason: "command evidence contradicted quality gate claim",
  });

  assert.equal(state.steps[4]?.status, "failed");
  assert.equal(
    state.steps[4]?.failureReason,
    "command evidence contradicted quality gate claim",
  );
  assert.equal(
    state.error?.reason,
    "Testing Strategy failed: command evidence contradicted quality gate claim",
  );
});

test("StepList renders six specialist agents in order", () => {
  const { lastFrame, unmount } = render(
    React.createElement(StepList, { steps: createInitialTuiState().steps }),
  );

  const frame = lastFrame() ?? "";
  assert.match(
    frame,
    /Scout[\s\S]*Architecture[\s\S]*Pattern Miner[\s\S]*Flow Tracer[\s\S]*Testing Strategy[\s\S]*Tradeoff Analyst/,
  );
  assert.doesNotMatch(frame, /QA Verifier/);
  unmount();
});

test("CurrentActivity renders latest activity", () => {
  const { lastFrame, unmount } = render(
    React.createElement(CurrentActivity, {
      activity: {
        agentId: "pattern_miner",
        message: "Extracting reusable implementation patterns",
      },
    }),
  );

  assert.match(lastFrame() ?? "", /Extracting reusable implementation patterns/);
  unmount();
});

test("ConfirmDanger clearly renders safety warning text", () => {
  const { lastFrame, unmount } = render(
    React.createElement(ConfirmDanger, {
      codexMode: "full-auto",
      runQualityCommands: true,
    }),
  );

  const frame = lastFrame() ?? "";
  assert.match(frame, /Danger/i);
  assert.match(frame, /Codex full-auto/i);
  assert.match(frame, /trusted quality commands/i);
  assert.match(frame, /only trusted repositories/i);
  unmount();
});

test("TUI adapter stays presentation-only", async () => {
  const forbidden = [
    "runScoutArchitectureInspection",
    "resumeScoutArchitectureInspection",
    "ProcessCodexAgentRunner",
    "NodeProcessRunner",
  ];
  const files = [
    "app.tsx",
    "state/event-reducer.ts",
    "state/tui-state.ts",
    "components/Header.tsx",
    "components/StepList.tsx",
    "components/AgentStatusRow.tsx",
    "components/CurrentActivity.tsx",
    "components/RunSummary.tsx",
    "components/ErrorPanel.tsx",
    "components/ConfirmDanger.tsx",
  ];

  for (const file of files) {
    const source = await readFile(join("src/adapters/tui", file), "utf8");
    for (const name of forbidden) {
      assert.equal(
        source.includes(name),
        false,
        `${file} must not reference ${name}`,
      );
    }
  }
});
