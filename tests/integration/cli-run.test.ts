import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chdir, cwd } from "node:process";
import test from "node:test";

import { FakeAgentRunner } from "../../src/adapters/codex/index.js";
import { runInspectorCli } from "../../src/adapters/cli/index.js";
import type {
  AgentRunResult,
  Clock,
  ProcessRunRequest,
  ProcessRunResult,
  ProcessRunner,
} from "../../src/index.js";

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

const testingStrategyFinding = {
  id: "finding-testing-strategy-001",
  agent: "testing_strategy",
  severity: "medium",
  claim: "The fixture protects CLI behavior with integration tests but does not prove live runner behavior.",
  evidence: [
    {
      file: "README.md",
      lineStart: 1,
      lineEnd: 2,
    },
  ],
  recommendation:
    "Keep live runner validation separate from deterministic fake-runner tests.",
  confidence: 0.7,
  tags: ["testing", "quality-gate"],
};

const testingStrategyOutput = {
  testTypesFound: [
    {
      name: "Fixture integration coverage",
      summary: "The fixture evidence supports only shallow integration-test claims.",
      evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
    },
  ],
  qualityGates: [
    {
      command: "npm test",
      status: "not-run",
      summary: "The agent observed the configured test command but did not run it.",
      evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
    },
  ],
  behaviorProtected: [
    {
      name: "CLI fixture path",
      summary: "The fixture protects the CLI happy path through deterministic output.",
      evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
    },
  ],
  behaviorNotProtected: [
    {
      name: "Live Codex runner",
      summary: "No fixture evidence proves live external runner behavior.",
      evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
    },
  ],
  commandEvidence: [
    {
      command: "npm test",
      status: "not-run",
      evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
    },
  ],
  testingRisks: [
    {
      name: "Unproven live runner",
      summary: "Fake-runner confidence does not prove live external process behavior.",
      evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
    },
  ],
  recommendations: [
    {
      summary: "Run validation commands before claiming repository tests pass.",
      priority: "high",
      evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
    },
  ],
  findings: [testingStrategyFinding],
};

const tradeoffAnalystFinding = {
  id: "finding-tradeoff-analyst-001",
  agent: "tradeoff_analyst",
  severity: "medium",
  claim:
    "The fixture keeps inspection outputs evidence-backed, but its README-only evidence limits adaptation confidence.",
  evidence: [
    {
      file: "README.md",
      lineStart: 1,
      lineEnd: 2,
    },
  ],
  recommendation:
    "Separate repo-specific tradeoffs from adaptation advice until source-level evidence exists.",
  confidence: 0.7,
  tags: ["tradeoff", "adaptation"],
  cardType: "warning",
};

const tradeoffAnalystOutput = {
  strongDecisions: [
    {
      decision: "Require evidence-backed inspection outputs.",
      tradeoff:
        "This prevents unsupported claims while making sparse fixtures produce shallow conclusions.",
      consequence: "Tradeoff analysis remains traceable but limited.",
      evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
      confidence: 0.75,
    },
  ],
  weakDecisions: [
    {
      decision: "Use README-only evidence in the fixture.",
      tradeoff: "The fixture stays small but does not prove source-level architecture.",
      risk: "Adaptation guidance can overfit to shallow evidence.",
      evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
      confidence: 0.66,
    },
  ],
  overengineeringRisks: [
    {
      risk: "Too many specialist outputs can add ceremony for tiny repositories.",
      tradeoff: "Specialization improves review focus but adds orchestration overhead.",
      consequence: "Small repositories may need explicit insufficient-evidence paths.",
      evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
      confidence: 0.64,
    },
  ],
  underengineeringRisks: [
    {
      risk: "Generic findings do not separate repo tradeoffs from adaptation advice.",
      tradeoff: "A flexible finding shape is easy to emit but weak for reuse.",
      consequence: "Future agents may copy advice without checking context.",
      evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
      confidence: 0.72,
    },
  ],
  hiddenAssumptions: [
    {
      assumption: "README context is enough to discuss workflow tradeoffs.",
      whyItMatters: "The assumption must stay visible so agents do not infer unseen code.",
      evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
      confidence: 0.68,
    },
  ],
  agentSafetyRisks: [
    {
      risk: "Agents may praise the repo without naming weak decisions.",
      tradeoff: "Positive summaries are easy to reuse but hide failure modes.",
      consequence: "QA should reject unsupported or praise-only tradeoff output.",
      evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
      confidence: 0.7,
    },
  ],
  adaptationWarnings: [
    {
      warning: "Do not adapt README-only tradeoffs as source-level architecture advice.",
      repoSpecificContext:
        "The fixture only proves README-backed inspection context.",
      adaptationAdvice:
        "Require source file evidence before copying architecture tradeoffs elsewhere.",
      evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
      confidence: 0.73,
    },
  ],
  findings: [tradeoffAnalystFinding],
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

function successfulTestingStrategyResult(
  stdout = JSON.stringify(testingStrategyOutput),
): AgentRunResult {
  return {
    stdout,
    stderr: "",
    exitCode: 0,
    startedAt: "2026-06-20T01:02:12.000Z",
    completedAt: "2026-06-20T01:02:13.000Z",
    outputArtifactPaths: [],
    streamingEvents: [],
  };
}

function successfulTradeoffAnalystResult(
  stdout = JSON.stringify(tradeoffAnalystOutput),
): AgentRunResult {
  return {
    stdout,
    stderr: "",
    exitCode: 0,
    startedAt: "2026-06-20T01:02:14.000Z",
    completedAt: "2026-06-20T01:02:15.000Z",
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
      successfulTestingStrategyResult(),
      successfulTradeoffAnalystResult(),
      ...results,
    ],
  });
}

