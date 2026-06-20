import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  createInspectionRunWorkspace,
  type Clock,
  type RunConfig,
} from "../../src/index.js";
import {
  NodeRunDataWorkspaceStore,
  NodeRunWorkspaceStore,
  NodeUserDataDirectoryProvider,
} from "../../src/adapters/filesystem/index.js";

const fixedClock: Clock = {
  now: () => new Date("2026-06-20T01:02:03.004Z"),
};

const expectedFolders = [
  "input",
  "repo_index",
  "memory",
  "agents",
  "validation",
  "qa",
  "final",
] as const;

function createRunConfig(outputDirectory: string): RunConfig {
  return {
    target: {
      name: "Example Service",
      root: "./example-service",
      commit: "abc1234",
    },
    outputDirectory,
    agentRoles: ["architecture", "qa"],
    validationCommands: ["npm test"],
    verbose: true,
  };
}

test("creates an auditable inspection run workspace", async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "inspector-run-"));
  const outputDirectory = join(tempDirectory, ".inspector-runs");
  const config = createRunConfig(outputDirectory);

  const workspace = await createInspectionRunWorkspace({
    config,
    clock: fixedClock,
    workspaces: new NodeRunWorkspaceStore(),
  });

  assert.equal(
    workspace.name,
    "2026-06-20T01-02-03-004Z_example-service",
  );
  assert.equal(workspace.root, join(outputDirectory, workspace.name));

  const configJson = JSON.parse(
    await readFile(join(workspace.root, "config.json"), "utf8"),
  ) as RunConfig;
  assert.deepEqual(configJson, config);

  for (const folder of expectedFolders) {
    assert.equal((await stat(join(workspace.root, folder))).isDirectory(), true);
  }
});

test("falls back to a repository slug when target name has no slug characters", async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "inspector-run-"));
  const outputDirectory = join(tempDirectory, ".inspector-runs");
  const config = {
    ...createRunConfig(outputDirectory),
    target: {
      name: "!!!",
      root: "./punctuation-repository",
      commit: "abc1234",
    },
  };

  const workspace = await createInspectionRunWorkspace({
    config,
    clock: fixedClock,
    workspaces: new NodeRunWorkspaceStore(),
  });

  assert.equal(workspace.name, "2026-06-20T01-02-03-004Z_repository");

  const configJson = JSON.parse(
    await readFile(join(workspace.root, "config.json"), "utf8"),
  ) as RunConfig;
  assert.deepEqual(configJson, config);

  for (const folder of expectedFolders) {
    assert.equal((await stat(join(workspace.root, folder))).isDirectory(), true);
  }
});

test("creates a unique workspace when the timestamped folder already exists", async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "inspector-run-"));
  const outputDirectory = join(tempDirectory, ".inspector-runs");
  const config = createRunConfig(outputDirectory);
  const existingWorkspace = join(
    outputDirectory,
    "2026-06-20T01-02-03-004Z_example-service",
  );

  await mkdir(existingWorkspace, { recursive: true });
  await writeFile(join(existingWorkspace, "user-note.txt"), "do not delete");

  const workspace = await createInspectionRunWorkspace({
    config,
    clock: fixedClock,
    workspaces: new NodeRunWorkspaceStore(),
  });

  assert.equal(
    workspace.name,
    "2026-06-20T01-02-03-004Z_example-service_2",
  );
  assert.equal(
    await readFile(join(existingWorkspace, "user-note.txt"), "utf8"),
    "do not delete",
  );
  assert.equal((await stat(join(workspace.root, "config.json"))).isFile(), true);
});

test("rejects an invalid output path without deleting the existing file", async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "inspector-run-"));
  const outputDirectory = join(tempDirectory, ".inspector-runs");
  await writeFile(outputDirectory, "user data");

  await assert.rejects(
    createInspectionRunWorkspace({
      config: createRunConfig(outputDirectory),
      clock: fixedClock,
      workspaces: new NodeRunWorkspaceStore(),
    }),
    /Cannot create inspection run workspace/,
  );

  assert.equal(await readFile(outputDirectory, "utf8"), "user data");
});

test("user data provider returns platform-appropriate inspector data root", async () => {
  assert.equal(
    await new NodeUserDataDirectoryProvider({
      platform: "linux",
      env: { XDG_DATA_HOME: "/tmp/xdg-data" },
      homeDirectory: "/home/example",
    }).getInspectorDataRoot(),
    "/tmp/xdg-data/inspector",
  );
  assert.equal(
    await new NodeUserDataDirectoryProvider({
      platform: "linux",
      env: {},
      homeDirectory: "/home/example",
    }).getInspectorDataRoot(),
    "/home/example/.local/share/inspector",
  );
  assert.equal(
    await new NodeUserDataDirectoryProvider({
      platform: "darwin",
      env: {},
      homeDirectory: "/Users/example",
    }).getInspectorDataRoot(),
    "/Users/example/Library/Application Support/inspector",
  );
  assert.equal(
    await new NodeUserDataDirectoryProvider({
      platform: "win32",
      env: { APPDATA: "C:\\Users\\Example\\AppData\\Roaming" },
      homeDirectory: "C:\\Users\\Example",
    }).getInspectorDataRoot(),
    "C:\\Users\\Example\\AppData\\Roaming/inspector",
  );
});

test("creates internal run data workspace under the user data root", async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "inspector-data-"));
  const config = createRunConfig(join(tempDirectory, "legacy-out"));
  const store = new NodeRunDataWorkspaceStore({
    dataRoot: join(tempDirectory, "inspector"),
  });

  const workspace = await createInspectionRunWorkspace({
    config,
    clock: fixedClock,
    workspaces: store,
  });

  assert.equal(
    workspace.root,
    join(
      tempDirectory,
      "inspector",
      "runs",
      "2026-06-20T01-02-03-004Z_example-service",
    ),
  );
  assert.equal((await stat(join(workspace.root, "config.json"))).isFile(), true);
});

test("writes and reads the last-run pointer", async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "inspector-data-"));
  const store = new NodeRunDataWorkspaceStore({
    dataRoot: join(tempDirectory, "inspector"),
  });

  assert.equal(await store.getLastRunPointer(), undefined);

  const runPath = join(tempDirectory, "inspector", "runs", "run-1");
  await store.writeLastRunPointer(runPath);

  assert.equal(await store.getLastRunPointer(), runPath);
});
