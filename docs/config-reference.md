# Configuration Reference

`inspector run inspection.yaml` accepts a small YAML subset: top-level key/value
pairs, top-level lists, and one-level object blocks. Unknown fields fail fast.

## Example

```yaml
repoPath: ./my-repo
outputPath: ./.inspector-runs
objective: Inspect architecture, reusable patterns, flows, testing, and tradeoffs.
targetContext: Focus on code paths used by the CLI.
verbose: true
maxRetries: 1
runQualityCommands: false
runner:
  provider: codex
  command: codex
  args:
    - exec
    - --json
  timeoutMs: 300000
```

## Fields

`repoPath`
: Required unless overridden with `--repo`. Existing repository directory.
Relative paths resolve from the config file directory.

`outputPath`
: Required unless overridden with `--out`. Directory where run workspaces are
created. Relative paths resolve from the config file directory.

`objective`
: Required unless overridden with `--objective`. Inline inspection objective.
The direct CLI form reads the objective from a file instead.

`targetContext`
: Optional extra context appended to the objective under a `Target context:`
heading.

`agents`
: Optional list of agent ids. The current CLI accepts only the exact implemented
sequence: `scout`, `architecture`, `pattern_miner`, `flow_tracer`,
`testing_strategy`, `tradeoff_analyst`.

`parallelism`
: Optional integer greater than or equal to `1`. The current CLI accepts only
`1` or an omitted value.

`maxRetries`
: Optional integer greater than or equal to `0`. Reduces the number of owner
revision retries for the run. The default agent contracts allow up to two
attempts.

`runQualityCommands`
: Optional boolean. Defaults to `false`. When true, detected test, typecheck,
lint, and build commands are executed only if they pass the safety allowlist.

`verbose`
: Optional boolean. Prints user-facing progress when true.

`runner`
: Optional runner configuration. Omit it, or use `provider: fake`, for the
deterministic fake runner.

## Runner Fields

`runner.provider`
: Required when `runner` is present. Supported values are `fake`, `process`, and
`codex`.

`runner.command`
: Required for `process` and `codex`. Local executable to run.

`runner.args`
: Optional list of string arguments passed to the process-backed runner.

`runner.timeoutMs`
: Optional integer timeout in milliseconds. Also applies to trusted quality
command execution when configured.

`runner.env`
: Optional object of string environment variables merged into the child process
environment.

## Codex CLI Configuration

A Codex-backed run is just a process-backed run with a Codex command:

```yaml
runner:
  provider: codex
  command: codex
  args:
    - exec
    - --json
  timeoutMs: 300000
```

Keep authentication, tokens, and machine-specific Codex setup outside this
repository. Do not commit `.env` files, local transcripts, or raw logs.
