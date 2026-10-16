import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {
  runWorkflow,
  decodeCheckpoint,
  jsonCopy,
  type Task,
  type CheckpointStore,
  type Checkpoint,
} from "./engine.js";
import { MemoryCheckpointStore, IndexedDBCheckpointStore } from "./stores.js";
const task = (
  id: string,
  dependsOn: string[] = [],
  run: Task["run"] = async () => id,
): Task => ({ id, dependsOn, run });
const options = (store: CheckpointStore) => ({
  store,
  runId: "test-run",
  version: "test-1",
});

test("complete run reopens without repeating effects", async () => {
  const store = new MemoryCheckpointStore();
  let count = 0;
  const tasks = [task("a", [], async () => ++count)];
  const first = await runWorkflow(tasks, options(store));
  const second = await runWorkflow(tasks, options(store));
  assert.deepEqual(first, second);
  assert.equal(count, 1);
});
test("explicit recovery retains completed outputs and retries failed descendants", async () => {
  const store = new MemoryCheckpointStore();
  let count = 0,
    fail = true;
  const tasks = [
    task("a", [], async () => {
      count++;
      return { answer: 42 };
    }),
    task("b", ["a"], async ({ results }) => {
      if (fail) throw Error("offline");
      return results.get("a");
    }),
    task("c", ["b"]),
  ];
  await runWorkflow(tasks, options(store));
  await assert.rejects(runWorkflow(tasks, options(store)), /explicit recovery/);
  fail = false;
  const recovered = await runWorkflow(tasks, {
    ...options(store),
    recovery: "retry-incomplete",
  });
  assert.equal(count, 1);
  assert.equal(recovered.states.c, "completed");
  assert.deepEqual(recovered.values.b, { answer: 42 });
  assert.deepEqual(
    recovered.events.map((e) => e.sequence),
    recovered.events.map((_, i) => i + 1),
  );
  assert.equal(
    recovered.events
      .filter((e) => e.type === "started" && e.taskId === "b")
      .at(-1)?.attempt,
    2,
  );
});
test("failure to persist start prevents the effect", async () => {
  let count = 0;
  const base = new MemoryCheckpointStore();
  const store: CheckpointStore = {
    load: (id) => base.load(id),
    save: async (c, r) => {
      if (c.events.length) throw Error("disk full");
      await base.save(c, r);
    },
  };
  await assert.rejects(
    runWorkflow([task("a", [], async () => ++count)], options(store)),
    /Checkpoint write failed/,
  );
  assert.equal(count, 0);
});
test("crash window after effect requires acknowledgement and keeps stable idempotency key", async () => {
  const base = new MemoryCheckpointStore();
  const keys: string[] = [];
  const store: CheckpointStore = {
    load: (id) => base.load(id),
    save: async (c, r) => {
      if (c.events.some((e) => e.type === "completed"))
        throw Error("lost write");
      await base.save(c, r);
    },
  };
  const tasks = [
    task("a", [], async ({ idempotencyKey }) => {
      keys.push(idempotencyKey);
      return 42;
    }),
  ];
  await assert.rejects(
    runWorkflow(tasks, options(store)),
    /Checkpoint write failed/,
  );
  assert.equal(
    decodeCheckpoint(await base.load("test-run")).states.a,
    "running",
  );
  await assert.rejects(runWorkflow(tasks, options(base)), /explicit recovery/);
  await runWorkflow(tasks, { ...options(base), recovery: "retry-incomplete" });
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
});
test("parallel checkpoint transitions serialize and persist before subscribers", async () => {
  const store = new MemoryCheckpointStore();
  let revision = -1;
  const delayed: CheckpointStore = {
    load: (id) => store.load(id),
    save: async (c, r) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      assert.equal(r, revision < 0 ? null : revision);
      await store.save(c, r);
      revision = c.revision;
    },
  };
  const result = await runWorkflow(
    Array.from({ length: 8 }, (_, i) => task("t" + i)),
    { ...options(delayed), concurrency: 4 },
  );
  const saved = decodeCheckpoint(await store.load("test-run"));
  assert.deepEqual(saved.events, result.events);
  assert.equal(saved.events.length, 16);
});
test("compare-and-swap prevents competing owners from invoking same task", async () => {
  const store = new MemoryCheckpointStore();
  let count = 0;
  const tasks = [
    task("a", [], async () => {
      count++;
      await new Promise((r) => setTimeout(r, 5));
      return 1;
    }),
  ];
  const results = await Promise.allSettled([
    runWorkflow(tasks, options(store)),
    runWorkflow(tasks, options(store)),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(count, 1);
});
test("definition version, DAG and task policies must match before recovery", async () => {
  const store = new MemoryCheckpointStore();
  await runWorkflow([task("a")], options(store));
  await assert.rejects(
    runWorkflow([task("a")], { ...options(store), version: "changed" }),
    /definition/,
  );
  await assert.rejects(
    runWorkflow([{ ...task("a"), retries: 1 }], options(store)),
    /definition/,
  );
});
test("malformed checkpoints reject rather than silently discard", () => {
  for (const input of [
    null,
    {},
    { schema: 2 },
    { schema: 1, runId: "x", revision: -1 },
  ])
    assert.throws(() => decodeCheckpoint(input), /Invalid/);
});
test("tampered states, values, sequences and attempts reject", async () => {
  const store = new MemoryCheckpointStore();
  await runWorkflow([task("a")], options(store));
  const valid = (await store.load("test-run")) as Checkpoint;
  const mutations = [
    { ...valid, states: { a: "bogus" } },
    { ...valid, values: {} },
    { ...valid, attempts: { a: 0 } },
    { ...valid, events: [{ ...valid.events[0], sequence: 4 }] },
  ];
  mutations.forEach((v) => assert.throws(() => decodeCheckpoint(v), /Invalid/));
});
test("outputs are deeply immutable and dependency maps cannot corrupt shared results", async () => {
  const source = { nested: { answer: 42 } };
  const result = await runWorkflow(
    [
      task("a", [], async () => source),
      task("b", ["a"], async ({ results }) => {
        (results as Map<string, unknown>).clear();
        return true;
      }),
      task("c", ["a"], async ({ results }) => results.get("a")),
    ],
    { concurrency: 1 },
  );
  source.nested.answer = 0;
  assert.deepEqual(result.values.c, { nested: { answer: 42 } });
  assert.ok(Object.isFrozen((result.values.a as { nested: object }).nested));
});
test("unsafe JSON outputs fail the task without authorizing dependents", async () => {
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  for (const value of [
    Infinity,
    NaN,
    BigInt(2),
    new Date(),
    cycle,
    { x: undefined },
    [undefined],
  ]) {
    const result = await runWorkflow([
      task("a", [], async () => value),
      task("b", ["a"]),
    ]);
    assert.equal(result.states.a, "failed");
    assert.equal(result.states.b, "skipped");
  }
  assert.throws(() => jsonCopy(new Map()), /JSON/);
});
test("prototype-like IDs are safe and dependency results are scoped", async () => {
  const result = await runWorkflow([
    task("__proto__"),
    task("constructor", ["__proto__"], async ({ results }) => [
      ...results.keys(),
    ]),
  ]);
  assert.equal(result.states.__proto__, "completed");
  assert.deepEqual(result.values.constructor, ["__proto__"]);
});
test("pre-aborted execution never starts effects", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const result = await runWorkflow(
    [task("a", [], async () => ++calls)],
    {},
    controller.signal,
  );
  assert.equal(calls, 0);
  assert.equal(result.states.a, "skipped");
});
test("uncooperative late completion never overwrites timed-out state", async () => {
  const result = await runWorkflow([
    {
      ...task("a", [], async () => {
        await new Promise((r) => setTimeout(r, 30));
        return "late";
      }),
      timeoutMs: 2,
    },
  ]);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(result.states.a, "failed");
  assert.equal(result.values.a, undefined);
});
test("invalid engine options reject before side effects", async () => {
  for (const option of [
    { defaultTimeoutMs: Infinity },
    { defaultTimeoutMs: 2147483648 },
    { retryDelayMs: -1 },
    { retryDelayMs: 60001 },
    { store: new MemoryCheckpointStore() },
  ])
    await assert.rejects(runWorkflow([task("a")], option));
  for (const t of [
    { ...task("a"), retries: -1 },
    { ...task("a"), timeoutMs: 0 },
    { ...task("a"), timeoutMs: 2147483648 },
  ])
    await assert.rejects(runWorkflow([t]));
});
for (const adapter of ["memory", "indexeddb"] as const) {
  test(
    adapter + " stores immutable checkpoints and enforces revision conflicts",
    async () => {
      const store =
        adapter === "memory"
          ? new MemoryCheckpointStore()
          : new IndexedDBCheckpointStore("test-" + crypto.randomUUID());
      await runWorkflow([task("a")], options(store));
      const saved = decodeCheckpoint(await store.load("test-run"));
      await assert.rejects(store.save(saved, null), /Concurrent/);
      assert.deepEqual(decodeCheckpoint(await store.load("test-run")), saved);
      assert.equal((await store.load("absent")) == null, true);
    },
  );
}
test("IndexedDB survives a new adapter instance", async () => {
  const name = "reload-" + crypto.randomUUID();
  await runWorkflow([task("a")], options(new IndexedDBCheckpointStore(name)));
  const saved = decodeCheckpoint(
    await new IndexedDBCheckpointStore(name).load("test-run"),
  );
  assert.equal(saved.states.a, "completed");
});
test("seeded DAGs preserve dependency order with retries and mixed failure", async () => {
  let seed = 1729;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let round = 0; round < 20; round++) {
    const tasks: Task[] = Array.from({ length: 20 }, (_, i) => ({
      id: "t" + i,
      dependsOn: Array.from({ length: i }, (_, j) => "t" + j).filter(
        () => random() < 0.12,
      ),
      retries: 1,
      run: async ({ attempt }) => {
        if ((i + round) % 7 === 0 && attempt === 1) throw Error("transient");
        return i;
      },
    }));
    const result = await runWorkflow(tasks, { concurrency: 3 });
    assert.ok(Object.values(result.states).every((s) => s === "completed"));
    for (const task of tasks)
      for (const dep of task.dependsOn ?? [])
        assert.ok(
          result.events.find((e) => e.taskId === dep && e.type === "completed")!
            .sequence <
            result.events.find(
              (e) => e.taskId === task.id && e.type === "started",
            )!.sequence,
        );
  }
});

