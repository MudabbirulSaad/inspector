import { readFile } from "node:fs/promises";

import { Ajv2020, type AnySchema, type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats/dist/index.js";

import type {
  Finding,
  FlowTracerOutput,
  ArchitectureOutput,
  InspectionReport,
  KnowledgeCard,
  MemoryEvent,
  PatternMinerOutput,
  QaIssue,
  QaResult,
  ScoutOutput,
} from "../domain/types.js";

export const validationBoundary = "validation" as const;

export type SchemaContractName =
  | "scout-output"
  | "architecture-output"
  | "pattern-miner-output"
  | "flow-tracer-output"
  | "finding"
  | "qa-result"
  | "knowledge-card"
  | "memory-event"
  | "qa-issue"
  | "inspection-report";

export interface ContractValidationError {
  contract: SchemaContractName;
  path: string;
  keyword: string;
  message: string;
}

export interface ContractValidationResult {
  valid: boolean;
  errors: ContractValidationError[];
}

export interface ContractValidator<T> {
  validate(value: unknown): ContractValidationResult & { value?: T };
}

export interface SchemaContractValidators {
  "scout-output": ContractValidator<ScoutOutput>;
  "architecture-output": ContractValidator<ArchitectureOutput>;
  "pattern-miner-output": ContractValidator<PatternMinerOutput>;
  "flow-tracer-output": ContractValidator<FlowTracerOutput>;
  finding: ContractValidator<Finding>;
  "qa-result": ContractValidator<QaResult>;
  "knowledge-card": ContractValidator<KnowledgeCard>;
  "memory-event": ContractValidator<MemoryEvent>;
  "qa-issue": ContractValidator<QaIssue>;
  "inspection-report": ContractValidator<InspectionReport>;
}

const schemaContracts = [
  "evidence",
  "scout-output",
  "architecture-output",
  "pattern-miner-output",
  "flow-tracer-output",
  "finding",
  "qa-result",
  "qa-issue",
  "revision-request",
  "knowledge-card",
  "memory-event",
  "repository-target",
  "agent-attempt",
  "run-config",
  "inspection-run",
  "inspection-report",
] as const;

const contractTitles: Record<SchemaContractName, string> = {
  "scout-output": "Scout output",
  "architecture-output": "Architecture output",
  "pattern-miner-output": "Pattern Miner output",
  "flow-tracer-output": "Flow Tracer output",
  finding: "Finding",
  "qa-result": "QA result",
  "knowledge-card": "Knowledge card",
  "memory-event": "Memory event",
  "qa-issue": "QA issue",
  "inspection-report": "Inspection report",
};

export async function createSchemaContractValidators(
  schemaDirectory = new URL("../../schemas/", import.meta.url),
): Promise<SchemaContractValidators> {
  const ajv = new Ajv2020({ allErrors: true });
  const configureFormats = addFormats as unknown as (validator: Ajv2020) => Ajv2020;
  configureFormats(ajv);

  const schemas = new Map<string, AnySchema>();
  for (const contract of schemaContracts) {
    const schema = JSON.parse(
      await readFile(new URL(`${contract}.schema.json`, schemaDirectory), "utf8"),
    ) as AnySchema;
    schemas.set(contract, schema);
    ajv.addSchema(schema);
  }

  return {
    "scout-output": createValidator<ScoutOutput>(ajv, schemas, "scout-output"),
    "architecture-output": createValidator<ArchitectureOutput>(
      ajv,
      schemas,
      "architecture-output",
    ),
    "pattern-miner-output": createValidator<PatternMinerOutput>(
      ajv,
      schemas,
      "pattern-miner-output",
    ),
    "flow-tracer-output": createValidator<FlowTracerOutput>(
      ajv,
      schemas,
      "flow-tracer-output",
    ),
    finding: createValidator<Finding>(ajv, schemas, "finding"),
    "qa-result": createValidator<QaResult>(ajv, schemas, "qa-result"),
    "knowledge-card": createValidator<KnowledgeCard>(
      ajv,
      schemas,
      "knowledge-card",
    ),
    "memory-event": createValidator<MemoryEvent>(ajv, schemas, "memory-event"),
    "qa-issue": createValidator<QaIssue>(ajv, schemas, "qa-issue"),
    "inspection-report": createValidator<InspectionReport>(
      ajv,
      schemas,
      "inspection-report",
    ),
  };
}

function createValidator<T>(
  ajv: Ajv2020,
  schemas: ReadonlyMap<string, AnySchema>,
  contract: SchemaContractName,
): ContractValidator<T> {
  const schema = schemas.get(contract);
  if (schema === undefined) {
    throw new Error(`Missing JSON Schema for ${contract}`);
  }

  const validateSchema = ajv.compile<T>(schema);

  return {
    validate(value: unknown): ContractValidationResult & { value?: T } {
      if (validateSchema(value)) {
        return { valid: true, errors: [], value: value as T };
      }

      return {
        valid: false,
        errors: formatErrors(contract, validateSchema.errors ?? []),
      };
    },
  };
}

function formatErrors(
  contract: SchemaContractName,
  errors: readonly ErrorObject[],
): ContractValidationError[] {
  return errors.map((error) => {
    const path = error.instancePath === "" ? "/" : error.instancePath;
    const detail = error.message ?? "failed validation";

    return {
      contract,
      path,
      keyword: error.keyword,
      message: `${contractTitles[contract]} ${path} ${detail}`,
    };
  });
}
