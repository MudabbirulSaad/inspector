# ADR 0002: Agent Orchestration Workflow

## Status

Accepted

## Context

Inspection work benefits from specialist agents, but uncontrolled execution can create duplicated work, unverifiable claims, and unclear ownership for failed QA.

## Decision

Orchestrate agents through planning, dependency-aware execution, validation, retry or reroute, and final writing stages. Each agent should have an explicit responsibility and produce structured outputs.

## Consequences

The workflow can run independent tasks in parallel while preserving accountability. Failed QA findings can be routed back to the responsible agent with clear correction requirements. The orchestration layer must track dependencies, ownership, and output status.
