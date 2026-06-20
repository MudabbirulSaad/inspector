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
    rawOutput: await readExample("finding"),
    validators: await createSchemaContractValidators(),
    reports,
  });

  assert.equal(result.valid, true);
  assert.equal(result.contract, "finding");
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
  const finding = await readExampleObject("finding");
  delete finding.claim;

  const result = await validateAgentOutput({
    workspace,
    agent: getAgentContract("architecture"),
    attempt: 1,
    rawOutput: JSON.stringify(finding),
    validators: await createSchemaContractValidators(),
    reports,
  });

  assert.equal(result.valid, false);
  assert.equal(result.status, "schema-invalid");
  assert.equal(result.errors[0]?.type, "schema-violation");
  assert.equal(result.errors[0]?.contract, "finding");
  assert.match(result.errors[0]?.message ?? "", /Finding/);
  assert.match(result.errors[0]?.message ?? "", /claim/);
  assert.match(reports.writes[0]?.content ?? "", /"status": "schema-invalid"/);
  assert.match(reports.writes[0]?.content ?? "", /claim/);
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
