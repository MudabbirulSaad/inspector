# RFC: Interactive `npx codebase-inspector` Release UX

## Status

Accepted for implementation

## Problem

Inspector is currently usable as a scriptable CLI through commands such as
`inspector run`, `inspector status`, and `inspector resume`. That shape is
appropriate for automation, tests, and explicit configuration, but it is not
the release experience expected from:

```bash
npx codebase-inspector
```

The production release should let a user run Inspector from inside any codebase
directory, answer a short set of safety and output questions, and see a curated
terminal experience while the inspection runs. The release architecture must
preserve the existing hexagonal boundary: product UX adapters may collect
choices and render progress, but application runtime remains responsible for
inspection orchestration, lifecycle state, evidence validation, QA, and output
writing.

Without this decision, an Ink terminal UI could accidentally become a second
orchestrator, write private run data into public docs, expose raw Codex output
by default, or normalize unsafe runner and quality-command behavior.

## Goals

- Make `npx codebase-inspector` an interactive production entrypoint.
- Let users inspect the current directory by default with repository path `.`.
- Write public development docs to `./docs/inspector` by default.
- Store internal run data in the OS user data directory by default.
- Keep `inspector run` scriptable and suitable for automation.
- Keep the deterministic fake runner available for dry runs.
- Require explicit, safety-aware consent before using a real Codex process
  runner or YOLO/full-auto mode.
- Keep trusted quality commands disabled unless the user explicitly opts in.
- Show curated lifecycle, status, and activity updates in the terminal.
- Save raw Codex stdout and stderr to internal logs, but summarize them in the
  terminal by default.
- Preserve evidence-backed output contracts and avoid publishing private run
  artifacts.

## Non-Goals

- Implementing Ink or any other terminal UI framework in this milestone.
- Changing runtime behavior, package scripts, or production source.
- Replacing the existing `inspector run` command.
- Adding a web UI, hosted service, or remote storage layer.
- Printing raw prompts, transcripts, or Codex output by default.
- Making quality-command execution the default.
- Treating the TUI as an application service or agent scheduler.

## User Experience

### Interactive `npx codebase-inspector`

Running `npx codebase-inspector` with no subcommand starts an interactive setup flow.
The user can run it from inside any codebase directory.

The flow asks, in order:

1. Which repository should be inspected?
2. Where should public development docs be written?
3. Where should internal run data be stored?
4. Which runner should be used?
5. Whether trusted quality commands may execute.
6. Whether the user confirms the inspection.

Defaults:

- Repository path: `.`
- Public docs output: `./docs/inspector`
- Internal run data: the OS user data directory for Inspector
- Runner: fake runner unless a release decision explicitly changes the prompt
  default after safe Codex onboarding exists
- Quality commands: disabled
- Raw agent output: hidden from the main terminal view

The confirmation screen must summarize the effective configuration before any
agent starts:

- Absolute inspected repository path.
- Public docs directory.
- Internal run data directory.
- Runner type.
- Whether the configured runner may modify files or run with YOLO/full-auto
  behavior.
- Whether quality commands will run.
- Where raw logs and private artifacts will be stored.

If the user selects the Codex process runner, the UI must explain that Inspector
will invoke a local Codex CLI process and that raw stdout/stderr will be saved
to internal logs. If the selected Codex mode can modify files or run with
YOLO/full-auto permissions, the user must give a separate clear confirmation.

### Non-interactive `inspector run`

`inspector run` remains the scriptable command for automation and CI-like
usage. It continues to accept direct arguments and declarative config files.

The command must not require Ink, interactive prompts, or TTY-specific behavior.
It should continue to fail clearly when required non-interactive inputs are
missing. Flags and config values remain the right interface for repository
path, objective, output paths, runner configuration, debug behavior, and trusted
quality-command execution.

`inspector run` may later accept the same output model as interactive
`npx codebase-inspector`, but it must remain predictable for scripts.

### `inspector status`

`inspector status <run-dir>` remains a non-interactive command that summarizes
an existing run from internal lifecycle artifacts.

For the release UX, status output should align with the same structured runtime
events used by the TUI. It should report completed, failed, running, and pending
agent stages without needing raw logs or public docs.

### `inspector resume`

`inspector resume <run-dir>` remains a non-interactive recovery command for an
existing internal run workspace.

