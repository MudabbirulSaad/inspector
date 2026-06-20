import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir, platform as currentPlatform } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  AgentOutputArtifactWriter,
  AgentOutputSchemaReader,
  AgentStatusArtifactWriter,
  CaseStudyDocumentWriter,
  EvidenceValidationReportWriter,
  PromptArtifactWriter,
  PromptTemplateReader,
  QaArtifactWriter,
  QualityCommandReportWriter,
  RagKnowledgeCardStream,
  RagKnowledgeCardWriter,
  RepositoryEntry,
  RepositoryIndexPromptContextReader,
  RepositoryIndexWriter,
  RepositoryReader,
  RunDataWorkspaceStore,
  RunWorkspace,
  RunWorkspaceRequest,
  RunWorkspaceStore,
  SwarmMemoryStore,
  SwarmMemoryStream,
  UserDataDirectoryProvider,
  ValidationReportWriter,
} from "../../ports/index.js";

export const filesystemAdapterBoundary = "adapters.filesystem" as const;

const workspaceFolders = [
  "input",
  "repo_index",
  "memory",
  "agents",
  "validation",
  "qa",
  "final",
] as const;

const memoryFiles = {
  events: "events.jsonl",
  findings: "findings.jsonl",
  decisions: "decisions.jsonl",
  qaIssues: "qa_issues.jsonl",
  verifiedFindings: "verified_findings.jsonl",
  rejectedFindings: "rejected_findings.jsonl",
} as const satisfies Record<SwarmMemoryStream, string>;

const allMemoryFiles = ["blackboard.md", ...Object.values(memoryFiles)] as const;

export class NodeRunWorkspaceStore implements RunWorkspaceStore {
  async create(request: RunWorkspaceRequest): Promise<RunWorkspace> {
    try {
      await mkdir(request.outputDirectory, { recursive: true });

      const { name, root } = await createUniqueWorkspaceRoot(request);

      await writeFile(join(root, "config.json"), request.configJson, {
        flag: "wx",
      });

      for (const folder of workspaceFolders) {
        await mkdir(join(root, folder));
      }

      return toRunWorkspace(name, root);
    } catch (error) {
      throw new Error(
        `Cannot create inspection run workspace in ${request.outputDirectory}`,
        { cause: error },
      );
    }
  }
}

export class NodeUserDataDirectoryProvider
  implements UserDataDirectoryProvider
{
  constructor(
    private readonly options: {
      platform?: NodeJS.Platform;
      env?: Record<string, string | undefined>;
      homeDirectory?: string;
    } = {},
  ) {}

  async getInspectorDataRoot(): Promise<string> {
    const platform = this.options.platform ?? currentPlatform();
    const env = this.options.env ?? process.env;
    const homeDirectory = this.options.homeDirectory ?? homedir();

    if (platform === "win32") {
      return join(env.APPDATA ?? join(homeDirectory, "AppData", "Roaming"), "inspector");
    }

    if (platform === "darwin") {
      return join(homeDirectory, "Library", "Application Support", "inspector");
    }

    return join(env.XDG_DATA_HOME ?? join(homeDirectory, ".local", "share"), "inspector");
  }
}

export class NodeRunDataWorkspaceStore
  implements RunDataWorkspaceStore, RunWorkspaceStore
{
  constructor(
    private readonly options:
      | { dataRoot: string }
      | { provider: UserDataDirectoryProvider },
  ) {}

  async create(request: RunWorkspaceRequest): Promise<RunWorkspace> {
    return this.createRunDataWorkspace(request);
  }

  async createRunDataWorkspace(
    request: RunWorkspaceRequest,
  ): Promise<RunWorkspace> {
    const dataRoot = await this.getDataRoot();
    const workspace = await new NodeRunWorkspaceStore().create({
      ...request,
      outputDirectory: join(dataRoot, "runs"),
    });
    await this.writeLastRunPointer(workspace.root);
    return workspace;
  }

  async getLastRunPointer(): Promise<string | undefined> {
    try {
      const pointer = (await readFile(await this.lastRunPointerPath(), "utf8")).trim();
      return pointer.length === 0 ? undefined : pointer;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }

      throw error;
    }
  }

  async writeLastRunPointer(path: string): Promise<void> {
    const pointerPath = await this.lastRunPointerPath();
    await mkdir(await this.getDataRoot(), { recursive: true });
    await writeFile(pointerPath, `${path}\n`);
  }

  private async lastRunPointerPath(): Promise<string> {
    return join(await this.getDataRoot(), "last-run");
  }

  private async getDataRoot(): Promise<string> {
    if ("dataRoot" in this.options) {
      return this.options.dataRoot;
    }

    return this.options.provider.getInspectorDataRoot();
  }
}

