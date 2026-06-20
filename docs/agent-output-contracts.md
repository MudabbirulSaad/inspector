# Agent Output Contracts

Agent outputs and persisted run artifacts must be structured, evidence-backed,
and validation-friendly. The schemas in `schemas/` define the current
contracts, and `examples/` contains small valid examples.

## Shared Evidence

`evidence.schema.json` describes a traceable file and line range. Findings,
QA issues, knowledge cards, and reports reuse this shape so evidence chains stay
consistent across artifacts.

## Finding

`finding.schema.json` describes an inspection finding. It requires an agent name, severity, claim, evidence, recommendation, and confidence score. Evidence must include at least one file path and line range. Findings may also carry optional RAG-card metadata such as tags, audience, card type, usage guidance, risks, and adaptation notes.

## Scout Output

`scout-output.schema.json` describes the Scout agent's repository map. It
requires project type, detected stack, important files, entry points, an initial
architecture impression, open questions, and structured findings. Concrete
Scout claims must cite repository-relative evidence; open questions are the
place for uncertainty rather than unsupported deep conclusions.

## Architecture Output

`architecture-output.schema.json` describes the Architecture agent's map. It
requires layer map, dependency direction, module boundaries, business logic
locations, framework glue locations, architecture risks, and candidate findings.
Each architecture section separates observed facts from optional interpretation
and cites repository-relative file and line evidence. Findings remain candidate
findings until later QA accepts or rejects them.

## Pattern Miner Output

`pattern-miner-output.schema.json` describes reusable implementation patterns
observed by the Pattern Miner agent. Each pattern records the name, problem
solved, implementation shape, evidence, tradeoffs, when to use it, when not to
use it, adaptation value, tags, and confidence. Tradeoffs are required, and
high-confidence patterns require traceable evidence. Pattern Miner also emits
candidate findings for downstream QA and reporting.

## Flow Tracer Output

`flow-tracer-output.schema.json` describes verified feature-flow traces. It
allows up to three flows and requires each flow to include the user or system
action, entry point, main files, data path, side effects, persistence path,
error paths, tests, and evidence. When a flow or part of a flow is not visible,
the output must record insufficient evidence instead of inventing behavior.
Flow Tracer also emits candidate findings for downstream QA, final
documentation, and flow RAG cards.

## Testing Strategy Output

`testing-strategy-output.schema.json` describes the Testing Strategy agent's
testing and quality-gate assessment. It records test types found, quality gates,
behavior protected by existing tests, behavior not protected, command evidence,
testing risks, recommendations, and candidate findings. Command status must be
`passed`, `failed`, or `not-run`; passed command evidence requires an exit code
and run timestamp, and the application validator rejects passed quality-gate
claims unless matching passed command evidence exists.

## Tradeoff Analyst Output

`tradeoff-analyst-output.schema.json` describes the Tradeoff Analyst agent's
decision and risk assessment. It records strong decisions, weak decisions,
overengineering risks, underengineering risks, hidden assumptions,
agent-safety risks, adaptation warnings, and candidate findings. Every
tradeoff category requires repository-relative file and line evidence.
Adaptation warnings keep repo-specific context separate from advice about
copying the approach elsewhere. The application validator rejects outputs that
only praise strong decisions without naming any weak decision, risk,
assumption, safety risk, or adaptation warning.

## QA Result

`qa-result.schema.json` describes validation of a finding. It records the QA agent, target finding, status, rationale, checks performed, and whether follow-up is required. The runtime QA verifier also writes `qa/readiness.json` with a deterministic readiness score derived from approved findings divided by total candidate findings.

## QA Issue and Revision Request

`qa-issue.schema.json` describes an individual failed or review-needed QA check.
`revision-request.schema.json` records how a failed QA result is routed back to
the responsible follow-up agent, including required corrections. Unsupported
claims and direct contradictions are rejected instead of promoted into final
outputs.

## Knowledge Card

`knowledge-card.schema.json` captures reusable knowledge for future agents.
Cards include one idea with a topic, summary, source repository, confidence,
evidence links, tags, and intended audience. Optional usage guidance,
non-usage guidance, risks, and adaptation notes can be included when the
approved finding provides them. Runtime RAG cards are written as JSONL streams
under `final/rag_cards/` and must validate before they are written.

## Memory Event

