# Project Context

## Project Goal

Build a production-quality Node.js and TypeScript CLI that orchestrates AI-assisted codebase inspection agents. The CLI will accept a target repository directory, index and analyze it, run specialist agents, stream verbose output, validate agent outputs, route failed QA findings for follow-up, and emit final documentation.

## Core Outputs

- Shared swarm memory for coordination.
- Evidence-backed inspection findings.
- QA results with validation metadata.
- Final case-study documentation.
- RAG-ready knowledge cards for future coding agents.

## Target Users

Primary users are senior engineers, technical leads, and AI-assisted development practitioners who need repeatable repository inspections with traceable evidence and quality gates.

## Architecture Shape

The project uses a hexagonal architecture. Domain models describe repositories, agents, findings, QA results, memory events, knowledge cards, and inspection reports. Application services coordinate indexing, planning, execution, validation, rerouting, and writing. Adapters handle CLI input, filesystem access, process execution, Codex runner integration, memory persistence, and output formats.

## Development Method

Implementation should proceed through TDD-driven vertical slices. Each milestone should define observable behavior, add or update tests, implement the smallest production-quality slice, run validation, and update docs.

## Current State

The repository currently contains governance documentation, JSON Schemas,
examples, schema/example validation tests, TypeScript configuration, lint
tooling, schema-aligned domain model exports, minimal hexagonal source
boundaries, runtime JSON Schema validators for core agent output contracts, an
auditable run workspace creation port with a filesystem adapter, and a
deterministic repository indexer that emits `repo_index/` artifacts including
stack and quality-command detection. It also includes an append-only run memory
store for swarm events, decisions, findings, QA issues, verified/rejected
findings, and blackboard snapshots, plus a fixed agent registry for V1 and later
inspection agent contracts. It now has auditable prompt templates for required
V1 agents, plus application and filesystem ports that build exact agent prompts
from run context and save those prompts under the run workspace. Agent execution
is abstracted behind an `AgentRunner` port with deterministic fake and
process-backed Codex adapters. The process-backed adapter requires explicit
local CLI command configuration and uses a real process runner for stdout,
stderr, streaming events, working directory, timeout, and structured result
handling. Agent lifecycle state is now modeled as an auditable state machine
with attempt tracking, deterministic status serialization, and filesystem
status artifacts under each agent attempt folder. The application layer now
includes a dependency-aware agent scheduler that runs ready agents in
deterministic order, executes independent agents in parallel up to a configured
limit, blocks dependents of failed required agents, and allows continuation
after optional agent failures. Agent output validation now selects schemas from
agent contracts, parses JSON output, records malformed JSON and schema
violations, and writes validation reports under the run workspace for QA and
retry routing. Evidence validation now deterministically checks cited repository
paths, positive line ranges, high-confidence finding evidence, QA finding
references, and knowledge-card references to approved findings before semantic
QA, while loading line counts only for cited repository files. QA verification
now reviews candidate findings against schema and evidence reports, rejects
unsupported or contradictory findings, creates owner-agent revision requests,
writes QA artifacts, appends approved/rejected findings to run memory, and
computes a deterministic readiness score. The runtime CLI slice now parses
`inspector run`, validates repository and objective paths, wires concrete
adapters, prints progress, and calls a Scout/Architecture/Pattern Miner plus QA
application use case. That use case creates a run workspace, indexes the
repository, initializes memory, builds auditable Scout, Architecture, and
Pattern Miner prompts, runs Scout before Architecture before Pattern Miner
through the runner port, validates structured schemas and cited evidence, writes
artifacts through ports, appends candidate findings from schema-valid and
evidence-valid outputs, runs QA, and routes QA revision requests back only to
the owning agent. Owner retries preserve prior attempts, include the previous
output and QA issue in the repair prompt, revalidate schema and evidence, update
memory, rerun QA, and leave unresolved final revision requests visible when the
retry policy is exhausted. Full scheduler-driven multi-agent orchestration is
still pending.

## Non-Goals

- Building a web UI.
- Operating a hosted service.
- Storing private prompts or transcripts in public docs.
- Accepting findings without evidence.
- Coupling domain logic to a single AI provider or runner implementation.
- Publishing unreviewed or QA-failed findings in final docs or RAG cards.

## Documentation Update Rule

Update this file and the relevant ADRs when project goals, architecture, validation strategy, or workflow rules change.
