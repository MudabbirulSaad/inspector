import type { ArchitectureOutput, Evidence, Finding, FlowTracerOutput, PatternMinerOutput, ScoutOutput, TestingStrategyOutput, TradeoffAnalystOutput } from "../domain/types.js";
import type { QaEvidenceReport, QaSchemaReport } from "./verify-findings-with-qa.js";

export function displayNameForAgent(
  agentId:
    | "scout"
    | "architecture"
    | "pattern_miner"
    | "flow_tracer"
    | "testing_strategy"
    | "tradeoff_analyst",
): string {
  if (agentId === "pattern_miner") {
    return "Pattern Miner";
  }
  if (agentId === "flow_tracer") {
    return "Flow Tracer";
  }
  if (agentId === "testing_strategy") {
    return "Testing Strategy";
  }
  if (agentId === "tradeoff_analyst") {
    return "Tradeoff Analyst";
  }
  return agentId[0]?.toUpperCase() + agentId.slice(1);
}

export function replaceSchemaReport(
  reports: QaSchemaReport[],
  next: QaSchemaReport,
): void {
  const index = reports.findIndex((report) => report.agentId === next.agentId);
  if (index === -1) {
    reports.push(next);
    return;
  }
  reports[index] = next;
}

export function replaceEvidenceReport(
  reports: QaEvidenceReport[],
  next: QaEvidenceReport,
): void {
  const index = reports.findIndex((report) => report.agentId === next.agentId);
  if (index === -1) {
    reports.push(next);
    return;
  }
  reports[index] = next;
}

export function replaceCandidateFindingsForAgent(
  findings: Finding[],
  agentId: string,
  replacements: Finding[],
): void {
  const retained = findings.filter((finding) => finding.agent !== agentId);
  findings.splice(0, findings.length, ...retained, ...replacements);
}

export function findingsForAgentOutput(
  agentId:
    | "scout"
    | "architecture"
    | "pattern_miner"
    | "flow_tracer"
    | "testing_strategy"
    | "tradeoff_analyst",
  output: unknown,
): Finding[] {
  if (agentId === "scout") {
    return (output as ScoutOutput).findings;
  }
  if (agentId === "architecture") {
    return (output as ArchitectureOutput).findings;
  }
  if (agentId === "pattern_miner") {
    return (output as PatternMinerOutput).findings;
  }
  if (agentId === "flow_tracer") {
    return (output as FlowTracerOutput).findings;
  }
  if (agentId === "testing_strategy") {
    return (output as TestingStrategyOutput).findings;
  }
  return (output as TradeoffAnalystOutput).findings;
}

export function evidenceFindingsForAgentOutput(
  agentId:
    | "scout"
    | "architecture"
    | "pattern_miner"
    | "flow_tracer"
    | "testing_strategy"
    | "tradeoff_analyst",
  output: unknown,
): Finding[] {
  if (agentId === "scout") {
    return scoutEvidenceFindings(output as ScoutOutput);
  }
  if (agentId === "architecture") {
    return architectureEvidenceFindings(output as ArchitectureOutput);
  }
  if (agentId === "pattern_miner") {
    return patternMinerEvidenceFindings(output as PatternMinerOutput);
  }
  if (agentId === "flow_tracer") {
    return flowTracerEvidenceFindings(output as FlowTracerOutput);
  }
  if (agentId === "testing_strategy") {
    return testingStrategyEvidenceFindings(output as TestingStrategyOutput);
  }
  return tradeoffAnalystEvidenceFindings(output as TradeoffAnalystOutput);
}

export function renderInitialMemorySnapshot(objective: string): string {
  return [`## Run initialized`, "", `Objective: ${objective.trim()}`, "", ""].join(
    "\n",
  );
}

