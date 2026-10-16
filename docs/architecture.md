# Architecture and execution semantics

Execution Explorer is a browser-hosted, single-owner workflow interpreter and an inspectable React console. The workflow runs real TypeScript callbacks against **simulated** services. It is not an observability skin over hard-coded execution records, a distributed job system, or a backend service.

## Modules

| Module                                   | Responsibility                                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `packages/workflow-engine/src/engine.ts` | DAG validation, scheduling, bounded retries, timeout/abort, checkpoint validation, explicit recovery |
| `packages/workflow-engine/src/stores.ts` | Revision-checked memory and IndexedDB checkpoint adapters                                            |
| `src/workflow.ts`                        | Demo DAG, abort-aware simulated tasks, event projection                                              |
| `src/useExecution.ts`                    | Browser ownership, storage lifecycle, React subscription, run/cancel/recover commands                |
| `src/WorkflowGraph.tsx`                  | Native button nodes with SVG dependency edges and responsive zoom                                    |
| `src/main.tsx`                           | Scenario controls, inspector, event replay and JSON trace export                                     |

The engine has no React dependency. It can be tested in Node. Browser APIs live behind `CheckpointStore` or in the React integration.

## A committed transition precedes an effect

1. Copy task definitions, dependency arrays and option values before the first await; validate the DAG, options, definition version and any stored checkpoint. Callback closures and storage adapters remain caller-owned resources.
2. Acquire exclusive console ownership with Web Locks in the browser integration.
3. Persist the initial state with revision zero and a compare-and-swap check against absence.
4. For a ready task, persist `started` and its next attempt number **before invoking the callback**.
5. Pass a task-specific map of deeply frozen direct-dependency outputs and a stable run/task idempotency key.
6. Race the callback against timeout or abort. Commit the terminal event and JSON output, or commit a retry event before backing off.
7. Notify diagnostic subscribers only after the write succeeds. Subscriber exceptions are isolated.

All transitions share one promise queue. A failed write poisons that queue, aborts cooperative work and rejects the run. It cannot become a business-task retry. Other in-flight work is settled before the runner exits. Completed outputs are copied into owned JSON, so a task cannot mutate a sibling's map or a saved nested value.

## Storage model

A versioned checkpoint contains run identity, definition identity, revision, task states, cumulative attempt counts, completed outputs and the ordered event journal. The definition identity includes the explicit caller-controlled implementation version, ordered task IDs, dependency arrays, retry limits and effective timeouts. A caller **must bump the version when callback semantics change**; functions are not serialized or hashed.

`save(checkpoint, expectedRevision)` must compare and replace atomically. IndexedDB does this in one read/write transaction, including across tabs. The memory adapter exercises the same contract in Node tests. The console also uses Web Locks so two tabs cannot intentionally run the console simultaneously. CAS detects stale writers; it is not a distributed lease or an authorization boundary.

On load, schema checks and event-state replay reject malformed records, invalid transitions, revision/sequence gaps, mismatched outputs, changed definitions and task starts that precede their dependencies’ completion. No silent reset is performed. Browser data is local and untrusted; these checks detect structural inconsistency, **not maliciously rewritten consistent history**.

The current session pointer uses localStorage; the actual execution is in IndexedDB. Storage failures are reported explicitly. There is no server copy or cross-device sync. Old runs remain in IndexedDB; only the current session is exposed. Long-term retention/history management is intentionally outside this demo's scope.

## Recovery and the crash window

A fully completed checkpoint reopens without invoking callbacks again. Any incomplete checkpoint requires `recovery: 'retry-incomplete'`. The UI requires acknowledgement first. Recovery retains completed outputs and resets only incomplete steps; cumulative attempt numbers and event sequence continue. Manual recovery grants a fresh bounded retry budget for each incomplete task, so an operator can intentionally try again after repairing a service. The outage demo repairs its simulated service on recovery.

There is an unavoidable window between an external effect and its completion checkpoint. If the browser closes there, the saved state says `running` even if the effect succeeded. Recovery can repeat the effect. A stable idempotency key is supplied, but the **external service** must enforce deduplication. Exactly-once effects are not promised.

## Scheduling and cancellation

DAG validation uses iterative Kahn traversal: O(V + E), without recursive stack growth. The scheduler scans tasks to find readiness and propagate failure, so the current implementation can approach O(V² + E) over a serial chain. A retrying task occupies a scheduled slot during backoff. Concurrent scheduled tasks never exceed the configured limit.

Timeouts and stop requests are cooperative. JavaScript cannot terminate an arbitrary Promise or undo a network request. A timed-out callback can continue in the background and produce external effects; a retry can overlap that underlying work. The limit bounds **scheduled tasks**, not physical external operations. Late callbacks cannot overwrite committed runner state. CPU-blocking code also blocks the event loop and its timers. Worker/process isolation and server-enforced operation leases would be required for stronger limits.

## Presentation and accessibility

The graph is SVG/CSS with native button nodes. Motion follows active edges; it does not run a permanent render loop. A ResizeObserver fits the desktop graph. Desktop users can zoom and inspect nodes in a keyboard-focusable graph region. Mobile uses a separate clickable stage list with dependency labels; the wide graph and zoom controls are hidden. A tabular journal provides the same task/event information. State names supplement colors; focus rings, a skip link, labeled controls and a focusable output region support keyboard use. Reduced-motion preference removes animated flow and transitions.

The visual direction uses restrained depth, precise typography, spatial hierarchy and purposeful movement. All graph geometry, styling and motion are original code. No Lusion code, assets, screenshots or fonts were copied. Lucide icons retain their package license. System fonts avoid third-party font requests.

## Deliberate limits and next steps

- Full checkpoints copy the journal and outputs on each transition. This is simple and atomic for the six-node demo but has quadratic cumulative serialization cost. Measured larger cases expose that cost; see the verification report. Append-only events plus transactional incremental state would be the next scaling step.
- There are no credentials, live integrations, authentication, real payments, background execution, server durability, cron triggers or distributed workers.
- No automatic replay of interrupted work, remote import of arbitrary checkpoints, or execution of user-supplied code.
- Browser storage may be evicted or cleared. IndexedDB transaction completion is not a guarantee against OS/device power loss. External effects and storage cannot form one atomic transaction.
- The graph layout is purpose-built for the demo DAG, not an arbitrary graph editor. Engine tests cover other DAG shapes independently.
- A production system needs server storage, retention limits, backpressure, task isolation, verified idempotency and an explicit operational/security model.