function successfulRunnerWithPassedCommandEvidence(): FakeAgentRunner {
  const trustedTestingStrategyOutput = {
    ...testingStrategyOutput,
    qualityGates: [
      {
        ...testingStrategyOutput.qualityGates[0],
        status: "passed",
        summary: "The configured test command passed in the quality command report.",
      },
    ],
    commandEvidence: [
      {
        command: "npm test",
        status: "passed",
        exitCode: 0,
        ranAt: "2026-06-20T01:02:03.004Z",
        evidence: [{ file: "README.md", lineStart: 1, lineEnd: 2 }],
      },
    ],
  };

  return new FakeAgentRunner({
    results: [
      successfulScoutResult(),
      successfulArchitectureResult(),
      successfulPatternMinerResult(),
      successfulFlowTracerResult(),
      successfulTestingStrategyResult(JSON.stringify(trustedTestingStrategyOutput)),
      successfulTradeoffAnalystResult(),
    ],
  });
}

class RecordingProcessRunner implements ProcessRunner {
  readonly requests: ProcessRunRequest[] = [];

  async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    this.requests.push(request);
    return {
      stdout: "quality passed\n",
      stderr: "",
      exitCode: 0,
      startedAt: "2026-06-20T01:02:03.000Z",
      completedAt: "2026-06-20T01:02:04.000Z",
      streamingEvents: [],
    };
  }
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
  await writeFile(
    join(repoPath, "package.json"),
    `${JSON.stringify({ scripts: { test: "echo test" } }, null, 2)}\n`,
  );
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
    ".\nREADME.md\npackage.json\n",
  );
});

test("CLI status summarizes completed, failed, running, and pending stages", async () => {
  const fixture = await createFixture();
  const runDirectory = join(fixture.outPath, "existing-run");
  await mkdir(join(runDirectory, "agents", "scout", "attempt-1"), {
    recursive: true,
  });
  await mkdir(join(runDirectory, "agents", "architecture", "attempt-1"), {
    recursive: true,
  });
  await mkdir(join(runDirectory, "agents", "pattern_miner", "attempt-1"), {
    recursive: true,
  });
  await writeFile(
    join(runDirectory, "agents", "scout", "attempt-1", "status.json"),
    `${JSON.stringify({ agentId: "scout", status: "APPROVED", attempts: 1 })}\n`,
  );
  await writeFile(
    join(runDirectory, "agents", "architecture", "attempt-1", "status.json"),
    `${JSON.stringify({ agentId: "architecture", status: "FAILED", attempts: 1 })}\n`,
  );
  await writeFile(
    join(runDirectory, "agents", "pattern_miner", "attempt-1", "status.json"),
    `${JSON.stringify({ agentId: "pattern_miner", status: "RUNNING", attempts: 1 })}\n`,
  );
  const stdout: string[] = [];

  const result = await runInspectorCli({
    argv: ["status", runDirectory],
    stdout: (line) => stdout.push(line),
  });

  assert.equal(result.exitCode, 0);
  assert.match(stdout.join("\n"), /Completed: 1/);
  assert.match(stdout.join("\n"), /Failed: 1/);
  assert.match(stdout.join("\n"), /Running: 1/);
  assert.match(stdout.join("\n"), /Pending: 3/);
});

