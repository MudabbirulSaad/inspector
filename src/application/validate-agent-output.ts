import type { AgentContract } from "../agents/index.js";
import type { AgentOutputContract } from "../domain/contracts.js";
import type {
  RunWorkspace,
  ValidationReportWriter,
} from "../ports/index.js";
import type {
  ContractValidationError,
  SchemaContractValidators,
} from "../validation/index.js";
import type {
  TestingStrategyOutput,
  TradeoffAnalystOutput,
} from "../domain/types.js";
import type { QualityCommandReport, QualityCommandResult } from "./run-quality-commands.js";

export type AgentOutputValidationStatus =
  | "passed"
  | "malformed-json"
  | "schema-invalid";

export interface AgentOutputValidationReportError {
  type: "malformed-json" | "schema-violation";
  message: string;
  contract: AgentOutputContract;
  path?: string;
  keyword?: string;
}

export interface AgentOutputValidationReport {
  agentId: string;
  attempt: number;
  contract: AgentOutputContract;
  status: AgentOutputValidationStatus;
  valid: boolean;
  errors: AgentOutputValidationReportError[];
}

export interface ValidateAgentOutputRequest {
  workspace: RunWorkspace;
  agent: AgentContract;
  attempt: number;
  rawOutput: string;
  validators: SchemaContractValidators;
  reports: ValidationReportWriter;
  qualityCommandReport?: QualityCommandReport;
}

export interface ValidateAgentOutputResult {
  valid: boolean;
  status: AgentOutputValidationStatus;
  contract: AgentOutputContract;
  value?: unknown;
  errors: AgentOutputValidationReportError[];
  report: AgentOutputValidationReport;
  reportPath: string;
}

export async function validateAgentOutput(
  request: ValidateAgentOutputRequest,
): Promise<ValidateAgentOutputResult> {
  const contract = request.agent.outputSchema;
  const parsed = parseJsonOutput(request.rawOutput, contract);

  if (!parsed.valid) {
    return writeResult(request, {
      contract,
      status: "malformed-json",
      valid: false,
      errors: parsed.errors,
    });
  }

  const schemaResult = request.validators[contract].validate(parsed.value);
  if (!schemaResult.valid) {
    return writeResult(request, {
      contract,
      status: "schema-invalid",
      valid: false,
      value: parsed.value,
      errors: schemaResult.errors.map((error) =>
        toSchemaViolation(contract, error),
      ),
    });
  }

  const claimErrors = validateContractClaims(
    contract,
    schemaResult.value,
    request.qualityCommandReport,
  );
  if (claimErrors.length > 0) {
    return writeResult(request, {
      contract,
      status: "schema-invalid",
      valid: false,
      value: parsed.value,
      errors: claimErrors,
    });
  }

  return writeResult(request, {
    contract,
    status: "passed",
    valid: true,
    value: schemaResult.value,
    errors: [],
  });
}

function validateContractClaims(
  contract: AgentOutputContract,
  value: unknown,
  qualityCommandReport: QualityCommandReport | undefined,
): AgentOutputValidationReportError[] {
  if (contract !== "testing-strategy-output") {
    if (contract === "tradeoff-analyst-output") {
      return validateTradeoffAnalystClaims(contract, value);
    }
    return [];
  }

  const output = value as TestingStrategyOutput;
  const passedCommands = new Set(
    output.commandEvidence
      .filter((command) => command.status === "passed")
      .map((command) => command.command),
  );

  return [
    ...output.qualityGates
    .filter(
      (gate) => gate.status === "passed" && !passedCommands.has(gate.command),
    )
    .map((gate) => ({
      type: "schema-violation" as const,
      contract,
      path: "/qualityGates",
      keyword: "commandEvidence",
      message: `Testing Strategy output claims ${gate.command} passed without passed command evidence`,
    })),
    ...validateTestingStrategyCommandReportClaims(
      contract,
      output,
      qualityCommandReport,
    ),
  ];
}

