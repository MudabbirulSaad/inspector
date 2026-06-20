import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeAgentLifecycleStatus } from "../../src/application/index.js";
import { NodeAgentStatusArtifactWriter } from "../../src/adapters/filesystem/index.js";
import {
  createAgentLifecycle,
  transitionAgentLifecycle,
} from "../../src/domain/agent-lifecycle.js";
import type {
  AgentStatusArtifactWriter,
  RunWorkspace,
} from "../../src/ports/index.js";

class InMemoryAgentStatusArtifacts implements AgentStatusArtifactWriter {
  writes: { agentId: string; attempt: number; content: string }[] = [];

  async writeAgentStatus(
    request: Parameters<AgentStatusArtifactWriter["writeAgentStatus"]>[0],
  ): Promise<{ path: string }> {
    this.writes.push({
      agentId: request.agentId,
      attempt: request.attempt,
      content: request.content,
    });

    return {
      path: `${request.workspace.root}/agents/${request.agentId}/attempt-${request.attempt}/status.json`,
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

test("application writes serialized lifecycle status through an artifact port", async () => {
  const lifecycle = transitionAgentLifecycle(
    createAgentLifecycle({
      agentId: "architecture",
      timestamp: "2026-06-20T10:00:00.000Z",
    }),
    { to: "RUNNING", timestamp: "2026-06-20T10:01:00.000Z" },
  );
  const artifacts = new InMemoryAgentStatusArtifacts();

  const result = await writeAgentLifecycleStatus({
    workspace,
    lifecycle,
    artifacts,
  });

  assert.equal(
    result.artifactPath,
    "/tmp/run/agents/architecture/attempt-1/status.json",
  );
  assert.equal(artifacts.writes.length, 1);
  assert.equal(artifacts.writes[0]?.attempt, 1);
  assert.match(artifacts.writes[0]?.content ?? "", /"status": "RUNNING"/);
});

test("filesystem status artifact writer saves status under the agent attempt folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "inspector-agent-status-"));
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
  const lifecycle = transitionAgentLifecycle(
    createAgentLifecycle({
      agentId: "scout",
      timestamp: "2026-06-20T10:00:00.000Z",
    }),
    { to: "RUNNING", timestamp: "2026-06-20T10:01:00.000Z" },
  );

  const result = await writeAgentLifecycleStatus({
    workspace: filesystemWorkspace,
    lifecycle,
    artifacts: new NodeAgentStatusArtifactWriter(),
  });

  const saved = await readFile(result.artifactPath, "utf8");

  assert.equal(
    result.artifactPath,
    join(root, "agents", "scout", "attempt-1", "status.json"),
  );
  assert.match(saved, /"agentId": "scout"/);
  assert.match(saved, /"attempts": 1/);
});
