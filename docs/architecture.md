# Architecture

## Overview

`inspector` will use hexagonal architecture to keep inspection behavior independent from infrastructure. The core system should be testable without the real filesystem, process execution, network access, or a live Codex CLI.

Agents implementing this system must follow the fixed milestone plan in
`docs/implementation-plan.md`. Architecture documentation is the blueprint for
those milestones, not a competing roadmap.

## Hexagonal Boundaries

The core hexagon contains domain models and application use cases. It may define
ports, but it must not import Node APIs, shell process APIs, filesystem APIs, or
Codex runner implementations.

Adapters sit outside the hexagon. They translate CLI input, filesystem reads,
process execution, Codex invocations, local memory persistence, schema
validation, logging, and output writing into port calls that the application
layer can use.

Dependency direction must point inward:

- CLI, filesystem, process, Codex, memory, validator, logger, and writer
  adapters depend on application ports.
- Application services depend on domain models and ports.
- Domain models depend on no adapters and no application orchestration.

## Domain Layer

The domain layer owns stable concepts:

- Repository inventory and evidence locations.
- Inspection agents and responsibilities.
- Findings, severities, confidence, and recommendations.
- QA results and reroute decisions.
- Memory events, knowledge cards, and inspection reports.

Domain code should not import Node APIs or call external processes.

Domain responsibilities include:

- Representing repository inventory, evidence ranges, findings, QA results,
  memory events, knowledge cards, and inspection reports.
- Defining valid states for agent work, QA status, confidence, severity, and
  validation metadata.
- Preserving the evidence chain from finding to QA result to report and
  knowledge card.
- Keeping business rules provider-neutral so Codex remains an external worker,
  not the architecture core.

## Application Layer

The application layer coordinates use cases:

- Index a target repository.
- Plan specialist agent work.
- Execute agents when dependencies allow.
- Validate findings and QA results.
- Reroute failed QA findings.
- Write case studies and knowledge cards.

Application services depend on ports, not concrete adapters.

Application responsibilities include:

- Owning workflow control and scheduler decisions.
- Creating auditable run workspace requests through ports before runtime
  artifacts are written.
- Building deterministic repository index artifacts from repository metadata
  gathered through repository access ports.
- Detecting project stack signals and quality commands from repository manifests
  and workflow files so later planning can choose validation commands.
- Appending schema-valid swarm memory artifacts into the current run workspace
  through memory ports.
- Building the repository inspection plan from indexed repository metadata.
- Building auditable agent prompts from versioned templates, repository context,
  index summaries, previous outputs, memory snapshots, output schemas, evidence
  rules, and retry revision requests.
- Dispatching specialist agents only when their dependencies are satisfied.
- Parsing raw agent JSON output and selecting the correct validation contract
  from the agent registry before downstream QA.
- Accepting only schema-valid findings whose evidence paths remain inside the
  inspected repository and whose cited files and line ranges exist.
- Checking high-confidence findings for evidence, QA results for known finding
  references, and knowledge-card evidence for approved finding references before
  semantic QA.
- Preserving validation errors in report artifacts so QA and retry routing can
  explain malformed JSON and schema failures.
- Creating revision requests for failed QA and routing them to the responsible
  agent or follow-up agent.
- Assembling final report and knowledge-card write requests after validation
  succeeds.

## Adapters

Adapters will provide CLI parsing, filesystem access, process execution, Codex runner integration, memory storage, schema validation, logging, and Markdown/JSON writers.

Adapter responsibilities include:

- CLI adapters parse arguments, handle user-visible errors, and call application
  use cases.
- The first CLI `run` slice wires repository validation, objective loading, run
  workspace creation, repository indexing, memory initialization, auditable
  Scout prompt construction with repository index context, Scout execution,
  structured schema validation, evidence validation, candidate finding memory
  appends, artifact writing, and progress output. It remains Scout-only until
  the full scheduler-driven orchestration flow is wired.
- Filesystem adapters read target repository files and write approved outputs.
- Filesystem workspace adapters create `.inspector-runs/<timestamp>_<repo-name>/`
  directories, write `config.json`, and preserve existing user files by using a
  unique suffix when a timestamped workspace already exists.
- Filesystem repository adapters walk target repositories, provide
  repository-relative file metadata and manifest text to the application layer,
  and write approved `repo_index/` artifacts without leaking Node filesystem
  APIs into the core.
- Process adapters run local commands behind deterministic ports, capture
  stdout and stderr, emit stream events, enforce configured timeouts, and return
  structured command results without hardcoded command behavior.
- Agent runner adapters invoke external AI workers and return structured raw
  outputs, streaming events, artifact paths, timestamps, exit codes, and failure
  reasons for validation. The fake agent runner is deterministic for tests. The
  process-backed Codex runner requires explicit local CLI command configuration
  and delegates command execution to the process runner port.
- Agent status artifact adapters write deterministic lifecycle status snapshots
  into each agent attempt folder.
- Validation report adapters write deterministic validation reports for each
  agent attempt into the run workspace.
- Memory adapters persist local swarm events without exposing raw prompts,
  transcripts, secrets, or private state in public docs. Run memory is
  append-only and lives under the run workspace `memory/` folder.
- Prompt adapters load versioned templates from `prompts/` and write the exact
  prompt sent to each agent into the run workspace under that agent's attempt
  folder.
- Validator adapters apply JSON Schema and contract validation.
- Writer adapters emit final case-study Markdown, inspection reports, and
  RAG-ready knowledge cards.

## Planned Ports

