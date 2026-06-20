# Agent Rules

## Startup Routine

Read `AGENTS.md`, then the public docs it references. Read `.agents/memory.md` if it exists locally, then inspect the repository before planning or editing.

## Memory Routine

After each meaningful planning or implementation iteration, update `.agents/memory.md` with concise notes about decisions, changed files, validation results, gaps, and next steps. Keep memory operational and local; do not treat it as public documentation.

## Milestone Routine

For each milestone, define the smallest valuable slice, write or update the relevant test first when code or validation behavior changes, implement only that slice, run validation, update docs, then commit.

## Editing Rules

Preserve user work and avoid unrelated refactors. Prefer existing project vocabulary and documented architecture. Keep public files professional and move noisy operational details to ignored local state.

## Validation Rules

Run the relevant available checks before finishing. Do not claim unavailable or failing checks passed. If a script is missing because the repository is not ready for it, state that clearly.

## Safety and Security

Do not commit secrets, `.env` files, raw prompts, transcripts, local logs, scratchpads, personal paths, or private agent state. Keep `.agents/memory.md` and `.agents/state/**` local.