`memory-event.schema.json` records operational events for local swarm memory. It is for continuity and coordination, not public product documentation.

## Inspection Report

`inspection-report.schema.json` combines repository metadata, findings, QA results, generated knowledge cards, summary text, and validation metadata. It is the top-level artifact for a completed inspection.

## Repository, Agents, and Runs

`repository-target.schema.json` describes the target repository under
inspection. `agent-attempt.schema.json` records a single agent execution attempt
with its role and lifecycle status. `run-config.schema.json` captures the
validated configuration used to start an inspection. `inspection-run.schema.json`
combines the target, config, attempts, findings, QA results, revision requests,
memory events, knowledge cards, and optional final report for the run.

## Validation Principle

Schemas define minimum acceptable structure. Passing schema validation does not
prove a claim is correct; it proves the output is complete enough for review and
downstream tooling. TypeScript domain models in `src/domain/types.ts` must stay
aligned with these schemas.

The runtime validation adapter in `src/validation` wraps the existing schema
files for use by orchestrator, CLI, and test callers. It currently exposes
validators for Scout output, Architecture output, Pattern Miner output, Flow
Tracer output, Testing Strategy output, Tradeoff Analyst output, findings, QA
results, knowledge cards, memory events, QA issues, and inspection reports
without duplicating schema definitions in TypeScript.

## Agent Output Validation

The application output validator selects the schema declared by the agent
contract, parses the raw JSON output, and writes a validation report for the
agent attempt. Passing reports use `status: "passed"`. Malformed JSON reports
preserve the parse error with `status: "malformed-json"`, and schema failures
preserve structured contract, path, keyword, and message details with
`status: "schema-invalid"`.

The filesystem adapter writes reports to
`validation/<agent-id>/attempt-<n>/report.json` in the run workspace. These
reports are intended for later lifecycle transitions, QA review, and retry
routing.

## Evidence Validation

The application evidence validator performs deterministic reference checks
before semantic QA. It verifies that cited files exist in the inspected
repository inventory, line ranges fit within known file line counts,
`lineStart <= lineEnd`, and evidence paths do not escape the repository.

It also checks cross-artifact references where the relevant context is
available: high-confidence findings must include evidence, QA results must
target existing findings, and knowledge-card evidence must reference approved
findings.

## Agent Registry Contracts

`src/agents` defines the fixed runtime agent registry. Every registered agent
declares its id, role, description, dependencies, output artifacts, output
schema, retry policy, required/optional policy, and QA revision ownership.

The required V1 agents are `scout`, `architecture`, `pattern_miner`,
`flow_tracer`, `testing_strategy`, `tradeoff_analyst`, `qa_verifier`, and
`final_reviewer`. The later optional agent is `rag_card_distiller`.

## Prompt Templates

Auditable prompt source templates live under `prompts/`. Shared rules are in
`prompts/shared/`, and required V1 agent templates are in `prompts/agents/`.
The application prompt builder injects objective, target repository context,
repository index summary, previous outputs, memory snapshot, output schema,
evidence rules, and revision request context for retry attempts. The exact
assembled prompt is saved in the run workspace under
`agents/<agent-id>/attempt-<n>/prompt.md`.

## Runner Results

Agent execution uses the `AgentRunner` port. Fake runner results are
deterministic for orchestration tests. The process-backed Codex runner requires
callers to provide the local command and argument template explicitly, then
returns stdout, stderr, exit code, timestamps, output artifact paths, streaming
events, and failure reasons. Tests exercise the real process path with harmless
fixture commands rather than invoking a live Codex CLI.

## Lifecycle Status

The orchestrator owns agent lifecycle state. The lifecycle state machine uses
`PENDING`, `RUNNING`, `OUTPUT_RECEIVED`, `SCHEMA_VALIDATED`,
`EVIDENCE_VALIDATED`, `QA_REVIEWED`, `APPROVED`, `SCHEMA_FAILED`,
`EVIDENCE_FAILED`, `QA_FAILED`, `RETRYING`, and `FAILED`. It rejects invalid
transitions, increments attempts each time an agent enters `RUNNING`, and treats
`APPROVED` and `FAILED` as terminal states.

Serialized status snapshots include the agent id, current status, attempt
count, creation and update timestamps, and transition history. The filesystem
adapter writes the snapshot to
`agents/<agent-id>/attempt-<n>/status.json`.
