# ADR 0003: Evidence-Driven Findings

## Status

Accepted

## Context

AI-generated inspection claims are not useful unless reviewers can trace them back to source evidence. Reports and knowledge cards also need enough metadata for future agents to reuse the information responsibly.

## Decision

Require all inspection findings to include traceable evidence and validation metadata. Evidence should include file paths, line ranges, and optional excerpts. QA results must record rationale and follow-up requirements.

## Consequences

Findings become easier to review, validate, reroute, and cite in final reports. Agents must spend more effort grounding claims, and validators must reject incomplete or unsupported outputs.
