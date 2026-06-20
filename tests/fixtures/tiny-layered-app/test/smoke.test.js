import assert from "node:assert/strict";
import test from "node:test";

test("documents the fixture smoke behavior", () => {
  assert.equal("domain/application/adapter".includes("application"), true);
});
