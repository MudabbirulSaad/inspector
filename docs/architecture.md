# Architecture

## Overview

`inspector` will use hexagonal architecture to keep inspection behavior independent from infrastructure. The core system should be testable without the real filesystem, process execution, network access, or a live Codex CLI.

## Domain Layer

The domain layer owns stable concepts:

- Repository inventory and evidence locations.
- Inspection agents and responsibilities.
- Findings, severities, confidence, and recommendations.
- QA results and reroute decisions.
- Memory events, knowledge cards, and inspection reports.

Domain code should not import Node APIs or call external processes.

## Application Layer

The application layer coordinates use cases:

- Index a target repository.
- Plan specialist agent work.
- Execute agents when dependencies allow.
- Validate findings and QA results.
- Reroute failed QA findings.
- Write case studies and knowledge cards.

Application services depend on ports, not concrete adapters.

## Adapters

Adapters will provide CLI parsing, filesystem access, process execution, Codex runner integration, memory storage, schema validation, logging, and Markdown/JSON writers.

## Ports to Define Later

Expected ports include `RepositoryReader`, `ProcessRunner`, `CodexRunner`, `Clock`, `Logger`, `MemoryStore`, `FindingValidator`, `QaValidator`, `KnowledgeCardWriter`, and `InspectionReportWriter`.

## Testability and Extensibility

Ports make deterministic tests possible because filesystem, process, clock, and Codex behavior can be replaced with fakes. The same boundary also allows new Codex runners, validators, writers, and memory stores without rewriting domain or application logic.
