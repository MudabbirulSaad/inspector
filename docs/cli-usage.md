# CLI Usage

The CLI entrypoint is `inspector` after `npm run build`. During development, use
`npm run dev --`.

Show command help:

```bash
npm run dev -- --help
node dist/main.js --help
```

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
place.

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
