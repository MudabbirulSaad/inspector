# Inspector

`inspector` is a planned Node.js and TypeScript CLI for AI-assisted codebase inspection. It will coordinate specialist inspection agents, validate evidence-backed findings, and produce documentation artifacts that future coding agents can reuse.

The repository is currently in an agent-workflow governance milestone. Runtime CLI implementation has not started yet.

## Goals

- Inspect a target repository through a local-first CLI.
- Orchestrate specialist agents with dependency-aware execution.
- Require evidence-backed, schema-valid outputs.
- Route failed QA findings back to the responsible agent.
- Produce case-study documentation and RAG-ready knowledge cards.

## Current Validation

The available validation checks JSON Schema contracts, examples, TypeScript
compilation, linting, and build output:

```bash
npm install
npm run validate
```

## Documentation

- [Project context](docs/project-context.md)
- [Architecture](docs/architecture.md)
- [AI-assisted workflow](docs/ai-assisted-workflow.md)
- [Testing strategy](docs/testing-strategy.md)
- [Agent output contracts](docs/agent-output-contracts.md)
- [Case study](docs/case-study.md)
- [Agent instructions](AGENTS.md)
