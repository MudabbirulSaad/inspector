import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildAgentPrompt } from "../../src/application/index.js";
import {
  NodePromptArtifactWriter,
  NodePromptTemplateReader,
} from "../../src/adapters/filesystem/index.js";
import type {
  PromptArtifactWriter,
  PromptTemplateReader,
  RunWorkspace,
} from "../../src/ports/index.js";

class InMemoryPromptTemplates implements PromptTemplateReader {
  constructor(private readonly templates: Record<string, string>) {}

  async readTemplate(path: string): Promise<string> {
    const template = this.templates[path];

    if (template === undefined) {
      throw new Error(`missing template ${path}`);
    }

    return template;
  }
}

class InMemoryPromptArtifacts implements PromptArtifactWriter {
  writes: { agentId: string; attempt: number; content: string }[] = [];

  async writeAgentPrompt(request: {
    workspace: RunWorkspace;
    agentId: string;
    attempt: number;
    content: string;
  }): Promise<{ path: string }> {
    this.writes.push({
      agentId: request.agentId,
      attempt: request.attempt,
      content: request.content,
    });

    return {
      path: `${request.workspace.root}/agents/${request.agentId}/attempt-${request.attempt}/prompt.md`,
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

test("prompt builder loads templates, injects run context, and writes the exact prompt artifact", async () => {
  const templates = new InMemoryPromptTemplates({
    "shared/senior-engineer-rules.md": "Use senior engineering judgment.",
    "shared/evidence-rules.md": "Every claim needs file and line evidence.",
    "shared/output-contract-rules.md": "Return schema-valid output.",
    "shared/revision-rules.md": "Address revision requests exactly.",
    "agents/scout.md": "Scout {{targetRepoContext}} for {{objective}}.",
  });
  const artifacts = new InMemoryPromptArtifacts();

  const result = await buildAgentPrompt({
    agentId: "scout",
    attempt: 1,
    workspace,
    templates,
    artifacts,
    objective: "inspect architecture risks",
    targetRepoContext: "repo: inspector",
    repoIndexSummary: "TypeScript CLI with docs and schemas",
    previousOutputs: { architecture: "not run" },
    memorySnapshot: "No prior findings.",
    outputSchema: { type: "object", required: ["findings"] },
  });

  assert.equal(result.artifactPath, "/tmp/run/agents/scout/attempt-1/prompt.md");
  assert.equal(artifacts.writes.length, 1);
  assert.equal(artifacts.writes[0]?.content, result.prompt);
  assert.match(result.prompt, /# Agent Prompt: scout/);
  assert.match(result.prompt, /Use senior engineering judgment/);
  assert.match(result.prompt, /Every claim needs file and line evidence/);
  assert.match(result.prompt, /inspect architecture risks/);
  assert.match(result.prompt, /TypeScript CLI with docs and schemas/);
  assert.match(result.prompt, /"required": \[/);
});

test("filesystem prompt adapters load repository templates and save exact prompts under the run workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-prompts-"));
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

  const result = await buildAgentPrompt({
    agentId: "architecture",
    attempt: 2,
    workspace: filesystemWorkspace,
    templates: new NodePromptTemplateReader("prompts"),
    artifacts: new NodePromptArtifactWriter(),
    objective: "inspect boundaries",
    targetRepoContext: "repo: inspector",
    repoIndexSummary: "repo_index/repo_summary.json exists",
    previousOutputs: "Scout found architecture docs.",
    memorySnapshot: "Decision: preserve ports.",
    outputSchema: "finding",
  });

  const savedPrompt = await readFile(result.artifactPath, "utf8");

  assert.equal(
    result.artifactPath,
    join(root, "agents", "architecture", "attempt-2", "prompt.md"),
  );
  assert.equal(savedPrompt, result.prompt);
  assert.match(savedPrompt, /architecture inspector/i);
  assert.match(savedPrompt, /inspect boundaries/);
  assert.match(
    savedPrompt,
    /Evidence must cite files from the inspected target repository/,
  );
  assert.match(savedPrompt, /\.inspector-dogfood/);
  assert.match(savedPrompt, /\.inspector-runs/);
});

test("prompt builder reports the missing template path", async () => {
  const templates = new InMemoryPromptTemplates({
    "shared/senior-engineer-rules.md": "Use senior engineering judgment.",
    "shared/evidence-rules.md": "Every claim needs file and line evidence.",
    "shared/output-contract-rules.md": "Return schema-valid output.",
    "shared/revision-rules.md": "Address revision requests exactly.",
  });

  await assert.rejects(
    buildAgentPrompt({
      agentId: "qa_verifier",
      attempt: 1,
      workspace,
      templates,
      artifacts: new InMemoryPromptArtifacts(),
      objective: "verify findings",
      targetRepoContext: "repo: inspector",
      repoIndexSummary: "summary",
      previousOutputs: [],
      memorySnapshot: "empty",
      outputSchema: "qa-result",
    }),
    /missing template agents\/qa-verifier.md/,
  );
});

test("prompt builder includes revision request context for retry attempts", async () => {
  const templates = new InMemoryPromptTemplates({
    "shared/senior-engineer-rules.md": "Use senior engineering judgment.",
    "shared/evidence-rules.md": "Every claim needs file and line evidence.",
    "shared/output-contract-rules.md": "Return schema-valid output.",
    "shared/revision-rules.md": "Address revision requests exactly: {{revisionRequest}}",
    "agents/pattern-miner.md": "Revise pattern output for {{objective}}.",
  });

  const result = await buildAgentPrompt({
    agentId: "pattern_miner",
    attempt: 2,
    workspace,
    templates,
    artifacts: new InMemoryPromptArtifacts(),
    objective: "inspect repeated patterns",
    targetRepoContext: "repo: inspector",
    repoIndexSummary: "summary",
    previousOutputs: { scout: "found src/application" },
    memorySnapshot: "QA requested more evidence.",
    outputSchema: "finding",
    revisionRequest: {
      id: "revision-1",
      findingId: "finding-1",
      requiredCorrections: ["Add line evidence for repeated pattern claim."],
    },
  });

  assert.match(result.prompt, /## Revision Request/);
  assert.match(result.prompt, /revision-1/);
  assert.match(result.prompt, /Add line evidence/);
  assert.match(result.prompt, /Address revision requests exactly/);
});