function validateTestingStrategyCommandReportClaims(
  contract: AgentOutputContract,
  output: TestingStrategyOutput,
  report: QualityCommandReport | undefined,
): AgentOutputValidationReportError[] {
  if (report === undefined) {
    return [];
  }

  const claims = [
    ...output.qualityGates.map((gate) => ({
      command: gate.command,
      status: gate.status,
      path: "/qualityGates",
    })),
    ...output.commandEvidence.map((command) => ({
      command: command.command,
      status: command.status,
      path: "/commandEvidence",
    })),
  ];

  if (report.skipped === true) {
    return claims
      .filter((claim) => claim.status === "passed" || claim.status === "failed")
      .map((claim) => ({
        type: "schema-violation" as const,
        contract,
        path: claim.path,
        keyword: "qualityCommandReport",
        message: `Testing Strategy output claims ${claim.command} ${claim.status}, but the quality command report was skipped`,
      }));
  }

  const commandReport = new Map(
    report.commands.map((command) => [qualityCommandText(command), command]),
  );

  return claims.flatMap((claim) => {
    const command = commandReport.get(claim.command);

    if (claim.status === "not-run") {
      if (command === undefined) {
        return [];
      }
      return [
        {
          type: "schema-violation" as const,
          contract,
          path: claim.path,
          keyword: "qualityCommandReport",
          message: `Testing Strategy output claims ${claim.command} was not run, but this contradicts executed command report entry`,
        },
      ];
    }

    if (command === undefined) {
      return [
        {
          type: "schema-violation" as const,
          contract,
          path: claim.path,
          keyword: "qualityCommandReport",
          message: `Testing Strategy output claims ${claim.command} ${claim.status}, but there is no matching quality command report entry`,
        },
      ];
    }

    if (claim.status === "passed" && command.status !== "passed") {
      return [
        {
          type: "schema-violation" as const,
          contract,
          path: claim.path,
          keyword: "qualityCommandReport",
          message: `Testing Strategy output claims ${claim.command} passed, but the quality command report status is ${command.status}`,
        },
      ];
    }

    if (
      claim.status === "failed" &&
      command.status !== "failed" &&
      command.status !== "timeout"
    ) {
      return [
        {
          type: "schema-violation" as const,
          contract,
          path: claim.path,
          keyword: "qualityCommandReport",
          message: `Testing Strategy output claims ${claim.command} failed, but the quality command report status is ${command.status}`,
        },
      ];
    }

    return [];
  });
}

function qualityCommandText(command: QualityCommandResult): string {
  return [command.command, ...command.args].join(" ");
}

function validateTradeoffAnalystClaims(
  contract: AgentOutputContract,
  value: unknown,
): AgentOutputValidationReportError[] {
  const output = value as TradeoffAnalystOutput;
  const criticalTradeoffCount =
    output.weakDecisions.length +
    output.overengineeringRisks.length +
    output.underengineeringRisks.length +
    output.hiddenAssumptions.length +
    output.agentSafetyRisks.length +
    output.adaptationWarnings.length;

  if (criticalTradeoffCount > 0) {
    return [];
  }

  return [
    {
      type: "schema-violation",
      contract,
      path: "/",
      keyword: "tradeoffCoverage",
      message:
        "Tradeoff Analyst output must not only praise the repository; include evidence-backed weak decisions, risks, assumptions, safety risks, or adaptation warnings.",
    },
  ];
}

function parseJsonOutput(
  rawOutput: string,
  contract: AgentOutputContract,
):
  | { valid: true; value: unknown }
  | { valid: false; errors: AgentOutputValidationReportError[] } {
  try {
    return { valid: true, value: JSON.parse(rawOutput) as unknown };
  } catch (error) {
    const message =
      error instanceof SyntaxError
        ? `Malformed JSON output: ${error.message}`
        : "Malformed JSON output";

    return {
      valid: false,
      errors: [{ type: "malformed-json", contract, message }],
    };
  }
}

function toSchemaViolation(
  contract: AgentOutputContract,
  error: ContractValidationError,
): AgentOutputValidationReportError {
  return {
    type: "schema-violation",
    contract,
    path: error.path,
    keyword: error.keyword,
    message: error.message,
  };
}

async function writeResult(
  request: ValidateAgentOutputRequest,
  result: {
    contract: AgentOutputContract;
    status: AgentOutputValidationStatus;
    valid: boolean;
    value?: unknown;
    errors: AgentOutputValidationReportError[];
  },
): Promise<ValidateAgentOutputResult> {
  const report: AgentOutputValidationReport = {
    agentId: request.agent.id,
    attempt: request.attempt,
    contract: result.contract,
    status: result.status,
    valid: result.valid,
    errors: result.errors,
  };
  const write = await request.reports.writeAgentValidationReport({
    workspace: request.workspace,
    agentId: request.agent.id,
    attempt: request.attempt,
    content: `${JSON.stringify(report, null, 2)}\n`,
  });

  return {
    valid: result.valid,
    status: result.status,
    contract: result.contract,
    value: result.value,
    errors: result.errors,
    report,
    reportPath: write.path,
  };
}
