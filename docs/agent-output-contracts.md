# Agent Output Contracts

Agent outputs must be structured, evidence-backed, and validation-friendly. The schemas in `schemas/` define the current contracts, and `examples/` contains small valid examples.

## Finding

`finding.schema.json` describes an inspection finding. It requires an agent name, severity, claim, evidence, recommendation, and confidence score. Evidence must include at least one file path and line range.

## QA Result

`qa-result.schema.json` describes validation of a finding. It records the QA agent, target finding, status, rationale, checks performed, and whether follow-up is required.

## Knowledge Card

`knowledge-card.schema.json` captures reusable knowledge for future agents. Cards include a topic, summary, evidence links, tags, and an intended audience.

## Memory Event

`memory-event.schema.json` records operational events for local swarm memory. It is for continuity and coordination, not public product documentation.

## Inspection Report

`inspection-report.schema.json` combines repository metadata, findings, QA results, generated knowledge cards, summary text, and validation metadata. It is the top-level artifact for a completed inspection.

## Validation Principle

Schemas define minimum acceptable structure. Passing schema validation does not prove a claim is correct; it proves the output is complete enough for review and downstream tooling.
