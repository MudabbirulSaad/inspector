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

## At a Glance

| | |
| --- | --- |
| **Problem** | AI-assisted repository reviews can produce plausible findings without a durable evidence chain or repeatable quality gate. |
| **Approach** | Index locally, require schema-valid specialist output, verify cited files and lines, run deterministic QA, and publish approved findings only. |
| **Status** | Active local CLI. The npm package remains private while release behavior is verified. |
| **Technologies** | TypeScript, Node.js, JSON Schema, Vitest, and dependency-injected process runners. |
| **Quality** | Hexagonal TypeScript design, safe command allowlists, resumable run state, fixture-driven end-to-end tests, type checking, and linting. |
| **Verify** | Run `npm run validate` for type checking, linting, unit/integration tests, a clean build, and packed-CLI verification. |

Platform note: on Windows, the aggregate validation currently reaches two known portability failures in packed-CLI process spawning and POSIX-style XDG path expectations. Type checking, linting, and the production build pass; the PR documents those existing limitations rather than presenting the aggregate command as universally green.

## Quick Demonstration

```bash
npm install
npm run build
demo_root="$(mktemp -d)"
cp -R ./tests/fixtures/tiny-node-app "$demo_root/tiny-node-app"
printf 'Inspect the architecture and testing strategy for reuse opportunities.\n' > "$demo_root/objective.md"
npm run dev -- run "$demo_root/tiny-node-app" \
  --objective "$demo_root/objective.md" \
  --out "$demo_root/.inspector-runs" \
  --verbose
```

The default fake runner exercises the complete local pipeline without network calls or modifying the checked-in fixture. A successful run produces repository inventory, specialist attempts, validation and QA artifacts, public case-study Markdown, and evidence-linked RAG cards inside the temporary directory.

## What It Does

- Creates an auditable internal run workspace and preserves compatible
  configured output-directory workspaces for the current CLI.
- Writes repository index artifacts for file tree, important files, stack
  signals, and detected quality commands.
- Builds and stores exact prompts for each specialist attempt.
- Validates agent JSON output against schemas and cited file/line evidence.
- Stores append-only run memory for findings, QA issues, decisions, and
  blackboard snapshots.
- Runs QA over candidate findings and records approved, rejected, and unresolved
  results.
- Retries owner agents when QA creates revision requests and retries remain.
- Publishes a fixed Markdown case-study package under
  `<target-repo>/docs/inspector/`.
- Retains internal Markdown under `final/docs/` and JSONL RAG card streams under
  `final/rag_cards/`.
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

After building, `node dist/main.js` or package-style `npx codebase-inspector` opens the
interactive wizard. The wizard defaults to the current directory, publishes
Markdown to `./docs/inspector`, stores internal run data under the OS Inspector
user data directory, and uses the fake runner unless a process-backed Codex
runner is selected.

Inspect an existing run:

```bash
npm run dev -- status ./.inspector-runs/<run-directory>
npm run dev -- resume ./.inspector-runs/<run-directory>
```

The npm package name is `codebase-inspector`. The package remains private while
local release behavior is verified with `npm pack`; that tarball can be
installed in a temporary project and exercised with the same command shape as
`npx codebase-inspector`. The installed binary is still named `inspector`.

For package-style usage after building:

```bash
node dist/main.js
node dist/main.js run <repo-path> --objective <objective-file> --out <output-path>
npx codebase-inspector --help
npx codebase-inspector run <repo-path> --objective <objective-file> --out <output-path>
```

Use the deterministic fake runner for offline packaging and workflow smoke
tests. Use a process-backed runner only when you intend to call a real local
Codex or compatible agent command.

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