export function scoutEvidenceFindings(output: ScoutOutput): Finding[] {
  return [
    evidenceFinding(
      "finding-scout-project-type",
      `Scout identified project type: ${output.projectType.value}`,
      output.projectType.evidence,
    ),
    ...output.detectedStack.map((signal, index) =>
      evidenceFinding(
        `finding-scout-stack-${index + 1}`,
        `Scout detected stack signal: ${signal.name}`,
        signal.evidence,
      ),
    ),
    ...output.importantFiles.map((file, index) =>
      evidenceFinding(
        `finding-scout-important-file-${index + 1}`,
        `Scout marked ${file.path} as important: ${file.reason}`,
        file.evidence,
      ),
    ),
    ...output.entryPoints.map((entryPoint, index) =>
      evidenceFinding(
        `finding-scout-entrypoint-${index + 1}`,
        `Scout marked ${entryPoint.path} as an entry point: ${entryPoint.kind}`,
        entryPoint.evidence,
      ),
    ),
    evidenceFinding(
      "finding-scout-architecture-impression",
      output.architectureImpression.summary,
      output.architectureImpression.evidence,
    ),
    ...output.findings,
  ];
}

function evidenceFinding(id: string, claim: string, evidence: Evidence[]): Finding {
  return {
    id,
    agent: "scout",
    severity: "info",
    claim,
    evidence,
    recommendation: "Use this Scout observation only as initial inspection context.",
    confidence: 0.5,
  };
}

export function architectureEvidenceFindings(output: ArchitectureOutput): Finding[] {
  return [
    ...output.layerMap.map((item, index) =>
      architectureObservationFinding("layer-map", index, item),
    ),
    ...output.dependencyDirection.map((item, index) =>
      architectureObservationFinding(
        "dependency-direction",
        index,
        item,
        `${item.source} -> ${item.target}: ${item.direction}`,
      ),
    ),
    ...output.moduleBoundaries.map((item, index) =>
      architectureObservationFinding("module-boundary", index, item),
    ),
    ...output.businessLogicLocations.map((item, index) =>
      architectureObservationFinding("business-logic", index, item),
    ),
    ...output.frameworkGlueLocations.map((item, index) =>
      architectureObservationFinding("framework-glue", index, item),
    ),
    ...output.architectureRisks.map((item, index) =>
      architectureObservationFinding("risk", index, item),
    ),
    ...output.findings,
  ];
}

export function patternMinerEvidenceFindings(output: PatternMinerOutput): Finding[] {
  return [
    ...output.patterns.map((pattern, index) => ({
      id: `finding-pattern-miner-pattern-${index + 1}`,
      agent: "pattern_miner",
      severity: "info" as const,
      claim: `${pattern.name}: ${pattern.problemSolved}`,
      evidence: pattern.evidence,
      recommendation: pattern.adaptationValue,
      confidence: pattern.confidence,
    })),
    ...output.findings,
  ];
}

