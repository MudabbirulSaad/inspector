import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAllowedValidationCommand,
  runAllowedValidationCommand,
} from "../../src/application/index.js";
import type {
  ProcessRunner,
  ProcessRunRequest,
  ProcessRunResult,
} from "../../src/ports/index.js";

test("validation command policy allows known npm validation commands", () => {
  assert.deepEqual(parseAllowedValidationCommand("npm test"), {
    command: "npm",
    args: ["test"],
  });
});

test("validation command policy allows the supported validation command set", () => {
  const allowed = [
    ["npm test", { command: "npm", args: ["test"] }],
    ["npm run typecheck", { command: "npm", args: ["run", "typecheck"] }],
    ["npm run lint", { command: "npm", args: ["run", "lint"] }],
    ["npm run build", { command: "npm", args: ["run", "build"] }],
    ["pnpm test", { command: "pnpm", args: ["test"] }],
    ["pnpm typecheck", { command: "pnpm", args: ["typecheck"] }],
    ["pnpm lint", { command: "pnpm", args: ["lint"] }],
    ["pnpm build", { command: "pnpm", args: ["build"] }],
    ["pytest", { command: "pytest", args: [] }],
    ["uv run pytest", { command: "uv", args: ["run", "pytest"] }],
  ] as const;

  for (const [input, parsed] of allowed) {
    assert.deepEqual(parseAllowedValidationCommand(input), parsed);
  }
});

test("validation command policy rejects destructive or publishing commands", () => {
  const blocked = [
    "rm -rf dist",
    "git push",
    "npm publish",
    "npm run deploy",
    "psql -c DROP DATABASE inspector",
  ];

  for (const input of blocked) {
    assert.throws(
      () => parseAllowedValidationCommand(input),
      /Validation command is not allowed:/,
    );
  }
});

test("validation command policy reports dangerous shell syntax clearly", () => {
  const dangerous = [
    "npm test && rm -rf dist",
    "npm test; git push",
    "npm test | tee output.log",
    "npm test $(whoami)",
    "npm test `whoami`",
    "npm test > output.log",
  ];

  for (const input of dangerous) {
    assert.throws(
      () => parseAllowedValidationCommand(input),
      /Dangerous shell syntax is not allowed in validation commands:/,
    );
  }
});

test("validation command runner parses before executing through the process port", async () => {
  const runner = new RecordingProcessRunner();

  const result = await runAllowedValidationCommand({
    command: "npm run lint",
    cwd: "/repo",
    runner,
    timeoutMs: 1000,
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(runner.requests, [
    {
      command: "npm",
      args: ["run", "lint"],
      cwd: "/repo",
      timeoutMs: 1000,
    },
  ]);
});

test("validation command runner does not execute unknown commands", async () => {
  const runner = new RecordingProcessRunner();

  await assert.rejects(
    () =>
      runAllowedValidationCommand({
        command: "node script.js",
        cwd: "/repo",
        runner,
      }),
    /Validation command is not allowed: node script.js/,
  );
  assert.deepEqual(runner.requests, []);
});

class RecordingProcessRunner implements ProcessRunner {
  readonly requests: ProcessRunRequest[] = [];

  async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    this.requests.push(request);
    return {
      stdout: "ok\n",
      stderr: "",
      exitCode: 0,
      startedAt: "2026-06-20T00:00:00.000Z",
      completedAt: "2026-06-20T00:00:01.000Z",
      streamingEvents: [],
    };
  }
}
