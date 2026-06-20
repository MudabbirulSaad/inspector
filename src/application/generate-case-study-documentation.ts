import type {
  Finding,
  QaResult,
  RepositoryTarget,
} from "../domain/types.js";
import type {
  CaseStudyDocumentWriter,
  RunWorkspace,
} from "../ports/index.js";

export interface CaseStudyDocument {
  path: string;
  title: string;
}

export interface GenerateCaseStudyDocumentationInput {
  workspace: RunWorkspace;
  writer: CaseStudyDocumentWriter;
  repository: RepositoryTarget;
  objective: string;
  approvedFindings: Finding[];
  rejectedFindings: Finding[];
  qaResults: QaResult[];
  generatedAt: Date;
}

export interface GenerateCaseStudyDocumentationResult {
  documents: CaseStudyDocument[];
}

interface CaseStudyDocumentSpec {
  path: string;
  title: string;
  body: (input: GenerateCaseStudyDocumentationInput) => string;
}

const unsupported =
  "There is not enough verified evidence to support this section.";

const documentSpecs: CaseStudyDocumentSpec[] = [
  {
    path: "00-executive-summary.md",
    title: "Executive Summary",
    body: renderExecutiveSummary,
  },
  {
    path: "01-product-context.md",
    title: "Product Context",
    body: renderProductContext,
  },
  {
    path: "02-architecture-map.md",
    title: "Architecture Map",
    body: (input) => renderFindingsSection(input, "architecture"),
  },
  {
    path: "03-feature-flow-traces.md",
    title: "Feature Flow Traces",
    body: (input) => renderFindingsSection(input, "flow_tracer"),
  },
  {
    path: "04-pattern-catalog.md",
    title: "Pattern Catalog",
    body: (input) => renderFindingsSection(input, "pattern_miner"),
  },
  {
    path: "05-testing-strategy.md",
    title: "Testing Strategy",
    body: (input) => renderFindingsSection(input, "testing_strategy"),
  },
  {
    path: "06-tradeoffs-and-risks.md",
    title: "Tradeoffs and Risks",
    body: renderRiskSection,
  },
  {
    path: "07-adaptation-blueprint.md",
    title: "Adaptation Blueprint",
    body: renderAdaptationBlueprint,
  },
  {
    path: "08-implementation-plan.md",
    title: "Implementation Plan",
    body: renderImplementationPlan,
  },
  {
    path: "09-verification-report.md",
    title: "Verification Report",
    body: renderVerificationReport,
  },
];

export async function generateCaseStudyDocumentation(
  input: GenerateCaseStudyDocumentationInput,
): Promise<GenerateCaseStudyDocumentationResult> {
  const documents: CaseStudyDocument[] = [];

  for (const spec of documentSpecs) {
    const document = {
      path: spec.path,
      title: spec.title,
    };
    const content = renderDocument(input, spec);

    await input.writer.writeCaseStudyDocument({
      workspace: input.workspace,
      path: spec.path,
      content,
    });
    documents.push(document);
  }

  return { documents };
}

function renderDocument(
  input: GenerateCaseStudyDocumentationInput,
  spec: CaseStudyDocumentSpec,
): string {
  return [
    `# ${spec.title}`,
    "",
    `Repository: ${input.repository.name}`,
    `Generated: ${input.generatedAt.toISOString()}`,
    "",
    spec.body(input).trimEnd(),
    "",
  ].join("\n");
}

function renderExecutiveSummary(
  input: GenerateCaseStudyDocumentationInput,
): string {
  if (input.approvedFindings.length === 0) {
    return unsupported;
  }

  return [
    `Objective: ${input.objective.trim()}`,
    "",
    "Verified findings:",
    renderFindingList(input.approvedFindings),
  ].join("\n");
}

function renderProductContext(
  input: GenerateCaseStudyDocumentationInput,
): string {
  const scoutFindings = findingsByAgent(input.approvedFindings, "scout");

  if (scoutFindings.length === 0) {
    return unsupported;
  }

  return renderFindingList(scoutFindings);
}

function renderFindingsSection(
  input: GenerateCaseStudyDocumentationInput,
  agent: string,
): string {
  const findings = findingsByAgent(input.approvedFindings, agent);

  if (findings.length === 0) {
    return unsupported;
  }

  return renderFindingList(findings);
}

function renderRiskSection(input: GenerateCaseStudyDocumentationInput): string {
  const findings = input.approvedFindings.filter(
    (finding) =>
      finding.severity === "medium" ||
      finding.severity === "high" ||
      finding.severity === "critical",
  );

  if (findings.length === 0) {
    return unsupported;
  }

  return renderFindingList(findings);
}

function renderAdaptationBlueprint(
  input: GenerateCaseStudyDocumentationInput,
): string {
  if (input.approvedFindings.length === 0) {
    return unsupported;
  }

  return [
    "Adapt only the practices backed by approved evidence:",
    renderFindingList(input.approvedFindings),
  ].join("\n");
}

function renderImplementationPlan(
  input: GenerateCaseStudyDocumentationInput,
): string {
  if (input.approvedFindings.length === 0) {
    return unsupported;
  }

  return [
    "Implementation steps derived from approved recommendations:",
    ...input.approvedFindings.map(
      (finding, index) =>
        `${index + 1}. ${finding.recommendation} Evidence: ${renderEvidenceChain(finding)}`,
    ),
  ].join("\n");
}

function renderVerificationReport(
  input: GenerateCaseStudyDocumentationInput,
): string {
  const passedResults = input.qaResults.filter(
    (result) =>
      result.status === "passed" &&
      input.approvedFindings.some((finding) => finding.id === result.findingId),
  );

  return [
    `Approved findings used: ${input.approvedFindings.length}`,
    `Rejected findings excluded: ${input.rejectedFindings.length}`,
    "",
    "Approved evidence chain:",
    input.approvedFindings.length === 0
      ? unsupported
      : input.approvedFindings
          .map((finding) => {
            const qaResult = passedResults.find(
              (result) => result.findingId === finding.id,
            );
            return [
              `- ${finding.id}`,
              `  Claim: ${finding.claim}`,
              `  Evidence: ${renderEvidenceChain(finding)}`,
              `  QA: ${qaResult?.id ?? "No passed QA result found"}`,
            ].join("\n");
          })
          .join("\n"),
  ].join("\n");
}

function renderFindingList(findings: Finding[]): string {
  return findings
    .map((finding) =>
      [
        `- ${finding.claim}`,
        `  Finding: ${finding.id}`,
        `  Recommendation: ${finding.recommendation}`,
        `  Evidence: ${renderEvidenceChain(finding)}`,
      ].join("\n"),
    )
    .join("\n");
}

function renderEvidenceChain(finding: Finding): string {
  return finding.evidence.map(renderEvidence).join("; ");
}

function renderEvidence(evidence: Finding["evidence"][number]): string {
  return `${evidence.file}:${evidence.lineStart}-${evidence.lineEnd}`;
}

function findingsByAgent(findings: Finding[], agent: string): Finding[] {
  return findings.filter((finding) => finding.agent === agent);
}
