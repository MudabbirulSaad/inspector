# Output Format

Inspector separates public development docs from internal run data. By default,
public Markdown docs are written to the inspected repository:

```text
<target-repo>/docs/inspector/
  00-executive-summary.md
  01-product-context.md
  02-architecture-map.md
  03-feature-flow-traces.md
  04-pattern-catalog.md
  05-testing-strategy.md
  06-tradeoffs-and-risks.md
  07-adaptation-blueprint.md
  08-implementation-plan.md
  09-verification-report.md
```

Internal run artifacts live in a unique run workspace. The compatibility CLI
path still creates that workspace under the configured `--out` directory. The
interactive release wizard creates the same workspace shape under the OS user
data root unless the user chooses another internal data directory:

```text
Linux:   XDG_DATA_HOME/inspector or ~/.local/share/inspector
macOS:   ~/Library/Application Support/inspector
Windows: APPDATA/inspector
```

The workspace name is derived from the timestamp and repository name, with a
suffix added if that directory already exists.

```text
<output-path>/<timestamp>_<repo-name>/
  config.json
  input/
  repo_index/
  memory/
  agents/
  validation/
  qa/
  final/
```

## Repository Index

`repo_index/` contains deterministic repository inventory artifacts:

- `file_tree.txt`
- `repo_summary.json`
- `important_files.json`
- `detected_stack.json`
- `detected_commands.json`

The index ignores noisy folders and local operational state, records important
files, detects stack signals, and detects likely quality commands from
repository manifests and workflows. Ignored local state includes `.agents/` and
`.inspector-runs/`, configured output directories inside the target repository,
and generated `docs/inspector/` public output so self-inspection runs do not
feed generated Inspector artifacts back into prompts or final evidence.

## Memory

`memory/` is local operational run state:

- `blackboard.md`
- `events.jsonl`
- `findings.jsonl`
- `decisions.jsonl`
- `qa_issues.jsonl`
- `verified_findings.jsonl`
- `rejected_findings.jsonl`

Memory is append-only coordination state. It is not public product
documentation and should not contain secrets, raw transcripts, or private logs.

## Agent Attempts

Each specialist attempt writes artifacts under:

```text
agents/<agent-id>/attempt-<n>/
  prompt.md
  output.json
  status.json
```

`prompt.md` is the exact prompt assembled for that attempt. `output.json` is the
parsed structured agent output. `status.json` records lifecycle status,
attempt, transition history, and failure reasons where applicable.

## Validation

`validation/command_report.json` is always written. If quality commands are not
enabled, it records a skipped result. If enabled, it records allowed commands,
blocked commands, exit codes, stdout, stderr, durations, and statuses.

Agent validation artifacts are written under:

```text
validation/<agent-id>/attempt-<n>/
  report.json
  evidence.json
```

`report.json` records JSON parse and schema validation results. `evidence.json`
records repository path and line-range evidence validation. Evidence from
ignored local operational folders is treated as unavailable repository evidence.

## QA

`qa/` contains:

- `results.json`: QA decisions for findings.
- `issues.json`: QA issues for rejected or follow-up findings.
- `revision_requests.json`: owner-agent retry requests.
- `readiness.json`: deterministic readiness metadata.

QA artifacts preserve why a finding passed, failed, or needed revision.

## Public Docs

`<target-repo>/docs/inspector/` contains the user-facing Markdown package for
non-interactive runs. The interactive wizard can publish the same Markdown
package to a custom docs directory. Public docs are Markdown only. They do not
include raw prompts, raw runner output, schema reports, evidence JSON, QA JSON,
memory JSONL, internal RAG JSONL, or configuration secrets.

## Internal Final Docs

`final/docs/` retains the same fixed ten-file Markdown package inside the run
workspace for compatibility with status, resume, and artifact inspection:

- `00-executive-summary.md`
- `01-product-context.md`
- `02-architecture-map.md`
- `03-feature-flow-traces.md`
- `04-pattern-catalog.md`
- `05-testing-strategy.md`
- `06-tradeoffs-and-risks.md`
- `07-adaptation-blueprint.md`
- `08-implementation-plan.md`
- `09-verification-report.md`

Final docs use QA-approved findings only. Unsupported sections say there is not
enough verified evidence.

## RAG Cards

`final/rag_cards/` contains JSONL streams:

- `patterns.jsonl`
- `flows.jsonl`
- `decisions.jsonl`
- `warnings.jsonl`

See [RAG cards](rag-cards.md) for card semantics.