Interactive `npx codebase-inspector` may offer resume as a future convenience when a
last-run pointer exists, but resume semantics stay application-owned:
completed or approved agents are reused, failed or pending stages continue in
place, and corrupted state fails safely.

### `inspector doctor`

`inspector doctor` should be added as a future support command for release
readiness checks. It should verify local prerequisites without starting an
inspection:

- Node.js and package execution environment.
- Writable public docs directory.
- Writable user data directory.
- Local Codex CLI availability when configured.
- Runner configuration sanity.
- Whether trusted quality commands are available but disabled by default.

Doctor output must be structured enough for tests and readable enough for users.
It should not execute repository quality commands unless a future explicit
doctor flag is added for that purpose.

## Output Model

### Public docs directory

The default public docs directory for interactive `npx codebase-inspector` is:

```text
./docs/inspector
```

This path is resolved relative to the inspected repository, not relative to the
package install location or an internal run workspace.

Public docs should contain polished, shareable development documentation derived
from QA-approved findings only. They may include case-study Markdown, summaries,
and other recruiter-safe or contributor-safe artifacts that preserve evidence
chains without exposing private operational material.

### Internal run data directory

Internal run data is stored under the OS user data directory by default. The
interactive flow may let the user override it, but the default must avoid
writing private prompts, raw outputs, schemas, QA artifacts, and intermediate
state into the inspected repository.

Internal run data includes:

- Exact prompts sent to agents.
- Raw Codex stdout and stderr logs.
- Raw and parsed agent outputs.
- Agent lifecycle status JSON.
- Schema validation reports.
- Evidence validation reports.
- QA JSON artifacts.
- Revision requests.
- Run memory.
- Repository index artifacts.
- RAG-ready knowledge cards.
- Debug logs and command reports.

The application runtime should treat these as internal artifacts even when a
user overrides the directory to a path inside the repository.

### What must never be written into public docs

Public docs must never contain:

- Raw prompts.
- Raw Codex stdout or stderr.
- Raw transcripts.
- Local scratchpads.
- Secrets, tokens, environment values, or `.env` contents.
- Internal run memory.
- Agent status JSON.
- Schema validation JSON.
- Evidence validation JSON.
- QA JSON.
- Revision request JSON.
- Internal RAG card streams unless a future export command intentionally
  publishes a sanitized subset.
- Personal absolute paths except where explicitly requested by a user-facing
  local command output.

Public docs should include only curated, validated conclusions and evidence
references that are safe to share with future contributors.

## Terminal UI Model

### TUI screens

The TUI is an adapter only. It collects interactive configuration, renders
application-owned events, and forwards user actions to application use cases.
It does not own orchestration, lifecycle transitions, validation, QA routing, or
output writing.

Expected screens:

- Welcome and repository selection.
- Output location selection.
- Runner and safety selection.
- Quality-command consent.
- Final confirmation.
- Live run dashboard.
- Completion summary.
- Failure summary with next command suggestions.

### Agent status rows

Agent rows are projections of application lifecycle state. Ink components do
not run agents directly and do not infer hidden states from UI-local timers.

Each row should show:

- Agent id or display name.
- Current lifecycle status.
- Attempt number.
- Last meaningful activity.
- Validation or QA gate outcome when known.
- Failure reason summary when failed.

Rows should be derived from structured inspection events and persisted status
artifacts, so the same information can power `status`, `resume`, logs, and
tests.

### Current activity

The live dashboard should show one concise current-activity message at a time,
such as:

- Indexing repository.
- Building prompt for Architecture.
- Running Pattern Miner.
- Validating evidence for Flow Tracer.
- Running QA verification.
- Writing public docs.

Current activity is emitted by the application runtime as a structured event.
The TUI may choose display wording, but it should not invent workflow phases.

### Error display

Errors should be concise by default:

- What failed.
- Which stage failed.
- Whether the run can be resumed.
- Where internal logs are stored.
- Which command to run next, such as `inspector status <run-dir>` or
  `inspector resume <run-dir>`.

Stack traces remain hidden unless `--debug` is enabled.

### Debug/raw log behavior

Raw Codex stdout and stderr are saved to internal logs but summarized in the
terminal by default.

