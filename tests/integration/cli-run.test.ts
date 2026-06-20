import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chdir, cwd } from "node:process";
import test from "node:test";

import { FakeAgentRunner } from "../../src/adapters/codex/index.js";
import { runInspectorCli } from "../../src/adapters/cli/index.js";
import type { AgentRunResult, Clock } from "../../src/index.js";

const fixedClock: Clock = {
  now: () => new Date("2026-06-20T01:02:03.004Z"),
};

const scoutFinding = {
  id: "finding-scout-001",
  agent: "scout",
  severity: "info",
  claim: "The repository includes a README entrypoint for inspection context.",
  evidence: [
    {
      file: "README.md",
      lineStart: 1,
      lineEnd: 2,
    },
  ],
  recommendation: "Use the README as initial repository context.",
  confidence: 0.7,
};

const scoutOutput = {
  projectType: {
    value: "documentation-first TypeScript CLI",
    evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
  },
  detectedStack: [
    {
      name: "Node.js",
      evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
    },
  ],
  importantFiles: [
    {
      path: "README.md",
      reason: "Provides initial repository context.",
      evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
    },
  ],
  entryPoints: [
    {
      path: "README.md",
      kind: "documentation",
      evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
    },
  ],
  architectureImpression: {
    summary: "Initial evidence only supports a shallow repository impression.",
    evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
  },
  openQuestions: ["Which runtime entrypoint should deeper agents inspect first?"],
  findings: [scoutFinding],
};

const architectureFinding = {
  id: "finding-architecture-001",
  agent: "architecture",
  severity: "medium",
  claim: "The fixture keeps its only observed interface in README documentation.",
  evidence: [
    {
      file: "README.md",
      lineStart: 1,
      lineEnd: 2,
    },
  ],
  recommendation: "Inspect source files before assigning runtime architecture labels.",
  confidence: 0.6,
};

const architectureOutput = {
  layerMap: [
    {
      name: "Documentation layer",
      observedFacts: ["README.md provides the only visible repository context."],
      interpretation: "The fixture does not prove runtime layers.",
      evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
    },
  ],
  dependencyDirection: [
    {
      name: "Documentation consumed by inspector",
      source: "README.md",
      target: "inspector run",
      direction: "documentation is read by the inspection workflow",
      observedFacts: ["README.md is cited by Scout and Architecture."],
      interpretation: "No code dependency direction is proven by this fixture.",
      evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
    },
  ],
  moduleBoundaries: [
    {
      name: "README boundary",
      observedFacts: ["README.md is the only cited repository file."],
      interpretation: "Module boundaries remain unknown without source files.",
      evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
    },
  ],
  businessLogicLocations: [
    {
      name: "Business logic not observed",
      observedFacts: ["README.md contains context rather than executable rules."],
      interpretation: "No business logic location can be proven from this fixture.",
      evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
    },
  ],
  frameworkGlueLocations: [
    {
      name: "Framework glue not observed",
      observedFacts: ["README.md does not show framework bootstrapping."],
      interpretation: "No framework glue location can be proven from this fixture.",
      evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
    },
  ],
  architectureRisks: [
    {
      name: "Architecture evidence is shallow",
      observedFacts: ["Only README.md is cited by the fixture output."],
      interpretation: "Architecture findings should remain candidate findings.",
      evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
    },
  ],
  findings: [architectureFinding],
};

const patternMinerFinding = {
  id: "finding-pattern-miner-001",
  agent: "pattern_miner",
  severity: "info",
  claim: "The fixture repeats README-based evidence across prior inspection steps.",
  evidence: [
    {
      file: "README.md",
      lineStart: 1,
      lineEnd: 2,
    },
  ],
  recommendation:
    "Treat repeated README-only observations as low-depth context until source evidence exists.",
  confidence: 0.6,
};

