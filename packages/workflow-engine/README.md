# Workflow engine

Strict TypeScript, dependency-aware workflow execution with explicit checkpoint recovery. No React dependency.

```bash
npm ci
npm run check
npm test
```

From the repository root: `npm ci --prefix packages/workflow-engine && npm run test:engine`.

## Example

```ts
import { runWorkflow } from "./src/engine";
import { IndexedDBCheckpointStore } from "./src/stores";

await runWorkflow(
  [
    { id: "read", run: async () => ({ amount: 42 }) },
    {
      id: "transform",
      dependsOn: ["read"],
      run: async ({ results }) => results.get("read"),
    },
  ],
  {
    runId: "example-1",
    version: "example-implementation-1",
    store: new IndexedDBCheckpointStore(),
    concurrency: 2,
  },
);
```

Tasks return finite, acyclic JSON. An undefined return is normalized to null. Outputs are owned, deeply frozen copies. Dependency result maps are task-local and contain direct dependencies only.

Writes commit before task effects. Incomplete checkpoints require explicit `recovery: 'retry-incomplete'`. Recovery retains completed steps, continues event and attempt counters and grants a fresh retry budget to incomplete steps. Bump `version` whenever task implementation semantics change.

See [architecture and limits](../../docs/architecture.md) and [verification](../../docs/verification.md). This is a browser-hosted portfolio engine: no distributed leases, hard cancellation, exactly-once effects or server durability. AI-assisted implementation is documented openly.