export function flowTracerEvidenceFindings(output: FlowTracerOutput): Finding[] {
  return [
    ...output.flows.flatMap((flow, index) => [
      {
        id: `finding-flow-tracer-flow-${index + 1}`,
        agent: "flow_tracer",
        severity: "info" as const,
        claim: `${flow.name}: ${flow.action}`,
        evidence: flow.evidence,
        recommendation:
          "Use this flow trace only where each step remains backed by cited repository evidence.",
        confidence: 0.6,
      },
      {
        id: `finding-flow-tracer-entry-${index + 1}`,
        agent: "flow_tracer",
        severity: "info" as const,
        claim: `Flow entry point: ${flow.entryPoint.path}`,
        evidence: flow.entryPoint.evidence,
        recommendation: "Keep entry point claims tied to the cited file range.",
        confidence: 0.5,
      },
      ...flow.mainFiles.map((file, fileIndex) => ({
        id: `finding-flow-tracer-main-file-${index + 1}-${fileIndex + 1}`,
        agent: "flow_tracer",
        severity: "info" as const,
        claim: `${file.path}: ${file.role}`,
        evidence: file.evidence,
        recommendation: "Treat this file role as part of the traced flow.",
        confidence: 0.5,
      })),
      ...flow.dataPath.map((step, stepIndex) => ({
        id: `finding-flow-tracer-data-path-${index + 1}-${stepIndex + 1}`,
        agent: "flow_tracer",
        severity: "info" as const,
        claim: step.step,
        evidence: step.evidence,
        recommendation: "Preserve this data path step only with its cited evidence.",
        confidence: 0.5,
      })),
      ...flow.sideEffects.map((sideEffect, sideEffectIndex) => ({
        id: `finding-flow-tracer-side-effect-${index + 1}-${sideEffectIndex + 1}`,
        agent: "flow_tracer",
        severity: "info" as const,
        claim: sideEffect.description,
        evidence: sideEffect.evidence,
        recommendation: "Keep side-effect claims bounded by visible evidence.",
        confidence: 0.5,
      })),
      ...flow.persistencePath.map((persistence, persistenceIndex) => ({
        id: `finding-flow-tracer-persistence-${index + 1}-${persistenceIndex + 1}`,
        agent: "flow_tracer",
        severity: "info" as const,
        claim: persistence.description,
        evidence: persistence.evidence,
        recommendation: "Use this persistence observation only as far as evidence supports it.",
        confidence: 0.5,
      })),
      ...flow.errorPaths.map((errorPath, errorIndex) => ({
        id: `finding-flow-tracer-error-${index + 1}-${errorIndex + 1}`,
        agent: "flow_tracer",
        severity: "info" as const,
        claim: errorPath.description,
        evidence: errorPath.evidence,
        recommendation: "Do not infer additional error paths beyond this evidence.",
        confidence: 0.5,
      })),
      ...flow.tests.map((visibleTest, testIndex) => ({
        id: `finding-flow-tracer-test-${index + 1}-${testIndex + 1}`,
        agent: "flow_tracer",
        severity: "info" as const,
        claim: visibleTest.description,
        evidence: visibleTest.evidence,
        recommendation: "Keep test coverage claims tied to visible test evidence.",
        confidence: 0.5,
      })),
    ]),
    ...output.insufficientEvidence.map((gap, index) => ({
      id: `finding-flow-tracer-insufficient-evidence-${index + 1}`,
      agent: "flow_tracer",
      severity: "info" as const,
      claim: `${gap.topic}: ${gap.reason}`,
      evidence: gap.evidence,
      recommendation: "Report this as insufficient evidence rather than inventing a flow.",
      confidence: 0.4,
    })),
    ...output.findings,
  ];
}

export function testingStrategyEvidenceFindings(
  output: TestingStrategyOutput,
): Finding[] {
  return [
    ...output.testTypesFound.map((item, index) =>
      testingStrategyNoteFinding("test-type", index, item),
    ),
    ...output.qualityGates.map((gate, index) => ({
      id: `finding-testing-strategy-quality-gate-${index + 1}`,
      agent: "testing_strategy",
      severity: "info" as const,
      claim: `${gate.command}: ${gate.status}. ${gate.summary}`,
      evidence: gate.evidence,
      recommendation:
        gate.status === "not-run"
          ? "Do not claim this gate passed until the command is run."
          : "Preserve this quality gate with explicit command evidence.",
      confidence: gate.status === "passed" ? 0.7 : 0.5,
    })),
    ...output.behaviorProtected.map((item, index) =>
      testingStrategyNoteFinding("behavior-protected", index, item),
    ),
    ...output.behaviorNotProtected.map((item, index) =>
      testingStrategyNoteFinding("behavior-not-protected", index, item),
    ),
    ...output.commandEvidence.map((command, index) => ({
      id: `finding-testing-strategy-command-${index + 1}`,
      agent: "testing_strategy",
      severity: "info" as const,
      claim: `${command.command}: ${command.status}`,
      evidence: command.evidence,
      recommendation:
        command.status === "not-run"
          ? "Treat this command as available but unexecuted."
          : "Keep command result claims tied to this recorded evidence.",
      confidence: command.status === "passed" ? 0.7 : 0.5,
    })),
    ...output.testingRisks.map((item, index) =>
      testingStrategyNoteFinding("risk", index, item, "medium"),
    ),
    ...output.recommendations.map((recommendation, index) => ({
      id: `finding-testing-strategy-recommendation-${index + 1}`,
      agent: "testing_strategy",
      severity: recommendation.priority,
      claim: recommendation.summary,
      evidence: recommendation.evidence,
      recommendation: recommendation.summary,
      confidence: 0.6,
    })),
    ...output.findings,
  ];
}

