import assert from "node:assert/strict";
import test from "node:test";
import { execPath } from "node:process";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { NodeProcessRunner } from "../../src/adapters/process/index.js";

test("node process runner runs a configured command and captures stdout", async () => {
  const runner = new NodeProcessRunner();

  const result = await runner.run({
    command: execPath,
    args: ["-e", "console.log('process ok')"],
    cwd: process.cwd(),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "process ok\n");
  assert.equal(result.stderr, "");
  assert.match(result.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(result.completedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(result.failureReason, undefined);
});

test("node process runner returns a structured failed result for a non-zero exit", async () => {
  const runner = new NodeProcessRunner();

  const result = await runner.run({
    command: execPath,
    args: [
      "-e",
      "console.log('partial output'); console.error('failure details'); process.exit(7)",
    ],
    cwd: process.cwd(),
  });

  assert.equal(result.exitCode, 7);
  assert.equal(result.stdout, "partial output\n");
  assert.equal(result.stderr, "failure details\n");
  assert.equal(result.failureReason, "process exited with code 7");
});

test("node process runner executes commands in the requested working directory", async () => {
  const runner = new NodeProcessRunner();
  const cwd = await mkdtemp(join(tmpdir(), "inspector-process-runner-"));

  const result = await runner.run({
    command: execPath,
    args: ["-e", "console.log(process.cwd())"],
    cwd,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, `${cwd}\n`);
});

test("node process runner times out long-running commands", async () => {
  const runner = new NodeProcessRunner();

  const result = await runner.run({
    command: execPath,
    args: ["-e", "setTimeout(() => console.log('too late'), 200)"],
    cwd: process.cwd(),
    timeoutMs: 10,
  });

  assert.notEqual(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.failureReason, "process timed out after 10ms");
});

test("node process runner streams stdout and stderr events while capturing logs", async () => {
  const runner = new NodeProcessRunner();
  const capturedEvents: unknown[] = [];

  const result = await runner.run({
    command: execPath,
    args: [
      "-e",
      "process.stdout.write('streamed stdout'); process.stderr.write('streamed stderr')",
    ],
    cwd: process.cwd(),
    onStreamingEvent: (event) => {
      capturedEvents.push(event);
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "streamed stdout");
  assert.equal(result.stderr, "streamed stderr");
  assert.deepEqual(
    result.streamingEvents.map((event) => ({
      kind: event.kind,
      message: event.message,
    })),
    [
      { kind: "stdout", message: "streamed stdout" },
      { kind: "stderr", message: "streamed stderr" },
    ],
  );
  assert.deepEqual(capturedEvents, result.streamingEvents);
});
