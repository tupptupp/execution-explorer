# Workflow Engine — phase 1

A dependency-aware, bounded-concurrency **in-memory** workflow runner in strict TypeScript. Standalone research prototype; not yet connected to the dashboard.

### Supports
- DAG validation (cycles, unknown and duplicated dependencies)
- Stable scheduling order, bounded *scheduled* parallelism
- Retry policy, exponential backoff, per-task timeouts, cooperative cancellation
- Task results passed to downstream steps
- Immutable monotonic events and injectable clock
- Automated tests for success, failure, retry, timeout, abort, concurrency and a deep graph

### Local checks
```bash
cd packages/workflow-engine
npm install
npm run check
npm test
```

### Boundaries
**Not a durable execution engine.** No database, process isolation, leases, checkpointing or exactly-once effects. JavaScript cannot forcibly stop an uncooperative asynchronous task: abort requests are cooperative. Timed-out underlying work may still perform effects, so the concurrency limit is a limit on *scheduled* tasks.

This code is a standalone AI-assisted portfolio prototype. No private application code or credentials are used.
