# Inspector

`inspector` is a Node.js and TypeScript CLI for AI-assisted codebase inspection. It will coordinate specialist inspection agents, validate evidence-backed findings, and produce documentation artifacts that future coding agents can reuse.

The current runtime slice supports Scout, Architecture, Pattern Miner, Flow Tracer, Testing Strategy, Tradeoff Analyst, deterministic QA verification, final case-study docs, and RAG knowledge cards. It creates a run workspace, indexes a repository, initializes memory, builds audited prompts from repository index context and prior specialist outputs, validates each agent's structured output and evidence, appends candidate findings to memory, and then separates approved and rejected findings with QA results, QA issues, revision requests, and a readiness score.

The current standalone CLI runtime uses a deterministic fake runner by default.
Declarative config files can select the fake runner or a process-backed runner
with an explicit local command.

```bash
inspector run <repo-path> --objective <objective-file> --out <output-path> [--verbose] [--debug]
inspector run inspection.yaml
```

Detected quality commands are not executed by default. Use
`--run-quality-commands` or config `runQualityCommands: true` only for trusted
repositories; disabled runs still write `validation/command_report.json` with a
skipped reason. When execution is enabled, Testing Strategy command claims are
checked against that report.

Use `--verbose` to stream professional inspection progress, including indexing,
agent lifecycle, validation, retry, QA, and final output locations. Stack traces
are hidden by default and shown only with `--debug`.

Config files support `repoPath`, `outputPath`, `objective`, `targetContext`,
`agents`, `parallelism`, `maxRetries`, `runQualityCommands`, `verbose`, and
`runner`. Existing CLI flags such as `--objective`, `--out`, and `--verbose`
override config values where they apply. Custom `agents` selection and
`parallelism > 1` are reserved until scheduler-driven orchestration is wired
into the user-facing runtime.

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
