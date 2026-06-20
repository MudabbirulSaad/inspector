import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { runInspectorCli } from "../../src/adapters/cli/index.js";

const execFileAsync = promisify(execFile);

type PackFile = {
  path: string;
};

type PackResult = {
  filename: string;
  files: PackFile[];
};

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
    name?: string;
    private?: boolean;
    files?: string[];
    exports?: string;
    main?: string;
    bin?: Record<string, string>;
    scripts?: Record<string, string>;
  };

  assert.equal(packageJson.name, "codebase-inspector");
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

test("npm pack dry run includes the CLI build and excludes local inspection artifacts", async () => {
  await execFileAsync("npm", ["run", "build"]);

  const pack = await npmPackDryRun();
  const paths = pack.files.map((file) => file.path);

  assert.ok(paths.includes("dist/main.js"));
  assert.ok(paths.every((path) => !path.startsWith(".inspector-dogfood/")));
  assert.ok(paths.every((path) => !path.startsWith(".inspector-runs/")));
  assert.ok(paths.every((path) => !path.startsWith("tests/")));
  assert.ok(paths.every((path) => !path.startsWith("src/")));
  assert.ok(paths.every((path) => !path.startsWith("node_modules/")));
  assert.ok(paths.every((path) => !path.startsWith("coverage/")));
  assert.ok(paths.every((path) => !path.startsWith(".agents/")));
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

test("packed CLI shows help, runs the fake fixture pipeline, and exposes imports", async () => {
  await execFileAsync("npm", ["run", "build"]);

  const pack = await npmPack();
  const tempRoot = await mkdtemp(join(tmpdir(), "inspector-packed-cli-"));

  try {
    await writeFile(
      join(tempRoot, "package.json"),
      JSON.stringify({ type: "module", private: true }, undefined, 2),
    );
    await execFileAsync("npm", ["install", "--silent", resolve(pack.filename)], {
      cwd: tempRoot,
    });

    const binPath = join(tempRoot, "node_modules", ".bin", "inspector");
    const help = await execFileAsync(binPath, ["--help"], { cwd: tempRoot });
    assert.equal(help.stderr, "");
    assert.match(help.stdout, /Usage: inspector <command>/);

    const fixturePath = await createTinyFixture(tempRoot);
    const objectivePath = join(tempRoot, "objective.md");
    const outputPath = join(tempRoot, ".inspector-runs");
    await writeFile(objectivePath, "Inspect the packed CLI fixture with the fake runner.\n");

    const run = await execFileAsync(
      binPath,
      [
        "run",
        fixturePath,
        "--objective",
        objectivePath,
        "--out",
        outputPath,
      ],
      {
        cwd: tempRoot,
        env: {
          ...process.env,
          XDG_DATA_HOME: join(tempRoot, "xdg-data"),
        },
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    assert.equal(run.stderr, "");
    assert.match(run.stdout, /Inspection run workspace:/);
    await readFile(join(fixturePath, "docs", "inspector", "02-architecture-map.md"), "utf8");

    const imported = await execFileAsync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        "import { sourceBoundaries } from 'codebase-inspector'; console.log(sourceBoundaries.includes('adapters'));",
      ],
      { cwd: tempRoot },
    );
    assert.equal(imported.stderr, "");
    assert.equal(imported.stdout.trim(), "true");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(pack.filename, { force: true });
  }
});

test("README documents package name and fake versus real runner usage", async () => {
  const readme = await readFile("README.md", "utf8");

  assert.match(readme, /package name is `codebase-inspector`/i);
  assert.match(readme, /npx codebase-inspector/);
  assert.match(readme, /deterministic fake runner/i);
  assert.match(readme, /process-backed runner/i);
});

async function npmPackDryRun(): Promise<PackResult> {
  const result = await execFileAsync("npm", ["pack", "--dry-run", "--json"], {
    maxBuffer: 10 * 1024 * 1024,
  });
  const packs = JSON.parse(result.stdout) as PackResult[];
  assert.equal(packs.length, 1);
  return packs[0] as PackResult;
}

async function npmPack(): Promise<PackResult> {
  const result = await execFileAsync("npm", ["pack", "--json"], {
    maxBuffer: 10 * 1024 * 1024,
  });
  const packs = JSON.parse(result.stdout) as PackResult[];
  assert.equal(packs.length, 1);
  return packs[0] as PackResult;
}

async function createTinyFixture(tempRoot: string): Promise<string> {
  const fixturePath = join(tempRoot, "fixture");
  await mkdir(join(fixturePath, "src"), { recursive: true });
  await mkdir(join(fixturePath, "test"), { recursive: true });
  await writeFile(
    join(fixturePath, "package.json"),
    JSON.stringify(
      {
        name: "packed-fixture",
        private: true,
        type: "module",
        scripts: {
          test: "node test/smoke.test.js",
        },
      },
      undefined,
      2,
    ),
  );
  await writeFile(join(fixturePath, "README.md"), "# Packed Fixture\n");
  await writeFile(
    join(fixturePath, "src", "index.js"),
    "export function greet(name) { return `hello ${name}`; }\n",
  );
  await writeFile(
    join(fixturePath, "test", "smoke.test.js"),
    "import assert from 'node:assert/strict';\nimport { greet } from '../src/index.js';\nassert.equal(greet('cli'), 'hello cli');\n",
  );
  return fixturePath;
}
