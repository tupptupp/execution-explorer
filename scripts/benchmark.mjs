import { performance } from "node:perf_hooks";
import { cpus, platform, arch } from "node:os";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { runWorkflow } = require("../packages/workflow-engine/dist/engine.js");
const {
  MemoryCheckpointStore,
} = require("../packages/workflow-engine/dist/stores.js");
const results = [];
for (const size of [6, 50, 200])
  for (const persistent of [false, true]) {
    const samples = [];
    for (let sample = 0; sample < 12; sample++) {
      const tasks = Array.from({ length: size }, (_, i) => ({
        id: "t" + i,
        dependsOn: i ? ["t" + (i - 1)] : [],
        run: async () => ({ ok: true }),
      }));
      const start = performance.now();
      await runWorkflow(tasks, {
        concurrency: 2,
        ...(persistent
          ? { runId: "bench", store: new MemoryCheckpointStore() }
          : {}),
      });
      if (sample >= 2) samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    results.push({
      tasks: size,
      store: persistent ? "memory (full checkpoint serialization)" : "none",
      samples: samples.length,
      p50Ms: +samples[Math.ceil(samples.length * 0.5) - 1].toFixed(3),
      p95Ms: +samples[Math.ceil(samples.length * 0.95) - 1].toFixed(3),
    });
  }
console.log(
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      runtime: process.version,
      platform: platform() + " " + arch(),
      cpu: cpus()[0]?.model,
      method:
        "Serial no-I/O chain; 2 warmups + 10 measured samples per case. Single process; no service latency. Memory adapter is not an IndexedDB or production durability benchmark.",
      results,
    },
    null,
    2,
  ),
);
