# Development notes and provenance

## Scope of this revision

Continued from `feature/workflow-engine` and Draft PR #1. The initial branch contained a standalone in-memory runner and 14 tests. The original dashboard displayed synthetic historical records and was not connected to the engine.

The implementation now connects the console to real browser execution, adds validated atomic checkpoints and explicit recovery, and replaces the development console's presentation with an original SVG/CSS graph. Work is confined to this public repository and development branch. No private Formodo repository was read or modified. No production alias or main branch is changed as part of this revision.

## Iteration evidence

- Retained the original engine behavior tests while replacing compressed implementation with formatted, documented TypeScript.
- Added persistence, ownership conflict, storage failure, crash-window, invalid-output, malicious-key and checkpoint corruption tests.
- Added deterministic seeded DAG cases to exercise dependency ordering across many shapes.
- Browser tests exercise actual IndexedDB and reload/stop/recover flows, not mocked React state.
- The first browser accessibility pass found that overflowing JSON output was not keyboard-focusable on desktop. Added a labeled focusable output region and reran the tests.
- Reviewed full-checkpoint serialization cost with a reproducible benchmark; documented its scaling limitation instead of concealing it.

## AI assistance

Martin Carlsson supplied the project direction, portfolio objectives and constraints. An OpenAI coding assistant inspected the repository, authored and revised code/tests/docs, executed checks and used GitHub tools to prepare the development PR. The assistant's capabilities are not attributed as unaided personal expertise. The owner should be ready to explain the architecture, limitations and test evidence in a review or interview.

## Release boundary

CI and a Vercel branch preview can be created from this PR without changing the production demo. Merging into main, promoting the preview to production, changing production domains or deleting deployments require a separate explicit release decision. A passing test suite is scoped evidence, not a security audit or a guarantee of distributed execution semantics.
