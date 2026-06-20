# AI-Assisted Workflow

## Operating Model

AI-assisted development in this repository is constrained engineering work, not uncontrolled generation. Humans define the architecture, milestones, acceptance criteria, quality gates, and review expectations. Agents operate inside those constraints.

Agents must follow the fixed milestone plan in
`docs/implementation-plan.md`. They must execute only the milestone explicitly
requested for the current session and must not generate a competing roadmap.

## Agent Responsibilities

Agents should inspect before editing, use documented project vocabulary, preserve user work, and produce evidence for claims. When an output contract exists, the agent should emit schema-valid data that can be checked by automation.

Runtime inspection agents are external workers. They produce findings and
supporting evidence; the orchestrator owns lifecycle state, scheduling,
validation, QA routing, and final artifact assembly.

## Agent Lifecycle

The planned runtime lifecycle is:

1. The orchestrator indexes the target repository.
2. The application builds a dependency-aware inspection DAG.
3. Specialist agents run when their DAG dependencies are satisfied.
4. Agent outputs are validated against schemas and evidence rules.
5. QA evaluates validated findings.
6. Failed QA creates revision requests and routes follow-up work.
7. Accepted findings move into final report and knowledge-card assembly.

Specialist agents may run concurrently when the scheduler DAG permits it, but
final writers must wait for accepted findings and QA results.

## Evidence and QA

Findings require traceable evidence, including file paths and line ranges. QA results must explain whether a finding passed, failed, or needs follow-up. Failed QA can be routed back to the responsible agent with clear reasons and required corrections.

Revision routing must preserve ownership and rationale. A follow-up request must
identify the finding, failed checks, required correction, and target agent.
Revised findings must pass validation before they can reach final outputs.

## Swarm Memory

Swarm memory is local coordination state. It can record decisions, milestone
progress, validation results, findings, QA events, and next steps, but it does
not replace public docs, tests, schemas, or ADRs.

Memory must not contain secrets, raw prompts, raw transcripts, private logs, or
unverified claims intended for public output.

## Validation Gates

Validation commands gate progress. A milestone is not complete because text was generated; it is complete when the relevant tests, schemas, docs, and checks pass. Local memory can help continuity, but it does not replace tests, ADRs, or public documentation.

## Public Presentation

Public documentation should describe deliberate AI-assisted engineering practice: clear constraints, human review, evidence-backed outputs, repeatable validation, and maintainable architecture.

Final case-study documentation must include only QA-approved findings, exclude
rejected findings, preserve file and line evidence chains, and say when there is
not enough verified evidence for a section. RAG-ready knowledge cards must also
include only validated, evidence-backed material. Reports should preserve
validation metadata and QA status so reviewers and future agents can trace every
claim.
