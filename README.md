# Execution Explorer

**Every step. Nothing hidden.**

An independent design-engineering portfolio project by **Martin Carlsson**: a working TypeScript workflow engine and an interactive React console for seeing how tasks execute, fail, retry and recover.

[Development PR #1](https://github.com/tupptupp/execution-explorer/pull/1) · [Architecture](docs/architecture.md) · [Verification](docs/verification.md) · [Original demo](https://execution-explorer-sigma.vercel.app)

> Development is isolated on `feature/workflow-engine`. The original production demo remains on `main`. This console runs real workflow callbacks against simulated services, entirely in the browser. It has no backend and contains no real customer data.

## Inspect a working system

1. Run **Transient failure**. Watch two parallel branches diverge; enrichment fails once, backs off, and then unlocks the dependency barrier.
2. Select a node to inspect its attempts, timing, service and persisted JSON result.
3. Scrub the event replay to reconstruct the graph at an earlier event. Export the ordered trace as JSON.
4. Run **Service outage**. The record write exhausts its retry budget; its dependent is skipped.
5. Acknowledge recovery. Completed steps remain untouched; the simulated outage is resolved and incomplete steps resume with continuing attempt numbers.
6. Reload during a run or stop it deliberately. Saved incomplete progress requires explicit recovery.

## Engineering decisions

- Strict TypeScript engine, independent of React; validated DAGs and bounded scheduled concurrency.
- Atomic IndexedDB checkpoints before effects; revision compare-and-swap and browser tab ownership.
- Schema-validated recovery with event/state consistency checks and caller-versioned definitions.
- Abort-aware demo tasks, bounded exponential backoff, timeout handling and dependency failure propagation.
- Deeply immutable JSON outputs and task-local dependency maps.
- Native interactive graph nodes, responsive zoom, event replay, keyboard navigation and reduced motion.
- Automated engine, browser, interruption, multi-tab and accessibility tests; CI on Node 22 and 24.

## Run locally

Requires Node 22 or 24 and npm. No API keys, database service or environment secrets are needed.

```bash
npm ci
npm ci --prefix packages/workflow-engine
npm run dev
```

```bash
npm run check             # production build, engine typecheck and engine tests
npx playwright install chromium
npm run test:e2e          # desktop + mobile Chromium, including axe checks
npm run format:check
npm run benchmark         # reproducible local no-I/O microbenchmark
```

`npm run preview` serves the production build. HTTPS or localhost is required for browser ownership APIs. Mobile tests emulate a mobile viewport in Chromium; they do not certify Safari or real-device compatibility.

## What this does and does not promise

Task starts are saved before invocation. A crash **after an external effect but before its completion write** can still cause that effect to repeat during recovery. Idempotency keys help an external service deduplicate; they do not guarantee exactly-once delivery. Cancellation is cooperative, and browser storage can be cleared or evicted.

Full checkpoints deliberately favor inspectability over large-scale throughput. The report includes measured serialization costs and the point at which this approach becomes expensive. This is not a production distributed workflow platform. See [the complete semantics and limits](docs/architecture.md).

## Authorship and AI assistance

Concept, product direction and visual review: **Martin Carlsson**. Implementation, test development, debugging and documentation are **AI-assisted**. Test and benchmark claims are tied to reproducible commands and recorded outcomes; generated code is not presented as evidence of prior employment or unaided expertise. See [development notes](docs/development.md).

All graph visuals and CSS are original. No proprietary code, customer data or assets from Formodo or Lusion are used. Icons: [Lucide](https://lucide.dev/license), ISC license. React, TypeScript, Vite, Playwright and axe retain their respective licenses.
