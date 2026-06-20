# RAG Cards

RAG cards are compact JSON knowledge records for future coding agents. They are
generated from QA-approved findings only and preserve evidence back to repository
files and finding ids.

## Streams

Cards are written under `final/rag_cards/`:

- `patterns.jsonl`: reusable implementation patterns.
- `flows.jsonl`: verified feature or execution flows.
- `decisions.jsonl`: evidence-backed decisions and recommendations.
- `warnings.jsonl`: risks, weak decisions, safety concerns, and adaptation
  warnings.

Each line is one JSON object validated against `schemas/knowledge-card.schema.json`.
Empty streams are written as empty files.

## Card Fields

Generated cards include:

- `id`: `rag-card-<finding-id>`
- `topic`: finding claim
- `summary`: finding recommendation
- `sourceRepo`: inspected repository name
- `confidence`: finding confidence
- `evidence`: cited repository file and line ranges, with finding references
- `tags`: finding tags or the owning agent id
- `audience`: default `coding-agent`
- optional use, avoidance, risk, and adaptation notes
- `createdAt`: generation timestamp

## Classification

The writer uses explicit `cardType` when a finding provides one. Otherwise:

- Pattern Miner findings go to `patterns.jsonl`.
- Flow Tracer findings go to `flows.jsonl`.
- Medium, high, and critical severity findings go to `warnings.jsonl`.
- Other findings go to `decisions.jsonl`.

Rejected findings are excluded. Evidence must already have passed repository
path, line-range, and cross-artifact checks before a card can be written.

## Intended Use

Use RAG cards as retrieval material for future code agents that need concise,
evidence-linked project knowledge. They are not a substitute for reading the
source files they cite, and they should not contain private prompts, transcripts,
or secrets.
