import assert from "node:assert/strict";
import test from "node:test";
import { execPath } from "node:process";

import { executeAgentRun } from "../../src/application/index.js";
import {
  FakeAgentRunner,
  ProcessCodexAgentRunner,
} from "../../src/adapters/codex/index.js";
import { NodeProcessRunner } from "../../src/adapters/process/index.js";
import type {
  AgentRunner,
  AgentRunRequest,
  AgentRunResult,
} from "../../src/ports/index.js";

test("fake agent runner returns a configured successful result", async () => {
  const runner = new FakeAgentRunner({
    results: [
      {
        stdout: "inspection complete",
        stderr: "",
        exitCode: 0,
        startedAt: "2026-06-20T00:00:00.000Z",
        completedAt: "2026-06-20T00:00:01.000Z",
        outputArtifactPaths: ["agents/scout/attempt-1/output.json"],
        streamingEvents: [],
      },
    ],
  });

  const result = await runner.runAgent({
    agentId: "scout",
    attempt: 1,
    prompt: "Inspect repository.",
    workspaceRoot: "/tmp/inspection-run",
  });

  assert.equal(result.stdout, "inspection complete");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(result.startedAt, "2026-06-20T00:00:00.000Z");
  assert.equal(result.completedAt, "2026-06-20T00:00:01.000Z");
  assert.deepEqual(result.outputArtifactPaths, [
    "agents/scout/attempt-1/output.json",
  ]);
  assert.deepEqual(result.streamingEvents, []);
  assert.equal(result.failureReason, undefined);
});

test("fake agent runner returns a configured failed result", async () => {
  const runner = new FakeAgentRunner({
    results: [
      {
        stdout: "partial output",
        stderr: "codex failed",
        exitCode: 2,
        startedAt: "2026-06-20T00:00:00.000Z",
        completedAt: "2026-06-20T00:00:02.000Z",
        outputArtifactPaths: [],
        streamingEvents: [],
        failureReason: "agent exited with code 2",
      },
    ],
  });

  const result = await runner.runAgent({
    agentId: "architecture",
    attempt: 1,
    prompt: "Inspect boundaries.",
    workspaceRoot: "/tmp/inspection-run",
  });

  assert.equal(result.stdout, "partial output");
  assert.equal(result.stderr, "codex failed");
  assert.equal(result.exitCode, 2);
  assert.deepEqual(result.outputArtifactPaths, []);
  assert.deepEqual(result.streamingEvents, []);
  assert.equal(result.failureReason, "agent exited with code 2");
});

test("fake agent runner emits configured streaming events and returns them in the result", async () => {
  const runner = new FakeAgentRunner({
    results: [
      {
        stdout: "line one\n",
        stderr: "",
        exitCode: 0,
        startedAt: "2026-06-20T00:00:00.000Z",
        completedAt: "2026-06-20T00:00:03.000Z",
        outputArtifactPaths: ["agents/scout/attempt-1/output.json"],
        streamingEvents: [
          {
            timestamp: "2026-06-20T00:00:00.500Z",
            kind: "stdout",
            message: "line one",
          },
          {
            timestamp: "2026-06-20T00:00:02.000Z",
            kind: "artifact",
            message: "wrote output",
            artifactPath: "agents/scout/attempt-1/output.json",
          },
        ],
      },
    ],
  });
  const capturedEvents: unknown[] = [];

  const result = await runner.runAgent({
    agentId: "scout",
    attempt: 1,
    prompt: "Inspect repository.",
    workspaceRoot: "/tmp/inspection-run",
    onStreamingEvent: (event) => {
      capturedEvents.push(event);
    },
  });

  assert.deepEqual(capturedEvents, result.streamingEvents);
  assert.deepEqual(result.streamingEvents, [
    {
      timestamp: "2026-06-20T00:00:00.500Z",
      kind: "stdout",
      message: "line one",
    },
    {
      timestamp: "2026-06-20T00:00:02.000Z",
      kind: "artifact",
      message: "wrote output",
      artifactPath: "agents/scout/attempt-1/output.json",
    },
  ]);
});

