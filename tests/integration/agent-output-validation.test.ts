import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { NodeValidationReportWriter } from "../../src/adapters/filesystem/index.js";
import { getAgentContract } from "../../src/agents/index.js";
import { validateAgentOutput } from "../../src/application/index.js";
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