Expected ports include:

- `RepositoryReader` for repository metadata and file content.
- `RepositoryIndexer` for producing repository inventory from reader data.
- `RepositoryIndexWriter` for writing deterministic repository index artifacts.
- `ProcessRunner` for local command execution.
- `AgentRunner` for external worker invocation.
- `Clock` for timestamps.
- `RunWorkspaceStore` for creating auditable inspection run workspaces.
- `Logger` for user-visible and diagnostic messages.
- `MemoryStore` for local operational swarm memory.
- `PromptTemplateReader` for loading shared and agent-specific prompt templates.
- `PromptArtifactWriter` for saving exact run-specific agent prompts.
- `AgentStatusArtifactWriter` for saving serialized lifecycle status snapshots.
- `ValidationReportWriter` for saving parse and schema validation reports.
- `EvidenceValidator` for deterministic file, line-range, and cross-artifact
  evidence-reference checks before semantic QA.
- `ArtifactValidator` for schema-backed runtime artifact checks used before
  writing memory or final outputs.
- `FindingValidator`, `QaValidator`, `KnowledgeCardValidator`, and
  `InspectionReportValidator` for contract checks.
- `Scheduler` for dependency-aware agent execution decisions.
- `RevisionRouter` for QA failure routing.
- `CaseStudyWriter`, `KnowledgeCardWriter`, and `InspectionReportWriter` for
  final output artifacts.

## Agent Lifecycle

An inspection agent moves through these application-owned lifecycle states:
`PENDING`, `RUNNING`, `OUTPUT_RECEIVED`, `SCHEMA_VALIDATED`,
`EVIDENCE_VALIDATED`, `QA_REVIEWED`, `APPROVED`, `SCHEMA_FAILED`,
`EVIDENCE_FAILED`, `QA_FAILED`, `RETRYING`, and `FAILED`.

The lifecycle state machine rejects invalid transitions, increments attempts
when an agent enters `RUNNING`, records transition history with timestamps and
optional reasons, and treats `APPROVED` and `FAILED` as terminal states. Failed
schema, evidence, and QA gates may transition to `RETRYING` or `FAILED`; retry
attempts re-enter the runner through `RUNNING`.

Agents produce findings and supporting material. The orchestrator owns lifecycle
state and workflow transitions, and status snapshots are serialized as
`status.json` artifacts under `agents/<agent-id>/attempt-<n>/` in the run
workspace.

## Agent Registry

The source registry in `src/agents` is the fixed contract source for runtime
inspection agents. Each contract defines the agent id, role, description,
dependencies, output artifact paths, output schema, retry policy,
required/optional policy, and QA revision ownership.

V1 requires these agents in deterministic order:

- `scout`
- `architecture`
- `pattern_miner`
- `qa_verifier`
- `final_reviewer`

Later optional agents are registered but not required for the V1 execution set:

- `flow_tracer`
- `testing_strategy`
- `tradeoff_analyst`
- `rag_card_distiller`

Scheduler code should consume the registry or derived dependency graph rather
than hardcoding agent ids in orchestration logic.

## Scheduler DAG

The scheduler should model inspection work as a directed acyclic graph. Nodes
represent indexing, specialist agent runs, validation steps, QA steps, revision
requests, and final writers. Edges represent data or quality-gate dependencies.

Initial scheduling rules:

- Repository indexing must complete before specialist agents run.
- Specialist agents may run in parallel when they do not depend on each other.
- Agent graph execution preserves deterministic ready-agent order from the
  supplied registry or contract list while enforcing a configurable parallelism
  limit.
- Dependents are blocked when a required dependency fails.
- Failed optional dependencies are treated as safe terminal dependencies so
  downstream work can continue when the dependent agent can tolerate the missing
  optional output.
- Finding validation must complete before QA.
- Failed QA routes to a revision node before final writing.
- Final case-study and RAG-card writers run only after required findings and QA
  results are accepted.

## Swarm Memory Rules

Swarm memory is local operational state for coordination. It may record
decisions, milestone progress, validation results, findings, QA events, and next
steps. It must not become the source of truth for public behavior.

Memory entries must avoid secrets, raw prompts, raw transcripts, private logs,
and unreviewed claims. Public reports and knowledge cards may cite only
validated findings with traceable evidence.

## QA and Revision Routing

Validators reject outputs that fail schema or evidence requirements. QA evaluates
whether a validated finding is accurate, sufficiently supported, and useful.

When QA fails or requests review, the application creates a revision request that
records the target finding, failing checks, rationale, required corrections, and
responsible follow-up agent. Revised outputs must re-enter validation before
they can affect final artifacts.

## Final Outputs

The final case-study documentation should summarize the inspected repository,
important findings, evidence, QA status, validation commands, and decisions in a
reviewable Markdown format.

RAG-ready knowledge cards should be compact, evidence-linked JSON artifacts for
future coding agents. They must preserve references back to validated findings
and source file ranges.

Only accepted findings and QA results may enter final case-study docs,
inspection reports, or knowledge cards.

## V1 Non-Goals

V1 should not include:

- A web UI.
- A hosted service or multi-tenant storage layer.
- Provider-specific domain logic.
- Raw prompt or transcript archival in public outputs.
- Acceptance of findings without file and line evidence.
- Automatic publication of unreviewed reports.

## Testability and Extensibility

Ports make deterministic tests possible because filesystem, process, clock, and Codex behavior can be replaced with fakes. The same boundary also allows new Codex runners, validators, writers, and memory stores without rewriting domain or application logic.