function testingStrategyNoteFinding(
  kind: string,
  index: number,
  item: {
    name: string;
    summary: string;
    evidence: Evidence[];
  },
  severity: Finding["severity"] = "info",
): Finding {
  return {
    id: `finding-testing-strategy-${kind}-${index + 1}`,
    agent: "testing_strategy",
    severity,
    claim: `${item.name}: ${item.summary}`,
    evidence: item.evidence,
    recommendation:
      "Use this testing-strategy observation only with its cited evidence.",
    confidence: 0.5,
  };
}

export function tradeoffAnalystEvidenceFindings(
  output: TradeoffAnalystOutput,
): Finding[] {
  return [
    ...output.strongDecisions.map((item, index) => ({
      id: `finding-tradeoff-analyst-strong-decision-${index + 1}`,
      agent: "tradeoff_analyst",
      severity: "info" as const,
      claim: `${item.decision}: ${item.tradeoff}`,
      evidence: item.evidence,
      recommendation: item.consequence,
      confidence: item.confidence,
    })),
    ...output.weakDecisions.map((item, index) => ({
      id: `finding-tradeoff-analyst-weak-decision-${index + 1}`,
      agent: "tradeoff_analyst",
      severity: "medium" as const,
      claim: `${item.decision}: ${item.tradeoff}`,
      evidence: item.evidence,
      recommendation: item.risk,
      confidence: item.confidence,
    })),
    ...output.overengineeringRisks.map((item, index) =>
      tradeoffRiskFinding("overengineering", index, item),
    ),
    ...output.underengineeringRisks.map((item, index) =>
      tradeoffRiskFinding("underengineering", index, item),
    ),
    ...output.hiddenAssumptions.map((item, index) => ({
      id: `finding-tradeoff-analyst-hidden-assumption-${index + 1}`,
      agent: "tradeoff_analyst",
      severity: "medium" as const,
      claim: item.assumption,
      evidence: item.evidence,
      recommendation: item.whyItMatters,
      confidence: item.confidence,
    })),
    ...output.agentSafetyRisks.map((item, index) =>
      tradeoffRiskFinding("agent-safety", index, item, "high"),
    ),
    ...output.adaptationWarnings.map((item, index) => ({
      id: `finding-tradeoff-analyst-adaptation-warning-${index + 1}`,
      agent: "tradeoff_analyst",
      severity: "medium" as const,
      claim: `${item.warning}: ${item.repoSpecificContext}`,
      evidence: item.evidence,
      recommendation: item.adaptationAdvice,
      confidence: item.confidence,
    })),
    ...output.findings,
  ];
}

function tradeoffRiskFinding(
  kind: string,
  index: number,
  item: {
    risk: string;
    tradeoff: string;
    consequence: string;
    evidence: Evidence[];
    confidence: number;
  },
  severity: Finding["severity"] = "medium",
): Finding {
  return {
    id: `finding-tradeoff-analyst-${kind}-risk-${index + 1}`,
    agent: "tradeoff_analyst",
    severity,
    claim: `${item.risk}: ${item.tradeoff}`,
    evidence: item.evidence,
    recommendation: item.consequence,
    confidence: item.confidence,
  };
}

function architectureObservationFinding(
  kind: string,
  index: number,
  observation: {
    name: string;
    observedFacts: string[];
    interpretation?: string;
    evidence: Evidence[];
  },
  detail = observation.name,
): Finding {
  return {
    id: `finding-architecture-${kind}-${index + 1}`,
    agent: "architecture",
    severity: "info",
    claim: `${detail}: ${observation.observedFacts.join(" ")}`,
    evidence: observation.evidence,
    recommendation:
      observation.interpretation ??
      "Treat this architecture observation as evidence-backed context.",
    confidence: 0.5,
  };
}
