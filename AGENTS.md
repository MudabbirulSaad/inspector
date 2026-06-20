# Repository Guidelines

## Repository Purpose

`inspector` is a Node.js and TypeScript CLI for orchestrating AI-assisted codebase inspection workflows. The system is intended to index a target repository, coordinate specialist inspection agents, validate evidence-backed findings, route failed QA results for follow-up, and produce case-study documentation plus RAG-ready knowledge cards.

## Required Reading Order

Before planning or editing, read:

1. `AGENTS.md`
2. `docs/project-context.md`
3. `docs/architecture.md`
4. `docs/ai-assisted-workflow.md`
5. `.agents/rules.md`
6. `.agents/memory.md` if it exists locally

Use public docs for stable project context. Treat `.agents/memory.md` and `.agents/state/**` as local operational memory, not public product documentation.

## Architecture Rules

Use a modular hexagonal architecture. Keep domain and application logic independent from Node APIs, process execution, filesystem access, and Codex runner details. Define ports for repository access, process execution, agent runners, memory stores, validators, clocks, logging, and writers. Place production code under `src/` when implementation begins, with tests under `tests/`.

## TDD and Validation

Use TDD for production code and validation scripts. Work in vertical slices: one behavior test, the smallest implementation, then refactor while green. Tests should verify public behavior rather than private implementation details.

Run the relevant validation before committing. Today the available validation is:

```bash
npm test
```

Add `typecheck`, `lint`, and `build` scripts only when their required configuration and source files exist.

## Output Evidence Rules

Agent outputs must be structured, evidence-backed, and schema-valid where a contract exists. Findings must include traceable file and line evidence. QA results must explain pass/fail decisions. Knowledge cards and reports must preserve the evidence chain.

## Public and Private Context

Public files include `README.md`, `AGENTS.md`, `docs/**`, `schemas/**`, and `examples/**`. Keep them polished, factual, and recruiter-safe. Do not commit raw prompts, transcripts, scratchpads, local logs, secrets, or personal paths.

## Security Rules

Never commit `.env` files, secrets, tokens, raw logs, transcripts, or local agent state. Use `.env.example` only for documented, non-secret configuration examples.

## Commit Rules

Preserve user work. Keep commits focused, use imperative subjects, and commit only after relevant validation passes. Document behavior, architecture, or workflow changes in public docs when they affect future contributors or agents.
