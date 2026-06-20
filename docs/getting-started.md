# Getting Started

`inspector` runs locally against a repository directory. A run needs a target
repository, an inspection objective, and an output directory where the run
workspace will be written.

## Prerequisites

- Node.js `>=22.18.0`
- npm
- A repository directory to inspect
- Optional: a local Codex CLI command if you want real process-backed agent
  execution instead of the default fake runner

Install dependencies and build the CLI:

```bash
npm install
npm run build
```

## First Run

Create an objective file:

```bash
cat > objective.md <<'EOF'
Inspect this repository for architecture boundaries, reusable patterns, feature
flows, testing strategy, and evidence-backed tradeoffs.
EOF
```

Run against a local fixture with the default fake runner:

```bash
npm run dev -- run ./tests/fixtures/tiny-node-app --objective ./objective.md --out ./.inspector-runs --verbose
```

The command prints the created run workspace path. The workspace contains the
repository index, memory streams, agent prompts and outputs, validation reports,
QA artifacts, final docs, and RAG cards.

## Run With A Config File

Create `inspection.yaml`:

```yaml
repoPath: ./tests/fixtures/tiny-node-app
outputPath: ./.inspector-runs
objective: Inspect architecture, patterns, flows, tests, and tradeoffs.
verbose: true
runner:
  provider: fake
```

Run it:

```bash
npm run dev -- run inspection.yaml
```

Relative `repoPath` and `outputPath` values are resolved from the config file's
directory.

## Configure Codex CLI

The CLI does not assume a global Codex command. Configure a process-backed
runner explicitly:

```yaml
repoPath: ./my-repo
outputPath: ./.inspector-runs
objective: Inspect architecture and testing risk.
verbose: true
runner:
  provider: codex
  command: codex
  args:
    - exec
    - --json
  timeoutMs: 300000
```

`provider: process` uses the same process-backed adapter. `command` is required
for `codex` and `process` providers. `args` are passed before the generated
prompt, and the target repository is used as the process working directory.

## Quality Commands

The repository index detects quality commands such as test, typecheck, lint, and
build scripts. They are not executed by default.

Enable them only for trusted repositories:

```bash
npm run dev -- run ./my-repo --objective ./objective.md --out ./.inspector-runs --run-quality-commands
```

When enabled, commands still pass through a safety allowlist. Shell syntax such
as pipes, redirects, command substitution, and command chaining is blocked.

## Next Steps

- Use [CLI usage](cli-usage.md) for commands and flags.
- Use [Configuration reference](config-reference.md) for config keys.
- Use [Output format](output-format.md) to inspect generated artifacts.