test("application executes agents through the runner port", async () => {
  class RecordingRunner implements AgentRunner {
    request?: AgentRunRequest;

    async runAgent(request: AgentRunRequest): Promise<AgentRunResult> {
      this.request = request;

      return {
        stdout: "application result",
        stderr: "",
        exitCode: 0,
        startedAt: "2026-06-20T00:00:00.000Z",
        completedAt: "2026-06-20T00:00:04.000Z",
        outputArtifactPaths: ["agents/final_reviewer/attempt-1/output.json"],
        streamingEvents: [],
      };
    }
  }
  const runner = new RecordingRunner();

  const result = await executeAgentRun({
    runner,
    agentId: "final_reviewer",
    attempt: 1,
    prompt: "Review accepted findings.",
    workspaceRoot: "/tmp/inspection-run",
  });

  assert.equal(runner.request?.agentId, "final_reviewer");
  assert.equal(runner.request?.prompt, "Review accepted findings.");
  assert.equal(result.stdout, "application result");
  assert.deepEqual(result.outputArtifactPaths, [
    "agents/final_reviewer/attempt-1/output.json",
  ]);
});

test("process Codex agent runner uses an explicitly configured command", async () => {
  const runner = new ProcessCodexAgentRunner({
    processRunner: new NodeProcessRunner(),
    command: execPath,
    args: ["-e", "console.log(`prompt:${process.argv[1]}`)", "{prompt}"],
    outputArtifactPaths: ["agents/scout/attempt-1/output.json"],
  });

  const result = await runner.runAgent({
    agentId: "scout",
    attempt: 1,
    prompt: "Inspect repository.",
    workspaceRoot: process.cwd(),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "prompt:Inspect repository.\n");
  assert.equal(result.stderr, "");
  assert.deepEqual(result.outputArtifactPaths, [
    "agents/scout/attempt-1/output.json",
  ]);
  assert.equal(result.failureReason, undefined);
});

test("process Codex agent runner streams stdout and stderr events", async () => {
  const runner = new ProcessCodexAgentRunner({
    processRunner: new NodeProcessRunner(),
    command: execPath,
    args: [
      "-e",
      "process.stdout.write('agent stdout'); process.stderr.write('agent stderr')",
    ],
  });
  const capturedEvents: unknown[] = [];

  const result = await runner.runAgent({
    agentId: "architecture",
    attempt: 2,
    prompt: "Inspect architecture.",
    workspaceRoot: process.cwd(),
    onStreamingEvent: (event) => {
      capturedEvents.push(event);
    },
  });

  assert.equal(result.stdout, "agent stdout");
  assert.equal(result.stderr, "agent stderr");
  assert.deepEqual(
    result.streamingEvents.map((event) => ({
      kind: event.kind,
      message: event.message,
    })),
    [
      { kind: "stdout", message: "agent stdout" },
      { kind: "stderr", message: "agent stderr" },
    ],
  );
  assert.deepEqual(capturedEvents, result.streamingEvents);
});

test("process Codex agent runner returns a structured failed result", async () => {
  const runner = new ProcessCodexAgentRunner({
    processRunner: new NodeProcessRunner(),
    command: execPath,
    args: [
      "-e",
      "console.log('agent partial'); console.error('agent failed'); process.exit(4)",
    ],
  });

  const result = await runner.runAgent({
    agentId: "pattern_miner",
    attempt: 1,
    prompt: "Inspect patterns.",
    workspaceRoot: process.cwd(),
  });

  assert.equal(result.exitCode, 4);
  assert.equal(result.stdout, "agent partial\n");
  assert.equal(result.stderr, "agent failed\n");
  assert.equal(result.failureReason, "process exited with code 4");
});

test("process Codex agent runner times out configured commands", async () => {
  const runner = new ProcessCodexAgentRunner({
    processRunner: new NodeProcessRunner(),
    command: execPath,
    args: ["-e", "setTimeout(() => console.log('too late'), 200)"],
    timeoutMs: 10,
  });

  const result = await runner.runAgent({
    agentId: "qa_verifier",
    attempt: 1,
    prompt: "Verify findings.",
    workspaceRoot: process.cwd(),
  });

  assert.notEqual(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.failureReason, "process timed out after 10ms");
});
