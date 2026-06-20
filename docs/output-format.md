# Output Format

Each run creates a unique workspace under the configured output directory. The
workspace name is derived from the timestamp and repository name, with a suffix
added if that directory already exists.

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
`.inspector-runs/` so self-inspection runs do not feed private run artifacts
back into prompts or final evidence.

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

## Final Docs

`final/docs/` contains a fixed ten-file Markdown package:

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