const patternMinerOutput = {
  patterns: [
    {
      name: "README-only inspection evidence",
      problemSolved:
        "Keeps early inspection claims tied to the only repository file in the fixture.",
      implementationShape:
        "Scout, Architecture, and Pattern Miner all cite README.md before deeper source evidence exists.",
      evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
      tradeoffs: [
        "This pattern prevents unsupported claims but provides shallow architecture signal.",
      ],
      whenToUse: "Use when repository evidence is sparse and context must remain traceable.",
      whenNotToUse: "Avoid treating README-only evidence as proof of runtime architecture.",
      adaptationValue:
        "Future agents can preserve evidence discipline while requesting deeper source inspection.",
      tags: ["evidence", "inspection"],
      confidence: 0.7,
    },
  ],
  findings: [patternMinerFinding],
};

const flowTracerFinding = {
  id: "finding-flow-tracer-001",
  agent: "flow_tracer",
  severity: "info",
  claim: "The visible inspection flow starts from README context and produces run artifacts.",
  evidence: [
    {
      file: "README.md",
      lineStart: 1,
      lineEnd: 2,
    },
  ],
  recommendation:
    "Treat the README-backed flow as a shallow trace until source entrypoints are available.",
  confidence: 0.6,
  cardType: "flow",
};

const flowTracerOutput = {
  flows: [
    {
      name: "README inspection context flow",
      action: "User runs the inspector against a repository with README context.",
      entryPoint: {
        path: "README.md",
        evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
      },
      mainFiles: [
        {
          path: "README.md",
          role: "Only visible repository context in the fixture.",
          evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
        },
      ],
      dataPath: [
        {
          step: "README content is used as the initial repository context.",
          evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
        },
      ],
      sideEffects: [
        {
          description: "The inspection run writes auditable artifacts.",
          evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
        },
      ],
      persistencePath: [
        {
          description: "No repository persistence path is visible from the fixture.",
          evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
        },
      ],
      errorPaths: [
        {
          description: "No repository error path is visible from the fixture.",
          evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
        },
      ],
      tests: [
        {
          description: "No repository tests are visible from the fixture.",
          evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
        },
      ],
      evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
    },
  ],
  insufficientEvidence: [],
  findings: [flowTracerFinding],
};

function successfulScoutResult(stdout = JSON.stringify(scoutOutput)): AgentRunResult {
  return {
    stdout,
    stderr: "",
    exitCode: 0,
    startedAt: "2026-06-20T01:02:04.000Z",
    completedAt: "2026-06-20T01:02:05.000Z",
    outputArtifactPaths: [],
    streamingEvents: [],
  };
}

function successfulArchitectureResult(
  stdout = JSON.stringify(architectureOutput),
): AgentRunResult {
  return {
    stdout,
    stderr: "",
    exitCode: 0,
    startedAt: "2026-06-20T01:02:06.000Z",
    completedAt: "2026-06-20T01:02:07.000Z",
    outputArtifactPaths: [],
    streamingEvents: [],
  };
}

function successfulPatternMinerResult(
  stdout = JSON.stringify(patternMinerOutput),
): AgentRunResult {
  return {
    stdout,
    stderr: "",
    exitCode: 0,
    startedAt: "2026-06-20T01:02:08.000Z",
    completedAt: "2026-06-20T01:02:09.000Z",
    outputArtifactPaths: [],
    streamingEvents: [],
  };
}

function successfulFlowTracerResult(
  stdout = JSON.stringify(flowTracerOutput),
): AgentRunResult {
  return {
    stdout,
    stderr: "",
    exitCode: 0,
    startedAt: "2026-06-20T01:02:10.000Z",
    completedAt: "2026-06-20T01:02:11.000Z",
    outputArtifactPaths: [],
    streamingEvents: [],
  };
}

function successfulRunner(results: AgentRunResult[] = []): FakeAgentRunner {
  return new FakeAgentRunner({
    results: [
      successfulScoutResult(),
      successfulArchitectureResult(),
      successfulPatternMinerResult(),
      successfulFlowTracerResult(),
      ...results,
    ],
  });
}

async function createFixture(): Promise<{
  tempDirectory: string;
  repoPath: string;
  objectivePath: string;
  outPath: string;
}> {
  const tempDirectory = await mkdtemp(join(tmpdir(), "inspector-cli-run-"));
  const repoPath = join(tempDirectory, "target-repo");
  const objectivePath = join(tempDirectory, "objective.md");
  const outPath = join(tempDirectory, "runs");

  await mkdir(repoPath);
  await writeFile(join(repoPath, "README.md"), "# Target\n\nContext.\n");
  await writeFile(objectivePath, "Inspect the repository structure.\n");

  return { tempDirectory, repoPath, objectivePath, outPath };
}

