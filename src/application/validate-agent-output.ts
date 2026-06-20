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
import type { TestingStrategyOutput } from "../domain/types.js";

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

  const claimErrors = validateContractClaims(contract, schemaResult.value);
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
): AgentOutputValidationReportError[] {
  if (contract !== "testing-strategy-output") {
    return [];
  }

  const output = value as TestingStrategyOutput;
  const passedCommands = new Set(
    output.commandEvidence
      .filter((command) => command.status === "passed")
      .map((command) => command.command),
  );

  return output.qualityGates
    .filter(
      (gate) => gate.status === "passed" && !passedCommands.has(gate.command),
    )
    .map((gate) => ({
      type: "schema-violation",
      contract,
      path: "/qualityGates",
      keyword: "commandEvidence",
      message: `Testing Strategy output claims ${gate.command} passed without passed command evidence`,
    }));
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
