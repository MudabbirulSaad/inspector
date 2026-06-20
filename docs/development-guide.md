# Development Guide

This repository uses a modular hexagonal architecture. Domain and application
logic stay independent from Node filesystem APIs, process execution, and Codex
runner details. Adapters translate CLI, filesystem, process, prompt, memory,
validation, QA, and writer concerns into ports.

## Setup

```bash
npm install
npm run build
```

Run the CLI in development:

```bash
npm run dev -- run ./tests/fixtures/tiny-node-app --objective ./objective.md --out ./.inspector-runs
```

## Source Layout

- `src/domain/`: schema-aligned domain models and lifecycle state.
- `src/application/`: use cases for indexing, prompt building, agent workflow,
  validation, QA, retry routing, final docs, and RAG cards.
- `src/ports/`: dependency inversion boundaries.
- `src/adapters/`: CLI, filesystem, process, and Codex runner adapters.
- `src/agents/`: agent registry and contracts.
- `src/validation/`: runtime JSON Schema validators.
- `schemas/`: public JSON Schema contracts.
- `examples/`: schema-aligned example artifacts.
- `prompts/`: versioned prompt templates.
- `tests/`: unit, integration, and e2e tests.

## TDD Expectations

Use TDD for production code and validation scripts. Work vertically:

```text
one behavior test -> smallest implementation -> refactor while green
```

Documentation-only changes do not need new tests unless they introduce
executable examples or change validated contracts.

Prefer public behavior tests over private implementation tests. Use fakes for
ports such as clocks, process runners, workspace stores, memory stores, and
agent runners.

## Validation

Run individual checks:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Run the aggregate gate:

```bash
npm run validate
```

Do not claim validation passed unless the command actually ran and passed.

## Documentation Rules

Public docs include `README.md`, `AGENTS.md`, `docs/**`, `schemas/**`, and
`examples/**`. Keep them factual, polished, and free of private machine details.

Local operational memory lives in `.agents/memory.md` and `.agents/state/**`.
Do not treat local memory as public product documentation.

## Security

Do not commit `.env` files, secrets, tokens, raw logs, transcripts, scratchpads,
or local agent state. Use `.env.example` only for documented non-secret
configuration examples.
