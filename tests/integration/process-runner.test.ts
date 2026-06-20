import assert from "node:assert/strict";
import test from "node:test";

import { PlaceholderProcessRunner } from "../../src/adapters/process/index.js";

test("placeholder process runner reports that real command execution is not implemented", async () => {
  const runner = new PlaceholderProcessRunner();

  await assert.rejects(
    runner.run({
      command: "npm",
      args: ["test"],
      cwd: "/tmp/inspection-run",
    }),
    /ProcessRunner adapter is not implemented/,
  );
});
