# Inspector

`inspector` is a Node.js and TypeScript CLI for AI-assisted codebase inspection. It will coordinate specialist inspection agents, validate evidence-backed findings, and produce documentation artifacts that future coding agents can reuse.

The first runtime slice supports a Scout-only inspection run that creates a run workspace, indexes a repository, initializes memory, builds an audited Scout prompt from repository index context, runs Scout through a deterministic fake runner, validates structured Scout output and evidence, and appends Scout findings to candidate memory.

```bash
inspector run <repo-path> --objective <objective-file> --out <output-path> --verbose
```

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