export class NodeRepositoryReader implements RepositoryReader {
  constructor(private readonly root: string) {}

  async listEntries(): Promise<RepositoryEntry[]> {
    return this.walkDirectory("");
  }

  async readTextFile(path: string): Promise<string> {
    return readFile(resolveRepositoryPath(this.root, path), "utf8");
  }

  private async walkDirectory(relativeDirectory: string): Promise<RepositoryEntry[]> {
    const absoluteDirectory =
      relativeDirectory.length === 0
        ? this.root
        : join(this.root, relativeDirectory);
    const dirents = await readdir(absoluteDirectory, { withFileTypes: true });
    const entries: RepositoryEntry[] = [];

    for (const dirent of dirents) {
      const relativePath =
        relativeDirectory.length === 0
          ? dirent.name
          : `${relativeDirectory}/${dirent.name}`;
      const absolutePath = join(this.root, relativePath);

      if (dirent.isDirectory()) {
        entries.push({ path: relativePath, kind: "directory" });
        entries.push(...(await this.walkDirectory(relativePath)));
        continue;
      }

      if (dirent.isFile()) {
        const metadata = await stat(absolutePath);
        entries.push({
          path: relativePath,
          kind: "file",
          sizeBytes: metadata.size,
        });
      }
    }

    return entries;
  }
}

function resolveRepositoryPath(root: string, path: string): string {
  if (isAbsolute(path)) {
    throw new Error(`Repository path is outside the repository root: ${path}`);
  }

  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, path);
  const relativePath = relative(resolvedRoot, resolvedPath);

  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`Repository path is outside the repository root: ${path}`);
  }

  return resolvedPath;
}

export class NodeRepositoryIndexWriter implements RepositoryIndexWriter {
  async writeText(
    directory: string,
    path: string,
    content: string,
  ): Promise<void> {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, path), content);
  }
}

export class NodeSwarmMemoryStore implements SwarmMemoryStore {
  constructor(private readonly workspace: RunWorkspace) {}

  async appendJsonLine(stream: SwarmMemoryStream, value: unknown): Promise<void> {
    await this.ensureMemoryFiles();
    await writeFile(
      join(this.workspace.folders.memory, memoryFiles[stream]),
      `${JSON.stringify(value)}\n`,
      { flag: "a" },
    );
  }

  async appendBlackboardSection(markdown: string): Promise<void> {
    await this.ensureMemoryFiles();
    await writeFile(
      join(this.workspace.folders.memory, "blackboard.md"),
      markdown.endsWith("\n") ? markdown : `${markdown}\n`,
      { flag: "a" },
    );
  }

  private async ensureMemoryFiles(): Promise<void> {
    await mkdir(this.workspace.folders.memory, { recursive: true });

    for (const file of allMemoryFiles) {
      await writeFile(join(this.workspace.folders.memory, file), "", { flag: "a" });
    }
  }
}

export class NodeQualityCommandReportWriter
  implements QualityCommandReportWriter
{
  async writeQualityCommandReport(request: {
    workspace: RunWorkspace;
    content: string;
  }): Promise<{ path: string }> {
    await mkdir(request.workspace.folders.validation, { recursive: true });
    const path = join(
      request.workspace.folders.validation,
      "command_report.json",
    );
    await writeFile(path, request.content);
    return { path };
  }
}

export class NodePromptTemplateReader implements PromptTemplateReader {
  constructor(private readonly promptRoot: string) {}

  async readTemplate(path: string): Promise<string> {
    try {
      return await readFile(join(this.promptRoot, path), "utf8");
    } catch (error) {
      throw new Error(`Prompt template not found: ${path}`, { cause: error });
    }
  }
}