test("CLI resume continues an incomplete run without rerunning completed agents", async () => {
  const fixture = await createFixture();
  const initialRunner = new FakeAgentRunner({
    results: [successfulScoutResult(), successfulArchitectureResult("{}")],
  });

  const initial = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      fixture.objectivePath,
      "--out",
      fixture.outPath,
    ],
    clock: fixedClock,
    runner: initialRunner,
    stdout: () => undefined,
    stderr: () => undefined,
  });

  assert.equal(initial.exitCode, 1);
  assert.equal(initial.workspace?.root !== undefined, true);

  const resumeRunner = new FakeAgentRunner({
    results: [
      successfulArchitectureResult(),
      successfulPatternMinerResult(),
      successfulFlowTracerResult(),
      successfulTestingStrategyResult(),
      successfulTradeoffAnalystResult(),
    ],
  });
  const stdout: string[] = [];
  const resumed = await runInspectorCli({
    argv: ["resume", initial.workspace?.root ?? ""],
    clock: fixedClock,
    runner: resumeRunner,
    stdout: (line) => stdout.push(line),
  });

  assert.equal(resumed.exitCode, 0);
  assert.deepEqual(
    resumeRunner.requests.map((request) => request.agentId),
    [
      "architecture",
      "pattern_miner",
      "flow_tracer",
      "testing_strategy",
      "tradeoff_analyst",
    ],
  );
  assert.match(stdout.join("\n"), /Inspection run workspace:/);
  assert.equal(
    await stat(
      join(
        initial.workspace?.root ?? "",
        "final",
        "docs",
        "00-executive-summary.md",
      ),
    ).then((metadata) => metadata.isFile()),
    true,
  );
});

test("CLI resume fails safely when completed agent state is missing output", async () => {
  const fixture = await createFixture();
  const runDirectory = join(fixture.outPath, "corrupted-run");
  await mkdir(join(runDirectory, "repo_index"), { recursive: true });
  await mkdir(join(runDirectory, "memory"), { recursive: true });
  await mkdir(join(runDirectory, "validation"), { recursive: true });
  await mkdir(join(runDirectory, "agents", "scout", "attempt-1"), {
    recursive: true,
  });
  await writeFile(
    join(runDirectory, "config.json"),
    `${JSON.stringify({
      target: { name: "target-repo", root: fixture.repoPath },
      outputDirectory: fixture.outPath,
      agentRoles: ["documentation"],
      validationCommands: [],
      runQualityCommands: false,
    })}\n`,
  );
  await writeFile(join(runDirectory, "memory", "blackboard.md"), "Objective: Inspect safely.\n");
  await writeFile(join(runDirectory, "repo_index", "repo_summary.json"), "{}\n");
  await writeFile(join(runDirectory, "repo_index", "important_files.json"), "[]\n");
  await writeFile(join(runDirectory, "repo_index", "detected_stack.json"), "{}\n");
  await writeFile(join(runDirectory, "repo_index", "detected_commands.json"), "{}\n");
  await writeFile(join(runDirectory, "repo_index", "file_tree.txt"), ".\nREADME.md\n");
  await writeFile(
    join(runDirectory, "validation", "command_report.json"),
    `${JSON.stringify({ skipped: true, reason: "disabled", commands: [] })}\n`,
  );
  await writeFile(
    join(runDirectory, "agents", "scout", "attempt-1", "status.json"),
    `${JSON.stringify({ agentId: "scout", status: "APPROVED", attempts: 1 })}\n`,
  );
  const stderr: string[] = [];
  const runner = successfulRunner();

  const result = await runInspectorCli({
    argv: ["resume", runDirectory],
    runner,
    stdout: () => undefined,
    stderr: (line) => stderr.push(line),
  });

  assert.equal(result.exitCode, 1);
  assert.match(
    stderr.join("\n"),
    /Ambiguous run state: completed scout is missing output/,
  );
  assert.equal(runner.requests.length, 0);
});

