# Inspector

`inspector` is a local Node.js and TypeScript CLI for orchestrating AI-assisted
codebase inspections. It indexes a target repository, builds prompts for
specialist inspection agents, validates their structured output, runs
deterministic QA over evidence-backed findings, routes failed QA results back to
the owning agent, and writes final case-study documentation plus RAG-ready
knowledge cards.

The current CLI supports a fixed V1 inspection sequence:

1. Scout
2. Architecture
3. Pattern Miner
4. Flow Tracer
5. Testing Strategy
6. Tradeoff Analyst
7. Deterministic QA and owner-agent revision attempts
8. Final docs and RAG card writing

By default, the standalone CLI uses a deterministic fake runner so the pipeline
can run without network access or a Codex dependency. Configure a process-backed
runner when you want to invoke a local Codex CLI command.

## What It Does

- Creates an auditable run workspace under the configured output directory.
- Writes repository index artifacts for file tree, important files, stack
  signals, and detected quality commands.
- Builds and stores exact prompts for each specialist attempt.
- Validates agent JSON output against schemas and cited file/line evidence.
- Stores append-only run memory for findings, QA issues, decisions, and
  blackboard snapshots.
- Runs QA over candidate findings and records approved, rejected, and unresolved
  results.
- Retries owner agents when QA creates revision requests and retries remain.
- Emits a fixed Markdown case-study package under `final/docs/`.
- Emits JSONL RAG card streams under `final/rag_cards/`.
- Supports `status` and `resume` for existing run workspaces.

## What It Does Not Do

- It is not a hosted service or web UI.
- It does not execute detected repository quality commands unless explicitly
  enabled for a trusted repository.
- It does not accept findings without schema-valid output and traceable
  repository evidence.
- It does not publish rejected findings into final docs or RAG cards.
- It does not currently expose custom runtime agent selection or `parallelism >
  1`; those fail clearly until scheduler-driven runtime orchestration is wired.
- It does not make the domain model depend on Codex. Codex is one possible
  runner behind a port.

## Quick Start

```bash
npm install
npm run build
```

Create an objective file:

```bash
printf 'Inspect the architecture and testing strategy for reuse opportunities.\n' > objective.md
```

Run the local fake-runner pipeline:

```bash
npm run dev -- run ./tests/fixtures/tiny-node-app --objective ./objective.md --out ./.inspector-runs --verbose
```

Inspect an existing run:

```bash
npm run dev -- status ./.inspector-runs/<run-directory>
npm run dev -- resume ./.inspector-runs/<run-directory>
```

For package-style usage after building:

```bash
node dist/main.js run <repo-path> --objective <objective-file> --out <output-path>
```

## Documentation

- [Getting started](docs/getting-started.md)
- [CLI usage](docs/cli-usage.md)
- [Configuration reference](docs/config-reference.md)
- [Agent authoring](docs/agent-authoring.md)
- [Output format](docs/output-format.md)
- [RAG cards](docs/rag-cards.md)
- [Development guide](docs/development-guide.md)
- [Project context](docs/project-context.md)
- [Architecture](docs/architecture.md)
- [AI-assisted workflow](docs/ai-assisted-workflow.md)
- [Agent output contracts](docs/agent-output-contracts.md)

## Validation

Run the full local gate:

```bash
npm run validate
```

Or run individual checks:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```
