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
findings, and blackboard snapshots. Runtime CLI behavior is still pending.

## Non-Goals

- Building a web UI.
- Operating a hosted service.
- Storing private prompts or transcripts in public docs.
- Accepting findings without evidence.
- Coupling domain logic to a single AI provider or runner implementation.
- Publishing unreviewed or QA-failed findings in final docs or RAG cards.

## Documentation Update Rule

Update this file and the relevant ADRs when project goals, architecture, validation strategy, or workflow rules change.