`--debug` can reveal more detail, including structured diagnostic information,
runner command metadata, and selected stderr excerpts when useful. Debug mode
must still avoid dumping secrets or full raw transcripts indiscriminately.

`--show-raw-agent-output` may be added later as a separate explicit flag. It is
not required for the initial interactive release and should not be enabled by
default.

## Runtime Event Model

The application runtime emits structured inspection events. The TUI, CLI text
logger, tests, and future status views consume those events instead of coupling
to agent runner internals.

Each event should include:

- `type`: stable event type.
- `runId`: current run identifier.
- `timestamp`: ISO timestamp from the clock port.
- `severity`: `debug`, `info`, `warn`, or `error`.
- `message`: concise human-readable summary.
- `data`: typed event-specific payload.

Initial event types:

- `run.configured`: effective repository, output, storage, runner, and safety
  choices have been accepted.
- `run.started`: run workspace exists and inspection has started.
- `run.activity`: current high-level activity changed.
- `repository.indexing_started`: repository indexing started.
- `repository.indexing_completed`: repository indexing completed with summary
  counts.
- `quality_commands.skipped`: quality commands are disabled.
- `quality_commands.started`: trusted quality command execution started.
- `quality_commands.completed`: quality command report is available.
- `agent.queued`: an agent is waiting on dependencies.
- `agent.started`: an agent attempt started.
- `agent.output_received`: raw output was captured in internal storage.
- `agent.schema_validated`: schema validation passed or failed.
- `agent.evidence_validated`: evidence validation passed or failed.
- `agent.qa_reviewed`: QA result is available for an agent's findings.
- `agent.retry_requested`: QA or validation routed a retry to an owner agent.
- `agent.completed`: an agent reached an approved or terminal completed state.
- `agent.failed`: an agent reached a terminal failed state.
- `qa.started`: final QA verification started.
- `qa.completed`: final QA readiness and issue summary is available.
- `outputs.public_docs_written`: public docs were written.
- `outputs.internal_artifacts_written`: internal artifacts were written.
- `run.completed`: run finished successfully.
- `run.failed`: run failed with a resumable or non-resumable reason.

Event payloads should use repository-relative paths for repository evidence and
separate public output paths from internal artifact paths. Raw stdout, stderr,
prompts, and transcripts are referenced by internal log path, not embedded in
events.

## Safety Model

### Codex runner safety

The fake runner remains available for dry runs and tests.

The Codex process runner must be explicit and safety-aware. Interactive setup
must require the user to select or confirm Codex before any real Codex process
is invoked. The confirmation must identify:

- The local command that will be invoked at a high level.
- The inspected repository path.
- The internal log directory.
- Whether the mode is read-only or may modify files.
- Whether the mode uses YOLO/full-auto behavior.

The application still talks to runners through the `AgentRunner` port. Codex is
an adapter, not the workflow core.

### YOLO/full-auto confirmation

Real Codex YOLO/full-auto behavior must require clear user consent. It is not
enabled by selecting the Codex runner alone.

The confirmation must be separate from the general run confirmation and should
use plain language such as "Codex may run commands or modify files in the
inspected repository." The exact UI can be designed during implementation, but
the release behavior must make accidental consent unlikely.

### Quality command opt-in

Quality commands remain disabled unless explicitly trusted.

Interactive `npx codebase-inspector` must ask whether trusted quality commands may
execute. The default answer is no. If enabled, the existing validation command
policy still applies: only known safe test, typecheck, lint, build, and related
commands may run, shell syntax remains blocked, and blocked commands are
reported without execution.

### Output directory containment

The public docs directory defaults inside the inspected repository at
`./docs/inspector`. The runtime must continue to prevent repository indexing
and evidence validation from treating Inspector-generated output directories or
run workspaces as source evidence.

If the user chooses a public docs directory inside the repository, generated
Inspector docs must be excluded from subsequent repository indexing for that
run. If the user chooses a path outside the repository, the confirmation screen
must make that explicit.

Internal run data should default outside the repository in the OS user data
directory. If the user overrides internal storage to a repository-contained
path, the path must be excluded from indexing and must still be treated as
private operational data.

## Storage Model

### User data directory behavior by OS

Interactive `npx codebase-inspector` stores internal run data under an Inspector-specific
directory in the OS user data location by default:

