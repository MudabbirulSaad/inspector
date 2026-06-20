# CLI Usage

The CLI binary is `inspector` after `npm run build`. The npm package name is
`codebase-inspector`. During development, use `npm run dev --`.

Show command help:

```bash
npm run dev -- --help
node dist/main.js --help
```

Start the interactive release wizard:

```bash
npx codebase-inspector
node dist/main.js
```

The wizard asks for the repository path, public docs output path, internal run
data directory, runner choice, optional Codex process command, trusted
full-auto/YOLO consent, trusted quality-command consent, and final confirmation.
Defaults are `.`, `./docs/inspector`, the OS Inspector user data directory, the
fake runner, and no quality-command execution.

When Codex full-auto/YOLO is selected, the wizard prints:

```text
This grants Codex permission to run commands in this trusted local repository. Use only on repositories you trust.
```

When quality command execution is selected, the wizard prints:

```text
Detected package scripts can execute arbitrary project code. Enable only for trusted repositories.
```

Both risky modes require explicit confirmation before the run can start.

## Run

Direct repository/objective form:

```bash
npm run dev -- run <repo-path> --objective <objective-file> --out <output-path> [--verbose] [--debug] [--run-quality-commands]
```

Config file form:

```bash
npm run dev -- run inspection.yaml [--repo <repo-path>] [--objective <objective-file>] [--out <output-path>] [--verbose] [--debug] [--run-quality-commands]
```

Required direct arguments:

- `<repo-path>`: existing repository directory to inspect.
- `--objective <objective-file>`: text file describing the inspection goal.
- `--out <output-path>`: directory where `.inspector-runs` style workspaces can
  be created.

Successful runs publish user-facing Markdown docs to
`<repo-path>/docs/inspector/`. Internal artifacts remain in the run workspace
printed as `Inspection run workspace:`. The public docs directory intentionally
contains Markdown only; raw prompts, JSON validation reports, QA artifacts,
memory streams, and RAG JSONL stay in the internal workspace.

The interactive wizard can publish public Markdown to a custom docs directory.
Non-interactive `run` keeps the compatible `<repo-path>/docs/inspector/`
location.

Useful flags:

- `--verbose`: prints run start, indexing, agent lifecycle, validation, retry,
  QA, and final output progress.
- `--debug`: prints stack traces for runtime errors.
- `--run-quality-commands`: executes detected safe quality commands for trusted
  repositories. Without this flag, a skipped `validation/command_report.json` is
  still written.

Config overrides:

- `--repo`, `--objective`, and `--out` override config file values.
- `--verbose` and `--run-quality-commands` force those booleans on.
- `--debug` affects only CLI error reporting.

## Status

```bash
npm run dev -- status <run-dir>
```

`status` reads latest lifecycle snapshots for the implemented specialist stages
and prints counts for completed, failed, running, and pending stages.

Completed statuses are `EVIDENCE_VALIDATED`, `QA_REVIEWED`, and `APPROVED`.
Failed statuses are `SCHEMA_FAILED`, `EVIDENCE_FAILED`, `QA_FAILED`, and
`FAILED`.

## Resume

```bash
npm run dev -- resume <run-dir>
```

`resume` reconstructs an existing run from `config.json`, memory, repository
index, quality command report, lifecycle statuses, and output artifacts. It
reuses completed specialist outputs and continues failed or pending stages in
place. When final docs are regenerated, `resume` also republishes Markdown to
`<repo-path>/docs/inspector/`.

Resume fails safely when state is ambiguous, such as a completed stage without
its output artifact or an invalid lifecycle status.

## Built Entrypoint

After `npm run build`, the executable entrypoint is `dist/main.js` and the
package export surface is `dist/index.js`.

```bash
node dist/main.js run <repo-path> --objective <objective-file> --out <output-path>
```

## Current Runtime Limits

The user-facing runtime currently executes this fixed specialist sequence:

```text
scout -> architecture -> pattern_miner -> flow_tracer -> testing_strategy -> tradeoff_analyst
```

Config files may omit `agents`, or set `agents` to exactly that sequence.
Config files may omit `parallelism`, or set `parallelism: 1`. Custom agent
selection and `parallelism > 1` fail clearly until scheduler-driven runtime
orchestration is connected to the CLI.