test("CLI run creates a run workspace for a valid command", async () => {
  const fixture = await createFixture();
  const stdout: string[] = [];
  const stderr: string[] = [];

  const result = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      fixture.objectivePath,
      "--out",
      fixture.outPath,
    ],
    clock: fixedClock,
    runner: successfulRunner(),
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(stderr.length, 0);
  assert.equal(
    await readFile(
      join(
        fixture.outPath,
        "2026-06-20T01-02-03-004Z_target-repo",
        "repo_index",
        "file_tree.txt",
      ),
      "utf8",
    ),
    ".\nREADME.md\n",
  );
});

test("CLI run loads prompts and schemas when started outside the project root", async () => {
  const fixture = await createFixture();
  const unrelatedCwd = join(fixture.tempDirectory, "unrelated-cwd");
  await mkdir(unrelatedCwd);
  const originalCwd = cwd();

  try {
    chdir(unrelatedCwd);

    const result = await runInspectorCli({
      argv: [
        "run",
        fixture.repoPath,
        "--objective",
        fixture.objectivePath,
        "--out",
        fixture.outPath,
      ],
      clock: fixedClock,
      runner: successfulRunner(),
      stdout: () => undefined,
    });

    assert.equal(result.exitCode, 0);
    const workspaceRoot = join(
      fixture.outPath,
      "2026-06-20T01-02-03-004Z_target-repo",
    );
    assert.match(
      await readFile(
        join(workspaceRoot, "agents", "scout", "attempt-1", "prompt.md"),
        "utf8",
      ),
      /# Agent Prompt: scout/,
    );
    assert.match(
      await readFile(
        join(workspaceRoot, "validation", "scout", "attempt-1", "report.json"),
        "utf8",
      ),
      /"contract": "scout-output"/,
    );
  } finally {
    chdir(originalCwd);
  }
});

test("CLI run reports a missing repository path", async () => {
  const fixture = await createFixture();
  const stderr: string[] = [];

  const result = await runInspectorCli({
    argv: ["run", "--objective", fixture.objectivePath, "--out", fixture.outPath],
    clock: fixedClock,
    runner: successfulRunner(),
    stderr: (line) => stderr.push(line),
  });

  assert.equal(result.exitCode, 1);
  assert.match(stderr.join("\n"), /Missing repository path/);
});

test("CLI run reports a missing objective file", async () => {
  const fixture = await createFixture();
  const stderr: string[] = [];

  const result = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      join(fixture.tempDirectory, "missing-objective.md"),
      "--out",
      fixture.outPath,
    ],
    clock: fixedClock,
    runner: successfulRunner(),
    stderr: (line) => stderr.push(line),
  });

  assert.equal(result.exitCode, 1);
  assert.match(stderr.join("\n"), /Objective file does not exist/);
});

test("CLI run sends the objective to the fake Scout runner and saves Scout output", async () => {
  const fixture = await createFixture();
  const runner = successfulRunner();

  const result = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      fixture.objectivePath,
      "--out",
      fixture.outPath,
    ],
    clock: fixedClock,
    runner,
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(runner.requests.length, 4);
  assert.equal(runner.requests[0]?.agentId, "scout");
  assert.match(runner.requests[0]?.prompt ?? "", /Inspect the repository/);
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(
          fixture.outPath,
          "2026-06-20T01-02-03-004Z_target-repo",
          "agents",
          "scout",
          "attempt-1",
          "output.json",
        ),
        "utf8",
      ),
    ),
    scoutOutput,
  );
});

test("CLI run sends Scout a prompt containing repository index context and Scout rules", async () => {
  const fixture = await createFixture();
  const runner = successfulRunner();

  const result = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      fixture.objectivePath,
      "--out",
      fixture.outPath,
    ],
    clock: fixedClock,
    runner,
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 0);
  const prompt = runner.requests[0]?.prompt ?? "";
  assert.match(prompt, /# Agent Prompt: scout/);
  assert.match(prompt, /Repository Index Summary/);
  assert.match(prompt, /repo_summary/);
  assert.match(prompt, /README\.md/);
  assert.match(prompt, /Do not make deep unsupported claims/);
  assert.match(prompt, /projectType/);
});

