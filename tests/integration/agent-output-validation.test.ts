import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { NodeValidationReportWriter } from "../../src/adapters/filesystem/index.js";
import { getAgentContract } from "../../src/agents/index.js";
import { validateAgentOutput } from "../../src/application/index.js";
import type { QualityCommandReport } from "../../src/application/run-quality-commands.js";
import type {
  RunWorkspace,
  ValidationReportWriter,
} from "../../src/ports/index.js";
import { createSchemaContractValidators } from "../../src/validation/index.js";

class InMemoryValidationReports implements ValidationReportWriter {
  writes: { agentId: string; attempt: number; content: string }[] = [];

  async writeAgentValidationReport(
    request: Parameters<ValidationReportWriter["writeAgentValidationReport"]>[0],
  ): Promise<{ path: string }> {
    this.writes.push({
      agentId: request.agentId,
      attempt: request.attempt,
      content: request.content,
    });

    return {
      path: `${request.workspace.root}/validation/${request.agentId}/attempt-${request.attempt}/report.json`,
    };
  }
}

const workspace: RunWorkspace = {
  name: "2026-06-20_target",
  root: "/tmp/run",
  configFile: "/tmp/run/config.json",
  folders: {
    input: "/tmp/run/input",
    repoIndex: "/tmp/run/repo_index",
    memory: "/tmp/run/memory",
    agents: "/tmp/run/agents",
    validation: "/tmp/run/validation",
    qa: "/tmp/run/qa",
    final: "/tmp/run/final",
  },
};

async function readExample(contract: string): Promise<string> {
  return readFile(`examples/${contract}.example.json`, "utf8");
}

async function readExampleObject(contract: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readExample(contract)) as Record<string, unknown>;
}

test("agent output validator selects the agent schema, parses valid JSON, and writes a passing report", async () => {
  const reports = new InMemoryValidationReports();

  const result = await validateAgentOutput({
    workspace,
    agent: getAgentContract("architecture"),
    attempt: 1,
    rawOutput: await readExample("architecture-output"),
    validators: await createSchemaContractValidators(),
    reports,
  });

  assert.equal(result.valid, true);
  assert.equal(result.contract, "architecture-output");
  assert.equal(
    result.reportPath,
    "/tmp/run/validation/architecture/attempt-1/report.json",
  );
  assert.equal(reports.writes.length, 1);
  assert.match(reports.writes[0]?.content ?? "", /"status": "passed"/);
});

test("agent output validator reports malformed JSON without throwing", async () => {
  const reports = new InMemoryValidationReports();

  const result = await validateAgentOutput({
    workspace,
    agent: getAgentContract("architecture"),
    attempt: 2,
    rawOutput: "{ not json",
    validators: await createSchemaContractValidators(),
    reports,
  });

  assert.equal(result.valid, false);
  assert.equal(result.status, "malformed-json");
  assert.equal(result.errors[0]?.type, "malformed-json");
  assert.match(result.errors[0]?.message ?? "", /Malformed JSON output/);
  assert.match(reports.writes[0]?.content ?? "", /"status": "malformed-json"/);
  assert.match(reports.writes[0]?.content ?? "", /Malformed JSON output/);
});

test("agent output validator reports missing required fields as schema violations", async () => {
  const reports = new InMemoryValidationReports();
  const output = await readExampleObject("architecture-output");
  delete output.dependencyDirection;

  const result = await validateAgentOutput({
    workspace,
    agent: getAgentContract("architecture"),
    attempt: 1,
    rawOutput: JSON.stringify(output),
    validators: await createSchemaContractValidators(),
    reports,
  });

  assert.equal(result.valid, false);
  assert.equal(result.status, "schema-invalid");
  assert.equal(result.errors[0]?.type, "schema-violation");
  assert.equal(result.errors[0]?.contract, "architecture-output");
  assert.match(result.errors[0]?.message ?? "", /Architecture output/);
  assert.match(result.errors[0]?.message ?? "", /dependencyDirection/);
  assert.match(reports.writes[0]?.content ?? "", /"status": "schema-invalid"/);
  assert.match(reports.writes[0]?.content ?? "", /dependencyDirection/);
});

test("agent output validator uses the selected agent contract rather than the output shape", async () => {
  const reports = new InMemoryValidationReports();

  const result = await validateAgentOutput({
    workspace,
    agent: getAgentContract("qa_verifier"),
    attempt: 1,
    rawOutput: await readExample("finding"),
    validators: await createSchemaContractValidators(),
    reports,
  });

  assert.equal(result.valid, false);
  assert.equal(result.contract, "qa-result");
  assert.equal(result.status, "schema-invalid");
  assert.equal(result.errors[0]?.contract, "qa-result");
  assert.match(result.errors[0]?.message ?? "", /QA result/);
  assert.match(reports.writes[0]?.content ?? "", /"contract": "qa-result"/);
});

