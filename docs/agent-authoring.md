# Agent Authoring

Agents are external workers behind the `AgentRunner` port. The orchestrator owns
run state, scheduling decisions, prompt assembly, schema validation, evidence
validation, QA, retry routing, and final artifact writing.

## Current Agents

The V1 runtime sequence is fixed:

- `scout`: maps repository structure, important files, stack signals, and focus
  areas.
- `architecture`: evaluates boundaries, dependency direction, and design risks.
- `pattern_miner`: finds implementation patterns and conventions.
- `flow_tracer`: traces one to three verified feature flows or reports
  insufficient evidence.
- `testing_strategy`: evaluates test types, quality gates, protected behavior,
  gaps, risks, and recommendations.
- `tradeoff_analyst`: identifies evidence-backed decisions, risks,
  assumptions, safety concerns, and adaptation warnings.

The registry also defines `qa_verifier`, `final_reviewer`, and later
`rag_card_distiller` contracts. QA and final writing are application-owned in
the current runtime rather than free-form agent output.

## Agent Contracts

Agent contracts live in `src/agents/index.ts`. A contract defines:

- `id`
- `role`
- `description`
- lifecycle group
- dependencies
- output artifact paths
- output schema
- retry policy
- required/optional policy
- QA revision ownership

Output schemas live in `schemas/`. Prompt templates live in `prompts/agents/`.
Shared prompt rules live in `prompts/shared/`.

## Output Requirements

Agent stdout must contain JSON matching the contract schema for that agent.
Candidate findings must include:

- stable finding id
- owning agent id
- severity
- claim
- recommendation
- confidence
- evidence file paths and line ranges
- validation tags when applicable

Evidence paths are repository-relative. Line ranges must be positive and must
exist in cited files. Unsupported claims should be omitted or represented as
insufficient evidence where the schema provides that shape.

## QA And Revision Loops

The application validates schema first, then deterministic evidence references,
then semantic QA over candidate findings. QA can approve findings, reject
findings, or create revision requests.

Revision requests preserve owner-agent routing. A failed Scout finding is routed
back to Scout; a failed Testing Strategy finding is routed back to Testing
Strategy. Retry prompts include prior output and the QA issue that needs repair.
Retry output is written as a new attempt and must pass schema and evidence
validation before final QA can use it.

When retries are exhausted, unresolved QA issues and revision requests remain in
the QA artifacts. They are not silently promoted into final docs or RAG cards.

## Add An Agent

Adding an agent requires all of these changes:

1. Add or update the output JSON Schema in `schemas/`.
2. Add a schema-aligned example in `examples/` when the contract is public.
3. Add domain types if the output shape is consumed by TypeScript code.
4. Register the agent contract in `src/agents/index.ts`.
5. Add a prompt template in `prompts/agents/`.
6. Add mapping code that extracts candidate findings for evidence validation and
   QA.
7. Connect dependencies and runtime orchestration.
8. Add behavior tests through public interfaces.
9. Update public docs when the user-facing behavior changes.

Do not add custom runtime agent selection to docs until the CLI actually
supports it. The scheduler module can model dependency-aware execution, but the
current user-facing run command still uses the fixed specialist sequence.