test("CLI run sends Architecture a prompt containing Scout output and Architecture rules", async () => {
  const fixture = await createFixture();
  const runner = successfulRunner();

  const result = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      fixture.objectivePath,
      "--out",
      fixture.outPath,
    ],
    clock: fixedClock,
    runner,
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(runner.requests[1]?.agentId, "architecture");
  const prompt = runner.requests[1]?.prompt ?? "";
  assert.match(prompt, /# Agent Prompt: architecture/);
  assert.match(prompt, /Previous Outputs/);
  assert.match(prompt, /architectureImpression/);
  assert.match(prompt, /Architecture Agent Output Rules/);
  assert.match(prompt, /layerMap/);
});

test("CLI run sends Pattern Miner a prompt containing Scout and Architecture outputs", async () => {
  const fixture = await createFixture();
  const runner = successfulRunner();

  const result = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      fixture.objectivePath,
      "--out",
      fixture.outPath,
    ],
    clock: fixedClock,
    runner,
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(runner.requests[2]?.agentId, "pattern_miner");
  const prompt = runner.requests[2]?.prompt ?? "";
  assert.match(prompt, /# Agent Prompt: pattern_miner/);
  assert.match(prompt, /Previous Outputs/);
  assert.match(prompt, /architectureImpression/);
  assert.match(prompt, /layerMap/);
  assert.match(prompt, /Run initialized/);
  assert.match(prompt, /tradeoffs/);
  assert.match(prompt, /whenNotToUse/);
});

test("CLI run sends Flow Tracer a prompt containing prior specialist outputs", async () => {
  const fixture = await createFixture();
  const runner = successfulRunner();

  const result = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      fixture.objectivePath,
      "--out",
      fixture.outPath,
    ],
    clock: fixedClock,
    runner,
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(runner.requests[3]?.agentId, "flow_tracer");
  const prompt = runner.requests[3]?.prompt ?? "";
  assert.match(prompt, /# Agent Prompt: flow_tracer/);
  assert.match(prompt, /Previous Outputs/);
  assert.match(prompt, /layerMap/);
  assert.match(prompt, /patterns/);
  assert.match(prompt, /Flow Tracer Agent Output Rules/);
  assert.match(prompt, /persistencePath/);
});