test("CLI run writes a skipped command report by default without invoking the process runner", async () => {
  const fixture = await createFixture();
  const processRunner = new RecordingProcessRunner();

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
    processRunner,
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(processRunner.requests, []);
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(
          fixture.outPath,
          "2026-06-20T01-02-03-004Z_target-repo",
          "validation",
          "command_report.json",
        ),
        "utf8",
      ),
    ),
    {
      skipped: true,
      reason:
        "Quality command execution is disabled by default. Use --run-quality-commands or runQualityCommands: true only for trusted repositories.",
      commands: [],
    },
  );
});

test("CLI run executes detected safe commands with --run-quality-commands", async () => {
  const fixture = await createFixture();
  const processRunner = new RecordingProcessRunner();

  const result = await runInspectorCli({
    argv: [
      "run",
      fixture.repoPath,
      "--objective",
      fixture.objectivePath,
      "--out",
      fixture.outPath,
      "--run-quality-commands",
    ],
    clock: fixedClock,
    runner: successfulRunnerWithPassedCommandEvidence(),
    processRunner,
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(
    processRunner.requests.map((request) => ({
      command: request.command,
      args: request.args,
      cwd: request.cwd,
    })),
    [{ command: "npm", args: ["test"], cwd: fixture.repoPath }],
  );
});

test("CLI run accepts a declarative inspection config file", async () => {
  const fixture = await createFixture();
  const configPath = join(fixture.tempDirectory, "inspection.yaml");
  const runner = successfulRunner();
  await writeFile(
    configPath,
    [
      `repoPath: ${fixture.repoPath}`,
      `outputPath: ${fixture.outPath}`,
      "objective: Inspect from a declarative config.",
      "targetContext: Focus on CLI configuration ergonomics.",
      "agents:",
      "  - scout",
      "  - architecture",
      "  - pattern_miner",
      "  - flow_tracer",
      "  - testing_strategy",
      "  - tradeoff_analyst",
      "parallelism: 1",
      "maxRetries: 3",
      "verbose: true",
      "runner:",
      "  provider: fake",
      "",
    ].join("\n"),
  );
  const stdout: string[] = [];

  const result = await runInspectorCli({
    argv: ["run", configPath],
    clock: fixedClock,
    runner,
    stdout: (line) => stdout.push(line),
  });

  assert.equal(result.exitCode, 0);
  assert.match(stdout.join("\n"), /Inspection started: target-repo/);
  assert.match(runner.requests[0]?.prompt ?? "", /Inspect from a declarative config/);
  assert.match(
    runner.requests[0]?.prompt ?? "",
    /Focus on CLI configuration ergonomics/,
  );

  const savedConfig = JSON.parse(
    await readFile(
      join(
        fixture.outPath,
        "2026-06-20T01-02-03-004Z_target-repo",
        "config.json",
      ),
      "utf8",
    ),
  ) as {
    targetContext?: string;
    agents?: string[];
    parallelism?: number;
    maxRetries?: number;
    runner?: { provider?: string };
  };
  assert.equal(savedConfig.targetContext, "Focus on CLI configuration ergonomics.");
  assert.deepEqual(savedConfig.agents, [
    "scout",
    "architecture",
    "pattern_miner",
    "flow_tracer",
    "testing_strategy",
    "tradeoff_analyst",
  ]);
  assert.equal(savedConfig.parallelism, 1);
  assert.equal(savedConfig.maxRetries, 3);
  assert.deepEqual(savedConfig.runner, { provider: "fake" });
});

test("CLI config run rejects parallelism greater than one before scheduler runtime wiring", async () => {
  const fixture = await createFixture();
  const configPath = join(fixture.tempDirectory, "inspection.yaml");
  const stderr: string[] = [];
  await writeFile(
    configPath,
    [
      `repoPath: ${fixture.repoPath}`,
      `outputPath: ${fixture.outPath}`,
      "objective: Inspect unsupported parallelism.",
      "parallelism: 2",
      "",
    ].join("\n"),
  );

  const result = await runInspectorCli({
    argv: ["run", configPath],
    clock: fixedClock,
    runner: successfulRunnerWithPassedCommandEvidence(),
    stderr: (line) => stderr.push(line),
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 1);
  assert.match(
    stderr.join("\n"),
    /parallelism > 1 is reserved for scheduler-driven orchestration and is not active before Milestone 34\+/,
  );
});

test("CLI config run rejects partial custom agent selection before scheduler runtime wiring", async () => {
  const fixture = await createFixture();
  const configPath = join(fixture.tempDirectory, "inspection.yaml");
  const stderr: string[] = [];
  await writeFile(
    configPath,
    [
      `repoPath: ${fixture.repoPath}`,
      `outputPath: ${fixture.outPath}`,
      "objective: Inspect unsupported agent selection.",
      "agents:",
      "  - scout",
      "  - architecture",
      "",
    ].join("\n"),
  );

  const result = await runInspectorCli({
    argv: ["run", configPath],
    clock: fixedClock,
    runner: successfulRunnerWithPassedCommandEvidence(),
    stderr: (line) => stderr.push(line),
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 1);
  assert.match(
    stderr.join("\n"),
    /custom agent selection is reserved for scheduler-driven orchestration and is not active in the current runtime slice/,
  );
});

test("CLI config run executes detected safe commands when runQualityCommands is true", async () => {
  const fixture = await createFixture();
  const configPath = join(fixture.tempDirectory, "inspection.yaml");
  const processRunner = new RecordingProcessRunner();
  await writeFile(
    configPath,
    [
      `repoPath: ${fixture.repoPath}`,
      `outputPath: ${fixture.outPath}`,
      "objective: Inspect trusted config command execution.",
      "runQualityCommands: true",
      "",
    ].join("\n"),
  );

  const result = await runInspectorCli({
    argv: ["run", configPath],
    clock: fixedClock,
    runner: successfulRunnerWithPassedCommandEvidence(),
    processRunner,
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(processRunner.requests.map((request) => request.command), [
    "npm",
  ]);
});

test("CLI config run skips command execution when runQualityCommands is omitted", async () => {
  const fixture = await createFixture();
  const configPath = join(fixture.tempDirectory, "inspection.yaml");
  const processRunner = new RecordingProcessRunner();
  await writeFile(
    configPath,
    [
      `repoPath: ${fixture.repoPath}`,
      `outputPath: ${fixture.outPath}`,
      "objective: Inspect default config command behavior.",
      "",
    ].join("\n"),
  );

  const result = await runInspectorCli({
    argv: ["run", configPath],
    clock: fixedClock,
    runner: successfulRunner(),
    processRunner,
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(processRunner.requests, []);
});

test("CLI run reports invalid inspection config values clearly", async () => {
  const fixture = await createFixture();
  const configPath = join(fixture.tempDirectory, "inspection.yaml");
  const stderr: string[] = [];
  await writeFile(
    configPath,
    [
      `repoPath: ${fixture.repoPath}`,
      `outputPath: ${fixture.outPath}`,
      "objective: Inspect invalid config handling.",
      "parallelism: 0",
      "",
    ].join("\n"),
  );

  const result = await runInspectorCli({
    argv: ["run", configPath],
    clock: fixedClock,
    runner: successfulRunner(),
    stderr: (line) => stderr.push(line),
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 1);
  assert.match(
    stderr.join("\n"),
    /Invalid inspection config: 'parallelism' must be an integer greater than or equal to 1/,
  );
});

test("CLI run lets flags override inspection config values", async () => {
  const fixture = await createFixture();
  const configPath = join(fixture.tempDirectory, "inspection.yaml");
  const configuredOutPath = join(fixture.tempDirectory, "configured-runs");
  const overrideOutPath = join(fixture.tempDirectory, "override-runs");
  const overrideObjectivePath = join(fixture.tempDirectory, "override-objective.md");
  const runner = successfulRunner();
  const stdout: string[] = [];

  await writeFile(overrideObjectivePath, "Inspect the CLI override objective.\n");
  await writeFile(
    configPath,
    [
      `repoPath: ${fixture.repoPath}`,
      `outputPath: ${configuredOutPath}`,
      "objective: This config objective should be replaced.",
      "verbose: false",
      "",
    ].join("\n"),
  );

  const result = await runInspectorCli({
    argv: [
      "run",
      configPath,
      "--objective",
      overrideObjectivePath,
      "--out",
      overrideOutPath,
      "--verbose",
    ],
    clock: fixedClock,
    runner,
    stdout: (line) => stdout.push(line),
  });

  assert.equal(result.exitCode, 0);
  assert.match(stdout.join("\n"), /Inspection started: target-repo/);
  assert.match(runner.requests[0]?.prompt ?? "", /Inspect the CLI override objective/);
  assert.doesNotMatch(
    runner.requests[0]?.prompt ?? "",
    /This config objective should be replaced/,
  );
  assert.equal(
    (await stat(
      join(overrideOutPath, "2026-06-20T01-02-03-004Z_target-repo", "config.json"),
    )).isFile(),
    true,
  );
});

test("CLI run reports missing required inspection config values", async () => {
  const fixture = await createFixture();
  const configPath = join(fixture.tempDirectory, "inspection.yaml");
  const stderr: string[] = [];
  await writeFile(
    configPath,
    [
      `repoPath: ${fixture.repoPath}`,
      `outputPath: ${fixture.outPath}`,
      "",
    ].join("\n"),
  );

  const result = await runInspectorCli({
    argv: ["run", configPath],
    clock: fixedClock,
    runner: successfulRunner(),
    stderr: (line) => stderr.push(line),
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 1);
  assert.match(stderr.join("\n"), /Invalid inspection config: missing objective/);
});

test("CLI run uses config maxRetries for QA revision routing", async () => {
  const fixture = await createFixture();
  const configPath = join(fixture.tempDirectory, "inspection.yaml");
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
      successfulTestingStrategyResult(),
      successfulTradeoffAnalystResult(),
    ],
  });
  await writeFile(
    configPath,
    [
      `repoPath: ${fixture.repoPath}`,
      `outputPath: ${fixture.outPath}`,
      "objective: Inspect without retrying QA failures.",
      "maxRetries: 0",
      "",
    ].join("\n"),
  );

  const result = await runInspectorCli({
    argv: ["run", configPath],
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
      ["testing_strategy", 1],
      ["tradeoff_analyst", 1],
    ],
  );
});

test("CLI run stays concise without verbose output", async () => {
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
    ],
    clock: fixedClock,
    runner: successfulRunner(),
    stdout: (line) => stdout.push(line),
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(stdout, [
    `Inspection run workspace: ${join(
      fixture.outPath,
      "2026-06-20T01-02-03-004Z_target-repo",
    )}`,
  ]);
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
  assert.equal(runner.requests.length, 6);
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

test("CLI run sends Testing Strategy a prompt containing prior specialist outputs", async () => {
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
  assert.equal(runner.requests[4]?.agentId, "testing_strategy");
  const prompt = runner.requests[4]?.prompt ?? "";
  assert.match(prompt, /# Agent Prompt: testing_strategy/);
  assert.match(prompt, /Previous Outputs/);
  assert.match(prompt, /patterns/);
  assert.match(prompt, /flows/);
  assert.match(prompt, /Testing Strategy Agent Output Rules/);
  assert.match(prompt, /commandEvidence/);
});

test("CLI run sends Tradeoff Analyst a prompt containing prior risk and pattern outputs", async () => {
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
  assert.equal(runner.requests[5]?.agentId, "tradeoff_analyst");
  const prompt = runner.requests[5]?.prompt ?? "";
  assert.match(prompt, /# Agent Prompt: tradeoff_analyst/);
  assert.match(prompt, /Previous Outputs/);
  assert.match(prompt, /architectureRisks/);
  assert.match(prompt, /patterns/);
  assert.match(prompt, /testingRisks/);
  assert.match(prompt, /Tradeoff Analyst Agent Output Rules/);
  assert.match(prompt, /adaptationWarnings/);
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
    [
      scoutFinding,
      architectureFinding,
      patternMinerFinding,
      flowTracerFinding,
      testingStrategyFinding,
      tradeoffAnalystFinding,
    ],
  );
  assert.deepEqual(
    (await readFile(join(workspaceRoot, "memory", "verified_findings.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as unknown),
    [
      scoutFinding,
      architectureFinding,
      patternMinerFinding,
      flowTracerFinding,
      testingStrategyFinding,
      tradeoffAnalystFinding,
    ],
  );
  assert.match(
    await readFile(
      join(workspaceRoot, "validation", "scout", "attempt-1", "report.json"),
      "utf8",
    ),
    /"status": "passed"/,
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(workspaceRoot, "validation", "command_report.json"),
        "utf8",
      ),
    ),
    {
      skipped: true,
      reason:
        "Quality command execution is disabled by default. Use --run-quality-commands or runQualityCommands: true only for trusted repositories.",
      commands: [],
    },
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
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(workspaceRoot, "agents", "testing_strategy", "attempt-1", "output.json"),
        "utf8",
      ),
    ),
    testingStrategyOutput,
  );
  assert.match(
    await readFile(
      join(
        workspaceRoot,
        "validation",
        "testing_strategy",
        "attempt-1",
        "report.json",
      ),
      "utf8",
    ),
    /"contract": "testing-strategy-output"/,
  );
  assert.match(
    await readFile(
      join(
        workspaceRoot,
        "validation",
        "testing_strategy",
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
        join(
          workspaceRoot,
          "agents",
          "tradeoff_analyst",
          "attempt-1",
          "output.json",
        ),
        "utf8",
      ),
    ),
    tradeoffAnalystOutput,
  );
  assert.match(
    await readFile(
      join(
        workspaceRoot,
        "validation",
        "tradeoff_analyst",
        "attempt-1",
        "report.json",
      ),
      "utf8",
    ),
    /"contract": "tradeoff-analyst-output"/,
  );
  assert.match(
    await readFile(
      join(
        workspaceRoot,
        "validation",
        "tradeoff_analyst",
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
    6,
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
    /Approved findings used: 6/,
  );
  assert.match(
    await readFile(
      join(workspaceRoot, "final", "docs", "03-feature-flow-traces.md"),
      "utf8",
    ),
    /The visible inspection flow starts from README context/,
  );
  assert.match(
    await readFile(
      join(workspaceRoot, "final", "docs", "05-testing-strategy.md"),
      "utf8",
    ),
    /fixture protects CLI behavior/,
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
      successfulTestingStrategyResult(),
      successfulTradeoffAnalystResult(),
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
      ["testing_strategy", 1],
      ["tradeoff_analyst", 1],
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
  const retryStatus = JSON.parse(
    await readFile(
      join(workspaceRoot, "agents", "architecture", "attempt-2", "status.json"),
      "utf8",
    ),
  ) as { status?: string; history?: Array<{ to?: string }> };
  assert.equal(retryStatus.status, "EVIDENCE_VALIDATED");
  assert.deepEqual(
    retryStatus.history?.map((transition) => transition.to),
    [
      "PENDING",
      "RUNNING",
      "OUTPUT_RECEIVED",
      "SCHEMA_VALIDATED",
      "EVIDENCE_VALIDATED",
    ],
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
      successfulTestingStrategyResult(),
      successfulTradeoffAnalystResult(),
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
      ["testing_strategy", 1],
      ["tradeoff_analyst", 1],
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
    71,
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
        successfulTestingStrategyResult(JSON.stringify(testingStrategyOutput)),
        successfulTradeoffAnalystResult(JSON.stringify(tradeoffAnalystOutput)),
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
  assert.match(stdout.join("\n"), /Run workspace creation started/);
  assert.match(stdout.join("\n"), /Repository indexing started/);
  assert.match(stdout.join("\n"), /\[scout:status\] Scout started/);
  assert.match(stdout.join("\n"), /Agent started: Architecture/);
  assert.match(stdout.join("\n"), /\[architecture:status\] Scout started/);
  assert.match(stdout.join("\n"), /Agent started: Pattern Miner/);
  assert.match(stdout.join("\n"), /\[pattern_miner:status\] Scout started/);
  assert.match(stdout.join("\n"), /Agent started: Flow Tracer/);
  assert.match(stdout.join("\n"), /\[flow_tracer:status\] Scout started/);
  assert.match(stdout.join("\n"), /Agent started: Testing Strategy/);
  assert.match(stdout.join("\n"), /\[testing_strategy:status\] Scout started/);
  assert.match(stdout.join("\n"), /Agent started: Tradeoff Analyst/);
  assert.match(stdout.join("\n"), /\[tradeoff_analyst:status\] Scout started/);
  assert.match(stdout.join("\n"), /Inspection run workspace:/);
});

test("CLI run prints professional verbose inspection progress", async () => {
  const fixture = await createFixture();
  const stdout: string[] = [];
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
        successfulScoutResult(),
        successfulArchitectureResult(JSON.stringify(contradictoryArchitectureOutput)),
        successfulPatternMinerResult(),
        successfulFlowTracerResult(),
        successfulTestingStrategyResult(),
        successfulTradeoffAnalystResult(),
        successfulArchitectureResult(JSON.stringify(repairedArchitectureOutput)),
      ],
    }),
    stdout: (line) => stdout.push(line),
  });

  assert.equal(result.exitCode, 0);
  const output = stdout.join("\n");
  assert.match(output, /Inspection started: target-repo/);
  assert.match(output, /Repository indexing started/);
  assert.match(output, /Repository indexing finished/);
  assert.match(output, /Agent started: Scout \(attempt 1\)/);
  assert.match(output, /Agent finished: Scout \(attempt 1\)/);
  assert.match(output, /Validation passed: Scout schema/);
  assert.match(output, /Validation passed: Scout evidence/);
  assert.match(output, /QA issues found: [1-9]/);
  assert.match(output, /Retrying Architecture after QA feedback \(attempt 2\)/);
  assert.match(output, /QA verification passed: 6 approved, 0 rejected/);
  assert.match(output, /Final output: .*final\/docs/);
  assert.match(output, /Inspection run workspace:/);

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
  assert.ok(result.workspace);
  const status = JSON.parse(
    await readFile(
      join(result.workspace.root, "agents", "scout", "attempt-1", "status.json"),
      "utf8",
    ),
  ) as { status?: string; history?: Array<{ to?: string }> };
  assert.equal(status.status, "FAILED");
  assert.deepEqual(status.history?.map((transition) => transition.to), [
    "PENDING",
    "RUNNING",
    "OUTPUT_RECEIVED",
    "SCHEMA_FAILED",
    "FAILED",
  ]);
});

test("CLI run reports useful failures without stack traces by default", async () => {
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
      results: [successfulScoutResult(JSON.stringify({ findings: [scoutFinding] }))],
    }),
    stderr: (line) => stderr.push(line),
    stdout: () => undefined,
  });

  const errorOutput = stderr.join("\n");
  assert.equal(result.exitCode, 1);
  assert.match(errorOutput, /Scout schema validation failed/);
  assert.match(
    errorOutput,
    /Run workspace: .*2026-06-20T01-02-03-004Z_target-repo/,
  );
  assert.match(errorOutput, /Use --debug to show the stack trace/);
  assert.doesNotMatch(errorOutput, /\n\s+at /);
});

test("CLI run prints stack traces when debug mode is enabled", async () => {
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
      "--debug",
    ],
    clock: fixedClock,
    runner: new FakeAgentRunner({
      results: [successfulScoutResult(JSON.stringify({ findings: [scoutFinding] }))],
    }),
    stderr: (line) => stderr.push(line),
    stdout: () => undefined,
  });

  const errorOutput = stderr.join("\n");
  assert.equal(result.exitCode, 1);
  assert.match(errorOutput, /Scout schema validation failed/);
  assert.match(errorOutput, /Run workspace:/);
  assert.match(errorOutput, /\n\s+at /);
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
  assert.ok(result.workspace);
  const status = JSON.parse(
    await readFile(
      join(result.workspace.root, "agents", "scout", "attempt-1", "status.json"),
      "utf8",
    ),
  ) as { status?: string; history?: Array<{ to?: string }> };
  assert.equal(status.status, "FAILED");
  assert.deepEqual(status.history?.map((transition) => transition.to), [
    "PENDING",
    "RUNNING",
    "OUTPUT_RECEIVED",
    "SCHEMA_VALIDATED",
    "EVIDENCE_FAILED",
    "FAILED",
  ]);
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

test("CLI run fails when Testing Strategy claims a passed gate without passed command evidence", async () => {
  const fixture = await createFixture();
  const stderr: string[] = [];
  const invalidTestingStrategyOutput = {
    ...testingStrategyOutput,
    qualityGates: [
      {
        ...testingStrategyOutput.qualityGates[0],
        status: "passed",
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
        successfulFlowTracerResult(),
        successfulTestingStrategyResult(JSON.stringify(invalidTestingStrategyOutput)),
      ],
    }),
    stderr: (line) => stderr.push(line),
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 1);
  assert.match(stderr.join("\n"), /Testing Strategy schema validation failed/);
  assert.match(stderr.join("\n"), /claims npm test passed without passed command evidence/);
});

test("CLI run fails when Testing Strategy evidence cites missing repository lines", async () => {
  const fixture = await createFixture();
  const stderr: string[] = [];
  const invalidTestingStrategyOutput = {
    ...testingStrategyOutput,
    testingRisks: [
      {
        ...testingStrategyOutput.testingRisks[0],
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
        successfulFlowTracerResult(),
        successfulTestingStrategyResult(JSON.stringify(invalidTestingStrategyOutput)),
      ],
    }),
    stderr: (line) => stderr.push(line),
    stdout: () => undefined,
  });

  assert.equal(result.exitCode, 1);
  assert.match(stderr.join("\n"), /Testing Strategy evidence validation failed/);
});
