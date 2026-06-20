# Testing Strategy

## TDD Workflow

Use TDD for implementation and validation behavior. Work in vertical slices: write one behavior test, make it pass with the smallest production-quality change, then refactor while tests remain green.

## Domain and Application Tests

Domain and application tests should verify behavior through public interfaces. They should cover agent planning, dependency-aware execution rules, evidence validation, QA rerouting decisions, and report assembly.

## Adapter Tests

Adapters should be tested with fakes or controlled fixtures. Filesystem, process execution, clock, and Codex runner behavior must sit behind ports so tests remain deterministic.

## Contract Tests

JSON Schema tests validate that example outputs match the published contracts, including external schema references. Future agent outputs should be checked against the same schemas before they are accepted into reports or memory.

## Type Checking

Domain contract interfaces in `src/domain/types.ts` should mirror the JSON Schema contracts. Run `npm run typecheck` after changing schemas or domain types.

## CLI Behavior Tests

CLI tests should exercise user-visible behavior: accepted arguments, invalid target paths, verbose streaming, output locations, and failure messages. Avoid testing internal parser details unless they are exposed behavior.

## Determinism

Tests should avoid real network calls, live AI invocations, wall-clock dependencies, and uncontrolled filesystem state. Use fixtures and adapter fakes for repeatability.