test("states must be justified by a valid event history", async () => {
  const store = new MemoryCheckpointStore();
  await runWorkflow([task("a")], options(store));
  const saved = decodeCheckpoint(await store.load("test-run"));
  assert.throws(
    () => decodeCheckpoint({ ...saved, events: [], revision: 0 }),
    /Invalid/,
  );
  assert.throws(
    () =>
      decodeCheckpoint({
        ...saved,
        events: saved.events.map((e) => ({ ...e, type: "completed" })),
      }),
    /Invalid/,
  );
  assert.throws(() => decodeCheckpoint({ ...saved, revision: 100 }), /Invalid/);
});

test("execution owns its definition before awaiting storage", async () => {
  const base = new MemoryCheckpointStore();
  let loaded!: () => void;
  const gate = new Promise<void>((resolve) => {
    loaded = resolve;
  });
  const store: CheckpointStore = {
    load: async () => {
      await gate;
      return null;
    },
    save: (checkpoint, revision) => base.save(checkpoint, revision),
  };
  let originalCalls = 0;
  let replacementCalls = 0;
  const dependencies = ["a"];
  const tasks = [
    { id: "a", run: async () => ++originalCalls },
    { id: "b", dependsOn: dependencies, run: async () => ++originalCalls },
  ];
  const execution = runWorkflow(tasks, options(store));
  tasks[0].run = async () => ++replacementCalls;
  dependencies.push("missing");
  tasks.push({ id: "injected", run: async () => ++replacementCalls });
  loaded();
  const result = await execution;
  assert.equal(originalCalls, 2);
  assert.equal(replacementCalls, 0);
  assert.deepEqual(Object.keys(result.states), ["a", "b"]);
});