test("CLI run writes repository, memory, schema, and evidence artifacts", async () => {
  const fixture = await createFixture();

  const result = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      fixture.objectivePath,
      "--out",
      fixture.outPath,
    ],
    clock: fixedClock,
    runner: successfulRunner(),
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 0);
  const workspaceRoot = join(
    fixture.outPath,
    "2026-06-20T01-02-03-004Z_target-repo",
  );

  assert.equal(
    (await stat(join(workspaceRoot, "repo_index", "repo_summary.json"))).isFile(),
    true,
  );
  assert.match(
    await readFile(join(workspaceRoot, "memory", "blackboard.md"), "utf8"),
    /Run initialized/,
  );
  assert.deepEqual(
    (await readFile(join(workspaceRoot, "memory", "findings.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as unknown),
    [scoutFinding, architectureFinding, patternMinerFinding, flowTracerFinding],
  );
  assert.deepEqual(
    (await readFile(join(workspaceRoot, "memory", "verified_findings.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as unknown),
    [scoutFinding, architectureFinding, patternMinerFinding, flowTracerFinding],
  );
  assert.match(
    await readFile(
      join(workspaceRoot, "validation", "scout", "attempt-1", "report.json"),
      "utf8",
    ),
    /"status": "passed"/,
  );
  assert.match(
    await readFile(
      join(workspaceRoot, "validation", "scout", "attempt-1", "evidence.json"),
      "utf8",
    ),
    /"valid": true/,
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(workspaceRoot, "agents", "flow_tracer", "attempt-1", "output.json"),
        "utf8",
      ),
    ),
    flowTracerOutput,
  );
  assert.match(
    await readFile(
      join(
        workspaceRoot,
        "validation",
        "flow_tracer",
        "attempt-1",
        "report.json",
      ),
      "utf8",
    ),
    /"contract": "flow-tracer-output"/,
  );
  assert.match(
    await readFile(
      join(
        workspaceRoot,
        "validation",
        "flow_tracer",
        "attempt-1",
        "evidence.json",
      ),
      "utf8",
    ),
    /"valid": true/,
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(workspaceRoot, "agents", "architecture", "attempt-1", "output.json"),
        "utf8",
      ),
    ),
    architectureOutput,
  );
  assert.match(
    await readFile(
      join(workspaceRoot, "validation", "architecture", "attempt-1", "report.json"),
      "utf8",
    ),
    /"contract": "architecture-output"/,
  );
  assert.match(
    await readFile(
      join(
        workspaceRoot,
        "validation",
        "architecture",
        "attempt-1",
        "evidence.json",
      ),
      "utf8",
    ),
    /"valid": true/,
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(workspaceRoot, "agents", "pattern_miner", "attempt-1", "output.json"),
        "utf8",
      ),
    ),
    patternMinerOutput,
  );
  assert.match(
    await readFile(
      join(
        workspaceRoot,
        "validation",
        "pattern_miner",
        "attempt-1",
        "report.json",
      ),
      "utf8",
    ),
    /"contract": "pattern-miner-output"/,
  );
  assert.match(
    await readFile(
      join(
        workspaceRoot,
        "validation",
        "pattern_miner",
        "attempt-1",
        "evidence.json",
      ),
      "utf8",
    ),
    /"valid": true/,
  );
  assert.equal(
    JSON.parse(await readFile(join(workspaceRoot, "qa", "readiness.json"), "utf8"))
      .readinessScore,
    100,
  );
  assert.equal(
    JSON.parse(await readFile(join(workspaceRoot, "qa", "results.json"), "utf8"))
      .length,
    4,
  );
  assert.match(
    await readFile(
      join(workspaceRoot, "final", "docs", "00-executive-summary.md"),
      "utf8",
    ),
    /The repository includes a README entrypoint/,
  );
  assert.match(
    await readFile(
      join(workspaceRoot, "final", "docs", "09-verification-report.md"),
      "utf8",
    ),
    /Approved findings used: 4/,
  );
  assert.match(
    await readFile(
      join(workspaceRoot, "final", "docs", "03-feature-flow-traces.md"),
      "utf8",
    ),
    /The visible inspection flow starts from README context/,
  );
  const patternCards = await readFile(
    join(workspaceRoot, "final", "rag_cards", "patterns.jsonl"),
    "utf8",
  );
  const warningCards = await readFile(
    join(workspaceRoot, "final", "rag_cards", "warnings.jsonl"),
    "utf8",
  );
  const decisionCards = await readFile(
    join(workspaceRoot, "final", "rag_cards", "decisions.jsonl"),
    "utf8",
  );
  const flowCards = await readFile(
    join(workspaceRoot, "final", "rag_cards", "flows.jsonl"),
    "utf8",
  );

  assert.match(patternCards, /rag-card-finding-pattern-miner-001/);
  assert.match(warningCards, /rag-card-finding-architecture-001/);
  assert.match(decisionCards, /rag-card-finding-scout-001/);
  assert.match(flowCards, /rag-card-finding-flow-tracer-001/);
  assert.equal(
    JSON.parse(patternCards.trim().split("\n")[0] ?? "{}").sourceRepo,
    "target-repo",
  );
});

