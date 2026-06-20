# Agent Output Contracts

Agent outputs and persisted run artifacts must be structured, evidence-backed,
and validation-friendly. The schemas in `schemas/` define the current
contracts, and `examples/` contains small valid examples.

## Shared Evidence

`evidence.schema.json` describes a traceable file and line range. Findings,
QA issues, knowledge cards, and reports reuse this shape so evidence chains stay
consistent across artifacts.

## Finding

`finding.schema.json` describes an inspection finding. It requires an agent name, severity, claim, evidence, recommendation, and confidence score. Evidence must include at least one file path and line range.

## QA Result

`qa-result.schema.json` describes validation of a finding. It records the QA agent, target finding, status, rationale, checks performed, and whether follow-up is required.

## QA Issue and Revision Request

`qa-issue.schema.json` describes an individual failed or review-needed QA check.
`revision-request.schema.json` records how a failed QA result is routed back to
the responsible follow-up agent, including required corrections.

## Knowledge Card

`knowledge-card.schema.json` captures reusable knowledge for future agents. Cards include a topic, summary, evidence links, tags, and an intended audience.

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
validators for findings, QA results, knowledge cards, memory events, and
inspection reports without duplicating schema definitions in TypeScript.
