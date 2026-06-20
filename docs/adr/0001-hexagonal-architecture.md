# ADR 0001: Hexagonal Architecture

## Status

Accepted

## Context

The CLI must coordinate repository indexing, agent execution, validation, memory, and report writing. These concerns depend on infrastructure such as the filesystem, processes, clocks, and AI runners.

## Decision

Use hexagonal architecture. Keep domain and application logic independent from infrastructure. Access external systems through ports and implement them with adapters.

## Consequences

The design supports deterministic tests, replaceable Codex runners, alternative validators, different memory stores, and multiple output writers. It requires discipline to keep infrastructure out of domain and application modules.
