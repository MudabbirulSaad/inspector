# AI-Assisted Workflow

## Operating Model

AI-assisted development in this repository is constrained engineering work, not uncontrolled generation. Humans define the architecture, milestones, acceptance criteria, quality gates, and review expectations. Agents operate inside those constraints.

## Agent Responsibilities

Agents should inspect before editing, use documented project vocabulary, preserve user work, and produce evidence for claims. When an output contract exists, the agent should emit schema-valid data that can be checked by automation.

## Evidence and QA

Findings require traceable evidence, including file paths and line ranges. QA results must explain whether a finding passed, failed, or needs follow-up. Failed QA can be routed back to the responsible agent with clear reasons and required corrections.

## Validation Gates

Validation commands gate progress. A milestone is not complete because text was generated; it is complete when the relevant tests, schemas, docs, and checks pass. Local memory can help continuity, but it does not replace tests, ADRs, or public documentation.

## Public Presentation

Public documentation should describe deliberate AI-assisted engineering practice: clear constraints, human review, evidence-backed outputs, repeatable validation, and maintainable architecture.
