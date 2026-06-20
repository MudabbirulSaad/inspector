import type {
  Finding,
  KnowledgeCard,
  RepositoryTarget,
} from "../domain/types.js";
import type {
  ArtifactValidator,
  RagKnowledgeCardStream,
  RagKnowledgeCardWriter,
  RunWorkspace,
} from "../ports/index.js";

export interface GenerateRagKnowledgeCardsInput {
  workspace: RunWorkspace;
  writer: RagKnowledgeCardWriter;
  repository: RepositoryTarget;
  approvedFindings: Finding[];
  rejectedFindings: Finding[];
  validator: ArtifactValidator<KnowledgeCard>;
  generatedAt: Date;
}

export interface GenerateRagKnowledgeCardsResult {
  cards: KnowledgeCard[];
  paths: Record<RagKnowledgeCardStream, { path: string }>;
}

export class InvalidRagKnowledgeCardError extends Error {
  constructor(readonly errors: { message: string }[]) {
    super(`Invalid RAG knowledge card: ${errors[0]?.message ?? "unknown error"}`);
  }
}

const emptyStreams: Record<RagKnowledgeCardStream, string> = {
  patterns: "",
  flows: "",
  decisions: "",
  warnings: "",
};

export async function generateRagKnowledgeCards(
  input: GenerateRagKnowledgeCardsInput,
): Promise<GenerateRagKnowledgeCardsResult> {
  const cards = input.approvedFindings.map((finding) =>
    cardFromFinding(finding, input.repository, input.generatedAt),
  );
  const streams = { ...emptyStreams };

  for (const card of cards) {
    const validation = input.validator.validate(card);
    if (!validation.valid) {
      throw new InvalidRagKnowledgeCardError(validation.errors);
    }

    const sourceFinding = input.approvedFindings.find(
      (finding) => `rag-card-${finding.id}` === card.id,
    );
    const stream = classifyFinding(sourceFinding);
    streams[stream] += `${JSON.stringify(card)}\n`;
  }

  const paths = await input.writer.writeRagKnowledgeCards({
    workspace: input.workspace,
    streams,
  });

  return { cards, paths };
}

function cardFromFinding(
  finding: Finding,
  repository: RepositoryTarget,
  generatedAt: Date,
): KnowledgeCard {
  return {
    id: `rag-card-${finding.id}`,
    topic: finding.claim,
    summary: finding.recommendation,
    sourceRepo: repository.name,
    confidence: finding.confidence,
    evidence: finding.evidence.map((evidence) => ({
      ...evidence,
      findingId: evidence.findingId ?? finding.id,
    })),
    tags: finding.tags ?? [finding.agent],
    audience: finding.audience ?? "coding-agent",
    ...(finding.whenToUse === undefined ? {} : { whenToUse: finding.whenToUse }),
    ...(finding.whenNotToUse === undefined
      ? {}
      : { whenNotToUse: finding.whenNotToUse }),
    ...(finding.risks === undefined ? {} : { risks: finding.risks }),
    ...(finding.adaptationNotes === undefined
      ? {}
      : { adaptationNotes: finding.adaptationNotes }),
    createdAt: generatedAt.toISOString(),
  };
}

function classifyFinding(
  finding: Finding | undefined,
): RagKnowledgeCardStream {
  if (finding?.cardType === "pattern") {
    return "patterns";
  }
  if (finding?.cardType === "flow") {
    return "flows";
  }
  if (finding?.cardType === "warning") {
    return "warnings";
  }
  if (finding?.cardType === "decision") {
    return "decisions";
  }
  if (finding?.agent === "pattern_miner") {
    return "patterns";
  }
  if (finding?.agent === "flow_tracer") {
    return "flows";
  }
  if (
    finding?.severity === "high" ||
    finding?.severity === "critical" ||
    finding?.severity === "medium"
  ) {
    return "warnings";
  }
  return "decisions";
}
