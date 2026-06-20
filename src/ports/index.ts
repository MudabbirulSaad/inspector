export const portsBoundary = "ports" as const;

export interface PortRegistry {
  readonly boundary: typeof portsBoundary;
}

export interface Clock {
  now(): Date;
}

export interface RunWorkspaceRequest {
  outputDirectory: string;
  workspaceName: string;
  configJson: string;
}

export interface RunWorkspace {
  name: string;
  root: string;
  configFile: string;
  folders: {
    input: string;
    repoIndex: string;
    memory: string;
    agents: string;
    validation: string;
    qa: string;
    final: string;
  };
}

export interface RunWorkspaceStore {
  create(request: RunWorkspaceRequest): Promise<RunWorkspace>;
}

export type RepositoryEntryKind = "file" | "directory";

export interface RepositoryEntry {
  path: string;
  kind: RepositoryEntryKind;
  sizeBytes?: number;
}

export interface RepositoryReader {
  listEntries(): Promise<RepositoryEntry[]>;
  readTextFile(path: string): Promise<string>;
}

export interface RepositoryIndexWriter {
  writeText(directory: string, path: string, content: string): Promise<void>;
}

export interface RepositoryIndexPromptContextReader {
  readRepositoryIndexPromptContext(workspace: RunWorkspace): Promise<unknown>;
}

export type SwarmMemoryStream =
  | "events"
  | "findings"
  | "decisions"
  | "qaIssues"
  | "verifiedFindings"
  | "rejectedFindings";

export interface SwarmMemoryStore {
  appendJsonLine(stream: SwarmMemoryStream, value: unknown): Promise<void>;
  appendBlackboardSection(markdown: string): Promise<void>;
}

export interface ValidationPortResult {
  valid: boolean;
  errors: { message: string }[];
}

export interface ArtifactValidator<T> {
  validate(value: unknown): ValidationPortResult & { value?: T };
}

export interface PromptTemplateReader {
  readTemplate(path: string): Promise<string>;
}

export interface PromptArtifactWriter {
  writeAgentPrompt(request: {
    workspace: RunWorkspace;
    agentId: string;
    attempt: number;
    content: string;
  }): Promise<{ path: string }>;
}

export interface AgentStatusArtifactWriter {
  writeAgentStatus(request: {
    workspace: RunWorkspace;
    agentId: string;
    attempt: number;
    content: string;
  }): Promise<{ path: string }>;
}

export interface ValidationReportWriter {
  writeAgentValidationReport(request: {
    workspace: RunWorkspace;
    agentId: string;
    attempt: number;
    content: string;
  }): Promise<{ path: string }>;
}

export interface QualityCommandReportWriter {
  writeQualityCommandReport(request: {
    workspace: RunWorkspace;
    content: string;
  }): Promise<{ path: string }>;
}

export interface EvidenceValidationReportWriter {
  writeEvidenceValidationReport(request: {
    workspace: RunWorkspace;
    agentId: string;
    attempt: number;
    content: string;
  }): Promise<{ path: string }>;
}

export interface AgentOutputArtifactWriter {
  writeAgentOutput(request: {
    workspace: RunWorkspace;
    agentId: string;
    attempt: number;
    content: string;
  }): Promise<{ path: string }>;
}

export interface QaArtifactWriter {
  writeQaResults(request: {
    workspace: RunWorkspace;
    content: string;
  }): Promise<{ path: string }>;
  writeQaIssues(request: {
    workspace: RunWorkspace;
    content: string;
  }): Promise<{ path: string }>;
  writeRevisionRequests(request: {
    workspace: RunWorkspace;
    content: string;
  }): Promise<{ path: string }>;
  writeReadiness(request: {
    workspace: RunWorkspace;
    content: string;
  }): Promise<{ path: string }>;
}

export interface CaseStudyDocumentWriteRequest {
  workspace: RunWorkspace;
  path: string;
  content: string;
}

export interface CaseStudyDocumentWriter {
  writeCaseStudyDocument(
    request: CaseStudyDocumentWriteRequest,
  ): Promise<{ path: string }>;
}

export type RagKnowledgeCardStream =
  | "patterns"
  | "flows"
  | "decisions"
  | "warnings";

export interface RagKnowledgeCardWriter {
  writeRagKnowledgeCards(request: {
    workspace: RunWorkspace;
    streams: Record<RagKnowledgeCardStream, string>;
  }): Promise<Record<RagKnowledgeCardStream, { path: string }>>;
}

export interface AgentOutputSchemaReader {
  readAgentOutputSchema(contract: string): Promise<unknown>;
}

export type AgentRunnerStreamEventKind =
  | "stdout"
  | "stderr"
  | "status"
  | "artifact";

export interface AgentRunnerStreamEvent {
  timestamp: string;
  kind: AgentRunnerStreamEventKind;
  message: string;
  artifactPath?: string;
}

export interface AgentRunRequest {
  agentId: string;
  attempt: number;
  prompt: string;
  workspaceRoot: string;
  onStreamingEvent?: (event: AgentRunnerStreamEvent) => void | Promise<void>;
}

export interface AgentRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  startedAt: string;
  completedAt: string;
  outputArtifactPaths: string[];
  streamingEvents: AgentRunnerStreamEvent[];
  failureReason?: string;
}

export interface AgentRunner {
  runAgent(request: AgentRunRequest): Promise<AgentRunResult>;
}

export interface ProcessRunRequest {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  onStreamingEvent?: (event: ProcessRunStreamEvent) => void | Promise<void>;
}

export type ProcessRunStreamEventKind = "stdout" | "stderr" | "status";

export interface ProcessRunStreamEvent {
  timestamp: string;
  kind: ProcessRunStreamEventKind;
  message: string;
}

export interface ProcessRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  startedAt: string;
  completedAt: string;
  streamingEvents: ProcessRunStreamEvent[];
  failureReason?: string;
}

export interface ProcessRunner {
  run(request: ProcessRunRequest): Promise<ProcessRunResult>;
}