test("CLI run routes QA revisions only to the owner agent and preserves attempts", async () => {
  const fixture = await createFixture();
  const contradictoryArchitectureOutput = {
    ...architectureOutput,
    findings: [
      {
        ...architectureFinding,
        id: "finding-architecture-uses-ports",
        claim: "Application orchestration uses ports.",
      },
      {
        ...architectureFinding,
        id: "finding-architecture-does-not-use-ports",
        claim: "Application orchestration does not use ports.",
      },
    ],
  };
  const repairedArchitectureOutput = {
    ...architectureOutput,
    findings: [
      {
        ...architectureFinding,
        id: "finding-architecture-uses-ports",
        claim: "Application orchestration uses ports.",
      },
    ],
  };
  const runner = new FakeAgentRunner({
    results: [
      successfulScoutResult(),
      successfulArchitectureResult(JSON.stringify(contradictoryArchitectureOutput)),
      successfulPatternMinerResult(),
      successfulFlowTracerResult(),
      successfulArchitectureResult(JSON.stringify(repairedArchitectureOutput)),
    ],
  });

  const result = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      fixture.objectivePath,
      "--out",
      fixture.outPath,
    ],
    clock: fixedClock,
    runner,
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(
    runner.requests.map((request) => [request.agentId, request.attempt]),
    [
      ["scout", 1],
      ["architecture", 1],
      ["pattern_miner", 1],
      ["flow_tracer", 1],
      ["architecture", 2],
    ],
  );

  const workspaceRoot = join(
    fixture.outPath,
    "2026-06-20T01-02-03-004Z_target-repo",
  );
  const retryPrompt = await readFile(
    join(workspaceRoot, "agents", "architecture", "attempt-2", "prompt.md"),
    "utf8",
  );
  assert.match(retryPrompt, /finding-architecture-does-not-use-ports/);
  assert.match(retryPrompt, /contradicts/);
  assert.match(retryPrompt, /Previous Outputs/);
  assert.match(retryPrompt, /Application orchestration does not use ports/);
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(workspaceRoot, "agents", "architecture", "attempt-1", "output.json"),
        "utf8",
      ),
    ),
    contradictoryArchitectureOutput,
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(workspaceRoot, "agents", "architecture", "attempt-2", "output.json"),
        "utf8",
      ),
    ),
    repairedArchitectureOutput,
  );
  assert.match(
    await readFile(
      join(workspaceRoot, "validation", "architecture", "attempt-2", "report.json"),
      "utf8",
    ),
    /"status": "passed"/,
  );
  assert.match(
    await readFile(
      join(
        workspaceRoot,
        "validation",
        "architecture",
        "attempt-2",
        "evidence.json",
      ),
      "utf8",
    ),
    /"valid": true/,
  );
  assert.equal(
    JSON.parse(await readFile(join(workspaceRoot, "qa", "readiness.json"), "utf8"))
      .readinessScore,
    100,
  );
  assert.match(
    await readFile(join(workspaceRoot, "memory", "qa_issues.jsonl"), "utf8"),
    /finding-architecture-does-not-use-ports/,
  );
});

test("CLI run respects max retries and leaves unresolved QA issues visible", async () => {
  const fixture = await createFixture();
  const contradictoryArchitectureOutput = {
    ...architectureOutput,
    findings: [
      {
        ...architectureFinding,
        id: "finding-architecture-uses-ports",
        claim: "Application orchestration uses ports.",
      },
      {
        ...architectureFinding,
        id: "finding-architecture-does-not-use-ports",
        claim: "Application orchestration does not use ports.",
      },
    ],
  };
  const runner = new FakeAgentRunner({
    results: [
      successfulScoutResult(),
      successfulArchitectureResult(JSON.stringify(contradictoryArchitectureOutput)),
      successfulPatternMinerResult(),
      successfulFlowTracerResult(),
      successfulArchitectureResult(JSON.stringify(contradictoryArchitectureOutput)),
    ],
  });

  const result = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      fixture.objectivePath,
      "--out",
      fixture.outPath,
    ],
    clock: fixedClock,
    runner,
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(
    runner.requests.map((request) => [request.agentId, request.attempt]),
    [
      ["scout", 1],
      ["architecture", 1],
      ["pattern_miner", 1],
      ["flow_tracer", 1],
      ["architecture", 2],
    ],
  );

  const workspaceRoot = join(
    fixture.outPath,
    "2026-06-20T01-02-03-004Z_target-repo",
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(workspaceRoot, "agents", "architecture", "attempt-2", "output.json"),
        "utf8",
      ),
    ),
    contradictoryArchitectureOutput,
  );
  const revisionRequests = JSON.parse(
    await readFile(join(workspaceRoot, "qa", "revision_requests.json"), "utf8"),
  ) as unknown[];
  assert.equal(revisionRequests.length, 2);
  assert.equal(
    JSON.parse(await readFile(join(workspaceRoot, "qa", "readiness.json"), "utf8"))
      .readinessScore,
    60,
  );
  assert.match(
    await readFile(join(workspaceRoot, "memory", "qa_issues.jsonl"), "utf8"),
    /contradicts/,
  );
});