export class NodePromptArtifactWriter implements PromptArtifactWriter {
  async writeAgentPrompt(request: {
    workspace: RunWorkspace;
    agentId: string;
    attempt: number;
    content: string;
  }): Promise<{ path: string }> {
    const directory = join(
      request.workspace.folders.agents,
      request.agentId,
      `attempt-${request.attempt}`,
    );
    const path = join(directory, "prompt.md");

    await mkdir(directory, { recursive: true });
    await writeFile(path, request.content);

    return { path };
  }
}

export class NodeAgentStatusArtifactWriter implements AgentStatusArtifactWriter {
  async writeAgentStatus(request: {
    workspace: RunWorkspace;
    agentId: string;
    attempt: number;
    content: string;
  }): Promise<{ path: string }> {
    const directory = join(
      request.workspace.folders.agents,
      request.agentId,
      `attempt-${request.attempt}`,
    );
    const path = join(directory, "status.json");

    await mkdir(directory, { recursive: true });
    await writeFile(path, request.content);

    return { path };
  }
}

export class NodeValidationReportWriter implements ValidationReportWriter {
  async writeAgentValidationReport(request: {
    workspace: RunWorkspace;
    agentId: string;
    attempt: number;
    content: string;
  }): Promise<{ path: string }> {
    const directory = join(
      request.workspace.folders.validation,
      request.agentId,
      `attempt-${request.attempt}`,
    );
    const path = join(directory, "report.json");

    await mkdir(directory, { recursive: true });
    await writeFile(path, request.content);

    return { path };
  }
}

export class NodeAgentOutputArtifactWriter
  implements AgentOutputArtifactWriter
{
  async writeAgentOutput(request: {
    workspace: RunWorkspace;
    agentId: string;
    attempt: number;
    content: string;
  }): Promise<{ path: string }> {
    const directory = join(
      request.workspace.folders.agents,
      request.agentId,
      `attempt-${request.attempt}`,
    );
    const path = join(directory, "output.json");

    await mkdir(directory, { recursive: true });
    await writeFile(path, request.content);

    return { path };
  }
}

export class NodeEvidenceValidationReportWriter
  implements EvidenceValidationReportWriter
{
  async writeEvidenceValidationReport(request: {
    workspace: RunWorkspace;
    agentId: string;
    attempt: number;
    content: string;
  }): Promise<{ path: string }> {
    const directory = join(
      request.workspace.folders.validation,
      request.agentId,
      `attempt-${request.attempt}`,
    );
    const path = join(directory, "evidence.json");

    await mkdir(directory, { recursive: true });
    await writeFile(path, request.content);

    return { path };
  }
}

export class NodeQaArtifactWriter implements QaArtifactWriter {
  async writeQaResults(request: {
    workspace: RunWorkspace;
    content: string;
  }): Promise<{ path: string }> {
    return this.writeQaArtifact(request.workspace, "results.json", request.content);
  }

  async writeQaIssues(request: {
    workspace: RunWorkspace;
    content: string;
  }): Promise<{ path: string }> {
    return this.writeQaArtifact(request.workspace, "issues.json", request.content);
  }

  async writeRevisionRequests(request: {
    workspace: RunWorkspace;
    content: string;
  }): Promise<{ path: string }> {
    return this.writeQaArtifact(
      request.workspace,
      "revision_requests.json",
      request.content,
    );
  }

  async writeReadiness(request: {
    workspace: RunWorkspace;
    content: string;
  }): Promise<{ path: string }> {
    return this.writeQaArtifact(request.workspace, "readiness.json", request.content);
  }

  private async writeQaArtifact(
    workspace: RunWorkspace,
    filename: string,
    content: string,
  ): Promise<{ path: string }> {
    const path = join(workspace.folders.qa, filename);

    await mkdir(workspace.folders.qa, { recursive: true });
    await writeFile(path, content);

    return { path };
  }
}

export class NodeCaseStudyDocumentWriter implements CaseStudyDocumentWriter {
  async writeCaseStudyDocument(request: {
    workspace: RunWorkspace;
    path: string;
    content: string;
  }): Promise<{ path: string }> {
    const directory = join(request.workspace.folders.final, "docs");
    const path = join(directory, request.path);

    await mkdir(directory, { recursive: true });
    await writeFile(path, request.content);

    return { path };
  }
}