test("agent output validator rejects Testing Strategy passed gates without passed command evidence", async () => {
  const reports = new InMemoryValidationReports();
  const output = await readExampleObject("testing-strategy-output");
  output.commandEvidence = [
    {
      command: "npm test",
      status: "not-run",
      evidence: [{ file: "package.json", lineStart: 1, lineEnd: 12 }],
    },
  ];

  const result = await validateAgentOutput({
    workspace,
    agent: getAgentContract("testing_strategy"),
    attempt: 1,
    rawOutput: JSON.stringify(output),
    validators: await createSchemaContractValidators(),
    reports,
  });

  assert.equal(result.valid, false);
  assert.equal(result.status, "schema-invalid");
  assert.match(
    result.errors.map((error) => error.message).join("\n"),
    /claims npm test passed without passed command evidence/,
  );
  assert.match(reports.writes[0]?.content ?? "", /npm test/);
});

test("agent output validator rejects Testing Strategy passed command claims when command report was skipped", async () => {
  const result = await validateTestingStrategyWithCommandReport({
    commandEvidenceStatus: "passed",
    qualityGateStatus: "passed",
    report: skippedCommandReport(),
  });

  assert.equal(result.valid, false);
  assert.match(
    result.errors.map((error) => error.message).join("\n"),
    /command report was skipped/,
  );
});

test("agent output validator accepts Testing Strategy not-run command claims when command report was skipped", async () => {
  const result = await validateTestingStrategyWithCommandReport({
    commandEvidenceStatus: "not-run",
    qualityGateStatus: "not-run",
    report: skippedCommandReport(),
  });

  assert.equal(result.valid, true);
});

test("agent output validator accepts Testing Strategy passed command claims matching the command report", async () => {
  const result = await validateTestingStrategyWithCommandReport({
    commandEvidenceStatus: "passed",
    qualityGateStatus: "passed",
    report: commandReport("passed"),
  });

  assert.equal(result.valid, true);
});

test("agent output validator accepts Testing Strategy failed command claims matching the command report", async () => {
  const result = await validateTestingStrategyWithCommandReport({
    commandEvidenceStatus: "failed",
    qualityGateStatus: "failed",
    report: commandReport("failed"),
  });

  assert.equal(result.valid, true);
});

test("agent output validator rejects Testing Strategy not-run claims that contradict an executed command report entry", async () => {
  const result = await validateTestingStrategyWithCommandReport({
    commandEvidenceStatus: "not-run",
    qualityGateStatus: "not-run",
    report: commandReport("passed"),
  });

  assert.equal(result.valid, false);
  assert.match(
    result.errors.map((error) => error.message).join("\n"),
    /contradicts executed command report entry/,
  );
});

test("agent output validator rejects Testing Strategy passed command claims missing from the command report", async () => {
  const result = await validateTestingStrategyWithCommandReport({
    commandEvidenceStatus: "passed",
    qualityGateStatus: "passed",
    report: { commands: [] },
  });

  assert.equal(result.valid, false);
  assert.match(
    result.errors.map((error) => error.message).join("\n"),
    /no matching quality command report entry/,
  );
});

test("agent output validator rejects aggregate Testing Strategy command claims not present in the command report", async () => {
  const reports = new InMemoryValidationReports();
  const output = await readExampleObject("testing-strategy-output");
  output.qualityGates = [
    {
      command: "npm run validate",
      status: "passed",
      summary: "Aggregate validation passed.",
      evidence: [{ file: "package.json", lineStart: 1, lineEnd: 12 }],
    },
  ];
  output.commandEvidence = [
    {
      command: "npm run validate",
      status: "passed",
      exitCode: 0,
      ranAt: "2026-06-20T01:02:03.004Z",
      evidence: [{ file: "package.json", lineStart: 1, lineEnd: 12 }],
    },
  ];

  const result = await validateAgentOutput({
    workspace,
    agent: getAgentContract("testing_strategy"),
    attempt: 1,
    rawOutput: JSON.stringify(output),
    validators: await createSchemaContractValidators(),
    reports,
    qualityCommandReport: {
      commands: [
        qualityCommand("npm", ["test"]),
        qualityCommand("npm", ["run", "typecheck"]),
        qualityCommand("npm", ["run", "lint"]),
        qualityCommand("npm", ["run", "build"]),
      ],
    },
  });

  assert.equal(result.valid, false);
  assert.match(
    result.errors.map((error) => error.message).join("\n"),
    /no matching quality command report entry.*npm run validate|npm run validate.*no matching quality command report entry/,
  );
});

test("agent output validator accepts exact Testing Strategy command matches from the command report", async () => {
  const result = await validateTestingStrategyWithCommandReport({
    commandEvidenceStatus: "passed",
    qualityGateStatus: "passed",
    report: {
      commands: [qualityCommand("npm", ["test"])],
    },
  });

  assert.equal(result.valid, true);
});