test("CLI run prints verbose progress and Scout streaming output", async () => {
  const fixture = await createFixture();
  const stdout: string[] = [];

  const result = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      fixture.objectivePath,
      "--out",
      fixture.outPath,
      "--verbose",
    ],
    clock: fixedClock,
    runner: new FakeAgentRunner({
      results: [
        successfulScoutResult(JSON.stringify(scoutOutput)),
        successfulArchitectureResult(JSON.stringify(architectureOutput)),
        successfulPatternMinerResult(JSON.stringify(patternMinerOutput)),
        successfulFlowTracerResult(JSON.stringify(flowTracerOutput)),
      ].map((agentResult) => ({
        ...agentResult,
        streamingEvents: [
          {
            timestamp: "2026-06-20T01:02:04.500Z",
            kind: "status" as const,
            message: "Scout started",
          },
        ],
      })),
    }),
    stdout: (line) => stdout.push(line),
  });

  assert.equal(result.exitCode, 0);
  assert.match(stdout.join("\n"), /Creating run workspace/);
  assert.match(stdout.join("\n"), /Indexing repository/);
  assert.match(stdout.join("\n"), /\[scout:status\] Scout started/);
  assert.match(stdout.join("\n"), /Running Architecture/);
  assert.match(stdout.join("\n"), /\[architecture:status\] Scout started/);
  assert.match(stdout.join("\n"), /Running Pattern Miner/);
  assert.match(stdout.join("\n"), /\[pattern_miner:status\] Scout started/);
  assert.match(stdout.join("\n"), /Running Flow Tracer/);
  assert.match(stdout.join("\n"), /\[flow_tracer:status\] Scout started/);
  assert.match(stdout.join("\n"), /Inspection run workspace:/);
});

test("CLI run fails when Scout output is not schema-valid", async () => {
  const fixture = await createFixture();
  const stderr: string[] = [];

  const result = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      fixture.objectivePath,
      "--out",
      fixture.outPath,
    ],
    clock: fixedClock,
    runner: new FakeAgentRunner({
      results: [
        successfulScoutResult(JSON.stringify({ findings: [scoutFinding] })),
      ],
    }),
    stderr: (line) => stderr.push(line),
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 1);
  assert.match(stderr.join("\n"), /Scout schema validation failed/);
});

test("CLI run fails when Scout evidence cites missing repository lines", async () => {
  const fixture = await createFixture();
  const stderr: string[] = [];
  const invalidEvidenceOutput = {
    ...scoutOutput,
    findings: [
      {
        ...scoutFinding,
        evidence: [{ file: "README.md", lineStart: 99, lineEnd: 100 }],
      },
    ],
  };

  const result = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      fixture.objectivePath,
      "--out",
      fixture.outPath,
    ],
    clock: fixedClock,
    runner: new FakeAgentRunner({
      results: [successfulScoutResult(JSON.stringify(invalidEvidenceOutput))],
    }),
    stderr: (line) => stderr.push(line),
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 1);
  assert.match(stderr.join("\n"), /Scout evidence validation failed/);
});

test("CLI run fails when Architecture output is not schema-valid", async () => {
  const fixture = await createFixture();
  const stderr: string[] = [];

  const result = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      fixture.objectivePath,
      "--out",
      fixture.outPath,
    ],
    clock: fixedClock,
    runner: new FakeAgentRunner({
      results: [
        successfulScoutResult(),
        successfulArchitectureResult(JSON.stringify({ findings: [architectureFinding] })),
      ],
    }),
    stderr: (line) => stderr.push(line),
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 1);
  assert.match(stderr.join("\n"), /Architecture schema validation failed/);
});

