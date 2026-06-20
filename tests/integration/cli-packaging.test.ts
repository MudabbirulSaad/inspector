import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

import { runInspectorCli } from "../../src/adapters/cli/index.js";

const execFileAsync = promisify(execFile);

test("CLI help prints usage without starting an inspection", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const result = await runInspectorCli({
    argv: ["--help"],
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(stderr.length, 0);
  assert.match(stdout.join("\n"), /Usage: inspector <command>/);
  assert.match(stdout.join("\n"), /run <repo-path> --objective <objective-file> --out <output-path>/);
  assert.match(stdout.join("\n"), /status <run-dir>/);
  assert.match(stdout.join("\n"), /resume <run-dir>/);
});

test("package metadata keeps the CLI private and points bin at the built executable", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    private?: boolean;
    files?: string[];
    exports?: string;
    main?: string;
    bin?: Record<string, string>;
    scripts?: Record<string, string>;
  };

  assert.equal(packageJson.private, true);
  assert.equal(packageJson.main, "./dist/index.js");
  assert.equal(packageJson.exports, "./dist/index.js");
  assert.deepEqual(packageJson.bin, { inspector: "./dist/main.js" });
  assert.deepEqual(packageJson.files, [
    "dist/",
    "prompts/",
    "schemas/",
    "examples/",
    "docs/",
    "README.md",
  ]);
  assert.equal(packageJson.scripts?.dev, "tsx src/main.ts");
});

test("built CLI entrypoint shows help and package exports load", async () => {
  await execFileAsync("npm", ["run", "build"]);

  const help = await execFileAsync(process.execPath, ["dist/main.js", "--help"]);
  assert.equal(help.stderr, "");
  assert.match(help.stdout, /Usage: inspector <command>/);

  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    exports?: string;
  };
  const packageExports = (await import(`../..${packageJson.exports?.slice(1)}`)) as {
    sourceBoundaries?: unknown;
  };
  assert.deepEqual(packageExports.sourceBoundaries, [
    "domain",
    "application",
    "ports",
    "adapters",
    "agents",
    "validation",
    "memory",
    "writers",
    "shared",
  ]);
});