export class NodePublicCaseStudyDocumentWriter
  implements CaseStudyDocumentWriter
{
  constructor(private readonly targetRepositoryRoot: string) {}

  async writeCaseStudyDocument(request: {
    workspace: RunWorkspace;
    path: string;
    content: string;
  }): Promise<{ path: string }> {
    const directory = join(this.targetRepositoryRoot, "docs", "inspector");
    const path = join(directory, request.path);

    await mkdir(directory, { recursive: true });
    await writeFile(path, request.content);

    return { path };
  }
}

export class NodeSplitCaseStudyDocumentWriter
  implements CaseStudyDocumentWriter
{
  constructor(
    private readonly internalWriter: CaseStudyDocumentWriter,
    private readonly publicWriter: CaseStudyDocumentWriter,
  ) {}

  async writeCaseStudyDocument(request: {
    workspace: RunWorkspace;
    path: string;
    content: string;
  }): Promise<{ path: string }> {
    const internalResult =
      await this.internalWriter.writeCaseStudyDocument(request);
    await this.publicWriter.writeCaseStudyDocument(request);
    return internalResult;
  }
}

export class NodeRagKnowledgeCardWriter implements RagKnowledgeCardWriter {
  async writeRagKnowledgeCards(request: {
    workspace: RunWorkspace;
    streams: Record<RagKnowledgeCardStream, string>;
  }): Promise<Record<RagKnowledgeCardStream, { path: string }>> {
    const directory = join(request.workspace.folders.final, "rag_cards");
    await mkdir(directory, { recursive: true });

    return {
      patterns: await this.writeStream(directory, "patterns.jsonl", request.streams.patterns),
      flows: await this.writeStream(directory, "flows.jsonl", request.streams.flows),
      decisions: await this.writeStream(
        directory,
        "decisions.jsonl",
        request.streams.decisions,
      ),
      warnings: await this.writeStream(
        directory,
        "warnings.jsonl",
        request.streams.warnings,
      ),
    };
  }

  private async writeStream(
    directory: string,
    filename: string,
    content: string,
  ): Promise<{ path: string }> {
    const path = join(directory, filename);
    await writeFile(path, content);
    return { path };
  }
}

export class NodeAgentOutputSchemaReader implements AgentOutputSchemaReader {
  constructor(private readonly schemaRoot: string) {}

  async readAgentOutputSchema(contract: string): Promise<unknown> {
    return JSON.parse(
      await readFile(join(this.schemaRoot, `${contract}.schema.json`), "utf8"),
    ) as unknown;
  }
}

export class NodeRepositoryIndexPromptContextReader
  implements RepositoryIndexPromptContextReader
{
  async readRepositoryIndexPromptContext(
    workspace: RunWorkspace,
  ): Promise<unknown> {
    return {
      repo_summary: JSON.parse(
        await readFile(
          join(workspace.folders.repoIndex, "repo_summary.json"),
          "utf8",
        ),
      ) as unknown,
      important_files: JSON.parse(
        await readFile(
          join(workspace.folders.repoIndex, "important_files.json"),
          "utf8",
        ),
      ) as unknown,
      detected_stack: JSON.parse(
        await readFile(
          join(workspace.folders.repoIndex, "detected_stack.json"),
          "utf8",
        ),
      ) as unknown,
      detected_commands: JSON.parse(
        await readFile(
          join(workspace.folders.repoIndex, "detected_commands.json"),
          "utf8",
        ),
      ) as unknown,
      file_tree: await readFile(
        join(workspace.folders.repoIndex, "file_tree.txt"),
        "utf8",
      ),
    };
  }
}

async function createUniqueWorkspaceRoot(
  request: RunWorkspaceRequest,
): Promise<{ name: string; root: string }> {
  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const name =
      attempt === 1
        ? request.workspaceName
        : `${request.workspaceName}_${attempt}`;
    const root = join(request.outputDirectory, name);

    try {
      await mkdir(root);
      return { name, root };
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    `Unable to create a unique inspection workspace for ${request.workspaceName}`,
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function toRunWorkspace(name: string, root: string): RunWorkspace {
  return {
    name,
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
}