- macOS: `~/Library/Application Support/inspector`
- Linux: `$XDG_DATA_HOME/inspector` when `XDG_DATA_HOME` is set, otherwise
  `~/.local/share/inspector`
- Windows: `%APPDATA%\\inspector`

The implementation should resolve these through a filesystem or environment
adapter so application services do not depend on Node OS APIs.

### Run workspace layout

Each run gets a unique workspace under the internal data directory:

```text
<user-data>/runs/<timestamp>_<repo-name>/
  config.json
  repo_index/
  agents/
    <agent-id>/
      attempt-<n>/
        prompt.md
        raw_stdout.log
        raw_stderr.log
        output.json
        status.json
        validation.json
        evidence.json
  validation/
    command_report.json
  qa/
    results.json
    issues.json
    revision_requests.json
    readiness.json
  memory/
  final/
    rag_cards/
  logs/
```

Public docs are written separately to the configured public docs directory:

```text
<repo>/docs/inspector/
```

The exact internal filenames may evolve with existing adapters, but the
separation between public docs and internal run data is required.

### Last-run pointer

The internal user data directory should maintain a last-run pointer for
interactive convenience:

```text
<user-data>/last-run.json
```

The pointer should contain the last run id, internal run directory, inspected
repository path, public docs directory, start time, completion time when known,
and terminal status. It must not contain raw prompts, raw outputs, secrets, or
transcripts.

Future interactive screens may use this pointer to offer status or resume
shortcuts.

## Acceptance Tests

Implementation should add tests that verify:

- `npx codebase-inspector` with no subcommand enters the interactive path.
- The interactive defaults are repository `.`, public docs `./docs/inspector`,
  internal storage under the OS user data directory, fake runner, quality
  commands disabled, and raw output hidden.
- Interactive configuration is passed into application use cases through ports
  rather than executed directly by Ink components.
- TUI components consume structured inspection events and do not call agent
  runners directly.
- The application runtime emits structured events for run, repository,
  quality-command, agent, QA, output, and failure lifecycle changes.
- `inspector run` remains non-interactive and scriptable.
- `inspector status <run-dir>` can summarize runs from persisted internal
  lifecycle artifacts.
- `inspector resume <run-dir>` continues from internal run workspaces without
  rerunning completed or approved agents.
- Public docs are written to `./docs/inspector` by default.
- Internal prompts, raw outputs, status JSON, schema validation JSON, evidence
  validation JSON, QA JSON, and RAG card streams are written to user data by
  default.
- Raw Codex stdout and stderr are saved to logs but summarized in terminal
  output.
- `--debug` reveals additional diagnostics without dumping full raw output by
  default.
- A future `--show-raw-agent-output` flag can be added without changing the
  default privacy model.
- Real Codex runner selection requires explicit user consent.
- YOLO/full-auto mode requires a separate clear confirmation.
- Quality commands do not execute unless explicitly trusted.
- Public docs and internal run data directories are excluded from repository
  indexing and evidence selection.

## Migration Plan

1. Add an application-level structured inspection event port and adapt the
   existing CLI logger to consume it.
2. Split public docs output configuration from internal run workspace storage
   in application-facing configuration.
3. Add a user data directory adapter with OS-specific defaults.
4. Add tests for the interactive configuration flow using fake prompts or a
   test renderer; keep application orchestration outside Ink components.
5. Add the interactive `npx codebase-inspector` adapter with the fake runner and quality
   commands disabled by default.
6. Add Codex runner selection and explicit safety confirmations.
7. Add curated TUI lifecycle rendering from structured events.
8. Add last-run pointer writing and status/resume convenience hooks.
9. Add `inspector doctor` after the core interactive path is stable.

Each step should preserve the existing scriptable `inspector run` behavior and
pass the repository validation gate.

## Open Questions

- Should the interactive runner default remain fake for the first public
  release, or should the prompt recommend Codex while still requiring explicit
  selection?
- Should public docs include only final Markdown, or should a sanitized export
  command later publish selected RAG cards?
- What exact wording should be used for Codex YOLO/full-auto confirmation?
- Should `inspector doctor` be implemented before or after the first Ink TUI
  release?
- Should last-run pointers be global only, or should Inspector also maintain a
  per-repository recent-run index under user data?