async function validateTestingStrategyWithCommandReport(input: {
  commandEvidenceStatus: "passed" | "failed" | "not-run";
  qualityGateStatus: "passed" | "failed" | "not-run";
  report: QualityCommandReport;
}): ReturnType<typeof validateAgentOutput> {
  const reports = new InMemoryValidationReports();
  const output = await readExampleObject("testing-strategy-output");
  output.qualityGates = [
    {
      command: "npm test",
      status: input.qualityGateStatus,
      summary: "Quality command claim under test.",
      evidence: [{ file: "package.json", lineStart: 1, lineEnd: 12 }],
    },
  ];
  output.commandEvidence = [
    {
      command: "npm test",
      status: input.commandEvidenceStatus,
      ...(input.commandEvidenceStatus === "not-run"
        ? {}
        : {
            exitCode: input.commandEvidenceStatus === "passed" ? 0 : 1,
            ranAt: "2026-06-20T01:02:03.004Z",
          }),
      evidence: [{ file: "package.json", lineStart: 1, lineEnd: 12 }],
    },
  ];

  return validateAgentOutput({
    workspace,
    agent: getAgentContract("testing_strategy"),
    attempt: 1,
    rawOutput: JSON.stringify(output),
    validators: await createSchemaContractValidators(),
    reports,
    qualityCommandReport: input.report,
  });
}

function skippedCommandReport(): QualityCommandReport {
  return {
    skipped: true,
    reason:
      "Quality command execution is disabled by default. Use --run-quality-commands or runQualityCommands: true only for trusted repositories.",
    commands: [],
  };
}

function commandReport(status: "passed" | "failed"): QualityCommandReport {
  return {
    commands: [
      {
        ...qualityCommand("npm", ["test"]),
        exitCode: status === "passed" ? 0 : 1,
        status,
      },
    ],
  };
}

function qualityCommand(
  command: string,
  args: string[],
): QualityCommandReport["commands"][number] {
  return {
    command,
    args,
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    durationMs: 100,
    status: "passed",
  };
}

test("agent output validator rejects Tradeoff Analyst outputs with unsupported tradeoffs", async () => {
  const reports = new InMemoryValidationReports();
  const output = await readExampleObject("tradeoff-analyst-output");
  output.weakDecisions = [
    {
      decision: "Unsupported tradeoff",
      tradeoff: "This claim has no cited repository evidence.",
      risk: "QA cannot verify it.",
      evidence: [],
      confidence: 0.7,
    },
  ];

  const result = await validateAgentOutput({
    workspace,
    agent: getAgentContract("tradeoff_analyst"),
    attempt: 1,
    rawOutput: JSON.stringify(output),
    validators: await createSchemaContractValidators(),
    reports,
  });

  assert.equal(result.valid, false);
  assert.equal(result.status, "schema-invalid");
  assert.match(
    result.errors.map((error) => error.message).join("\n"),
    /evidence/,
  );
  assert.match(reports.writes[0]?.content ?? "", /schema-invalid/);
});

test("agent output validator rejects Tradeoff Analyst outputs that only praise decisions", async () => {
  const reports = new InMemoryValidationReports();
  const output = await readExampleObject("tradeoff-analyst-output");
  output.weakDecisions = [];
  output.overengineeringRisks = [];
  output.underengineeringRisks = [];
  output.hiddenAssumptions = [];
  output.agentSafetyRisks = [];
  output.adaptationWarnings = [];

  const result = await validateAgentOutput({
    workspace,
    agent: getAgentContract("tradeoff_analyst"),
    attempt: 1,
    rawOutput: JSON.stringify(output),
    validators: await createSchemaContractValidators(),
    reports,
  });

  assert.equal(result.valid, false);
  assert.equal(result.status, "schema-invalid");
  assert.match(
    result.errors.map((error) => error.message).join("\n"),
    /must not only praise/,
  );
});

test("filesystem validation report writer saves reports under the validation workspace folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-validation-report-"));
  const filesystemWorkspace: RunWorkspace = {
    ...workspace,
    root,
    configFile: join(root, "config.json"),
    folders: {
      input: join(root, "input"),
      repoIndex: join(root, "repo_index"),
      memory: join(root, "memory"),
      agents: join(root, "agents"),
      validation: join(root, "validation"),
      qa: join(root, "qa"),
      final: join(root, "final"),
    },
  };

  const result = await validateAgentOutput({
    workspace: filesystemWorkspace,
    agent: getAgentContract("final_reviewer"),
    attempt: 1,
    rawOutput: await readExample("inspection-report"),
    validators: await createSchemaContractValidators(),
    reports: new NodeValidationReportWriter(),
  });
  const saved = await readFile(result.reportPath, "utf8");

  assert.equal(
    result.reportPath,
    join(root, "validation", "final_reviewer", "attempt-1", "report.json"),
  );
  assert.match(saved, /"agentId": "final_reviewer"/);
  assert.match(saved, /"status": "passed"/);
});