test("recovery rejects a valid per-task history that violates dependency order", async () => {
  const base = new MemoryCheckpointStore();
  let calls = 0;
  const tasks = [
    task("a", [], async () => ++calls),
    task("b", ["a"], async () => ++calls),
  ];
  await runWorkflow(tasks, options(base));
  const saved = decodeCheckpoint(await base.load("test-run"));
  const reordered = [
    saved.events[0],
    saved.events[2],
    saved.events[1],
    saved.events[3],
  ].map((event, i) => ({ ...event, sequence: i + 1 }));
  const store: CheckpointStore = {
    load: async () => ({ ...saved, events: reordered }),
    save: async () => {
      assert.fail("Invalid history must not be written");
    },
  };
  await assert.rejects(runWorkflow(tasks, options(store)), /dependency order/);
  assert.equal(calls, 2);
});

test("numeric task IDs and duplicate events cannot pass checkpoint decoding", async () => {
  const store = new MemoryCheckpointStore();
  await runWorkflow([task("1")], options(store));
  const saved = decodeCheckpoint(await store.load("test-run"));
  assert.throws(
    () =>
      decodeCheckpoint({
        ...saved,
        events: saved.events.map((event) => ({ ...event, taskId: 1 })),
      }),
    /Invalid/,
  );
  assert.throws(
    () =>
      decodeCheckpoint({
        ...saved,
        revision: saved.revision + 1,
        events: [...saved.events, { ...saved.events[1], sequence: 3 }],
      }),
    /Invalid/,
  );
});