test("CLI run fails when Architecture evidence cites missing repository lines", async () => {
  const fixture = await createFixture();
  const stderr: string[] = [];
  const invalidEvidenceOutput = {
    ...architectureOutput,
    findings: [
      {
        ...architectureFinding,
        evidence: [{ file: "README.md", lineStart: 99, lineEnd: 100 }],
      },
    ],
  };

  const result = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      fixture.objectivePath,
      "--out",
      fixture.outPath,
    ],
    clock: fixedClock,
    runner: new FakeAgentRunner({
      results: [
        successfulScoutResult(),
        successfulArchitectureResult(JSON.stringify(invalidEvidenceOutput)),
      ],
    }),
    stderr: (line) => stderr.push(line),
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 1);
  assert.match(stderr.join("\n"), /Architecture evidence validation failed/);
});

test("CLI run fails when Pattern Miner output omits tradeoffs", async () => {
  const fixture = await createFixture();
  const stderr: string[] = [];
  const invalidPatternOutput = {
    ...patternMinerOutput,
    patterns: [{ ...patternMinerOutput.patterns[0], tradeoffs: [] }],
  };

  const result = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      fixture.objectivePath,
      "--out",
      fixture.outPath,
    ],
    clock: fixedClock,
    runner: new FakeAgentRunner({
      results: [
        successfulScoutResult(),
        successfulArchitectureResult(),
        successfulPatternMinerResult(JSON.stringify(invalidPatternOutput)),
      ],
    }),
    stderr: (line) => stderr.push(line),
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 1);
  assert.match(stderr.join("\n"), /Pattern Miner schema validation failed/);
  assert.match(stderr.join("\n"), /tradeoffs/);
});

test("CLI run fails when Pattern Miner evidence cites missing repository lines", async () => {
  const fixture = await createFixture();
  const stderr: string[] = [];
  const invalidPatternOutput = {
    ...patternMinerOutput,
    patterns: [
      {
        ...patternMinerOutput.patterns[0],
        evidence: [{ file: "README.md", lineStart: 99, lineEnd: 100 }],
      },
    ],
  };

  const result = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      fixture.objectivePath,
      "--out",
      fixture.outPath,
    ],
    clock: fixedClock,
    runner: new FakeAgentRunner({
      results: [
        successfulScoutResult(),
        successfulArchitectureResult(),
        successfulPatternMinerResult(JSON.stringify(invalidPatternOutput)),
      ],
    }),
    stderr: (line) => stderr.push(line),
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 1);
  assert.match(stderr.join("\n"), /Pattern Miner evidence validation failed/);
});

test("CLI run fails when Flow Tracer output omits required flow fields", async () => {
  const fixture = await createFixture();
  const stderr: string[] = [];
  const invalidFlowOutput = {
    ...flowTracerOutput,
    flows: [{ ...flowTracerOutput.flows[0], dataPath: [] }],
  };

  const result = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      fixture.objectivePath,
      "--out",
      fixture.outPath,
    ],
    clock: fixedClock,
    runner: new FakeAgentRunner({
      results: [
        successfulScoutResult(),
        successfulArchitectureResult(),
        successfulPatternMinerResult(),
        successfulFlowTracerResult(JSON.stringify(invalidFlowOutput)),
      ],
    }),
    stderr: (line) => stderr.push(line),
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 1);
  assert.match(stderr.join("\n"), /Flow Tracer schema validation failed/);
  assert.match(stderr.join("\n"), /dataPath/);
});

test("CLI run fails when Flow Tracer evidence cites missing repository lines", async () => {
  const fixture = await createFixture();
  const stderr: string[] = [];
  const invalidFlowOutput = {
    ...flowTracerOutput,
    flows: [
      {
        ...flowTracerOutput.flows[0],
        evidence: [{ file: "README.md", lineStart: 99, lineEnd: 100 }],
      },
    ],
  };

  const result = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      fixture.objectivePath,
      "--out",
      fixture.outPath,
    ],
    clock: fixedClock,
    runner: new FakeAgentRunner({
      results: [
        successfulScoutResult(),
        successfulArchitectureResult(),
        successfulPatternMinerResult(),
        successfulFlowTracerResult(JSON.stringify(invalidFlowOutput)),
      ],
    }),
    stderr: (line) => stderr.push(line),
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 1);
  assert.match(stderr.join("\n"), /Flow Tracer evidence validation failed/);
});
