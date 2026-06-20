import type {
  Finding,
  MemoryEvent,
  QaIssue,
} from "../domain/types.js";
import type {
  ArtifactValidator,
  SwarmMemoryStore,
  SwarmMemoryStream,
} from "../ports/index.js";

export interface AppendSwarmMemoryEventInput {
  event: MemoryEvent;
  memory: SwarmMemoryStore;
  validator: ArtifactValidator<MemoryEvent>;
}

export interface AppendSwarmDecisionInput {
  decision: MemoryEvent;
  memory: SwarmMemoryStore;
  validator: ArtifactValidator<MemoryEvent>;
}

export interface AppendSwarmFindingInput {
  finding: Finding;
  memory: SwarmMemoryStore;
  validator: ArtifactValidator<Finding>;
}

export interface AppendSwarmQaIssueInput {
  issue: QaIssue;
  memory: SwarmMemoryStore;
  validator: ArtifactValidator<QaIssue>;
}

export interface AppendSwarmBlackboardSnapshotInput {
  title: string;
  body: string;
  memory: SwarmMemoryStore;
}

export async function appendSwarmMemoryEvent(
  input: AppendSwarmMemoryEventInput,
): Promise<void> {
  const result = input.validator.validate(input.event);
  if (!result.valid) {
    throw new Error(
      `Invalid memory event: ${
        result.errors[0]?.message ?? "unknown validation error"
      }`,
    );
  }

  await input.memory.appendJsonLine("events", input.event);
}

export async function appendSwarmDecision(
  input: AppendSwarmDecisionInput,
): Promise<void> {
  if (input.decision.type !== "decision") {
    throw new Error("Invalid decision: memory event type must be decision");
  }

  await appendValidatedJsonLine({
    value: input.decision,
    stream: "decisions",
    validator: input.validator,
    artifactName: "decision",
    memory: input.memory,
  });
}

export async function appendSwarmFinding(
  input: AppendSwarmFindingInput,
): Promise<void> {
  await appendValidatedJsonLine({
    value: input.finding,
    stream: "findings",
    validator: input.validator,
    artifactName: "finding",
    memory: input.memory,
  });
}

export async function appendVerifiedSwarmFinding(
  input: AppendSwarmFindingInput,
): Promise<void> {
  await appendValidatedJsonLine({
    value: input.finding,
    stream: "verifiedFindings",
    validator: input.validator,
    artifactName: "finding",
    memory: input.memory,
  });
}

export async function appendRejectedSwarmFinding(
  input: AppendSwarmFindingInput,
): Promise<void> {
  await appendValidatedJsonLine({
    value: input.finding,
    stream: "rejectedFindings",
    validator: input.validator,
    artifactName: "finding",
    memory: input.memory,
  });
}

export async function appendSwarmQaIssue(
  input: AppendSwarmQaIssueInput,
): Promise<void> {
  await appendValidatedJsonLine({
    value: input.issue,
    stream: "qaIssues",
    validator: input.validator,
    artifactName: "QA issue",
    memory: input.memory,
  });
}

export async function appendSwarmBlackboardSnapshot(
  input: AppendSwarmBlackboardSnapshotInput,
): Promise<void> {
  await input.memory.appendBlackboardSection(
    [`## ${input.title}`, "", input.body, "", ""].join("\n"),
  );
}

async function appendValidatedJsonLine<T>(input: {
  value: T;
  stream: SwarmMemoryStream;
  validator: ArtifactValidator<T>;
  artifactName: string;
  memory: SwarmMemoryStore;
}): Promise<void> {
  const result = input.validator.validate(input.value);
  if (!result.valid) {
    throw new Error(
      `Invalid ${input.artifactName}: ${
        result.errors[0]?.message ?? "unknown validation error"
      }`,
    );
  }

  await input.memory.appendJsonLine(input.stream, input.value);
}
