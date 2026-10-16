/** Single-owner DAG executor. Checkpoints precede effects; recovery is explicit. */
export type TaskState =
  "pending" | "running" | "completed" | "failed" | "skipped";
export type Json =
  null | boolean | number | string | Json[] | { readonly [key: string]: Json };
export interface TaskContext {
  readonly signal: AbortSignal;
  readonly attempt: number;
  /** Stable across manual recovery. The external service must enforce deduplication. */
  readonly idempotencyKey: string;
  readonly results: ReadonlyMap<string, Json>;
}
export interface Task {
  readonly id: string;
  readonly dependsOn?: readonly string[];
  readonly retries?: number;
  readonly timeoutMs?: number;
  readonly run: (context: TaskContext) => Promise<unknown>;
}
export type EventType =
  "started" | "completed" | "failed" | "retrying" | "skipped" | "recovered";
export type WorkflowEvent = Readonly<{
  sequence: number;
  taskId: string;
  type: EventType;
  attempt: number;
  timestamp: number;
  detail?: string;
}>;
export interface Checkpoint {
  readonly schema: 1;
  readonly runId: string;
  readonly definition: string;
  readonly revision: number;
  readonly states: Readonly<Record<string, TaskState>>;
  readonly attempts: Readonly<Record<string, number>>;
  readonly values: Readonly<Record<string, Json>>;
  readonly events: readonly WorkflowEvent[];
}
/** save must atomically compare revision and replace; never overwrite a newer writer. */
export interface CheckpointStore {
  load(runId: string): Promise<unknown>;
  save(checkpoint: Checkpoint, expectedRevision: number | null): Promise<void>;
}
export interface EngineOptions {
  readonly runId?: string;
  readonly version?: string;
  readonly store?: CheckpointStore;
  readonly recovery?: "retry-incomplete";
  readonly concurrency?: number;
  readonly defaultTimeoutMs?: number;
  readonly retryDelayMs?: number;
  readonly onEvent?: (event: WorkflowEvent) => void;
  readonly now?: () => number;
}
export interface Result {
  readonly states: Readonly<Record<string, TaskState>>;
  readonly values: Readonly<Record<string, Json>>;
  readonly events: readonly WorkflowEvent[];
}
export class WorkflowValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowValidationError";
  }
}
export class RecoveryRequiredError extends Error {
  constructor() {
    super(
      "Incomplete checkpoint requires explicit recovery; interrupted effects may have occurred",
    );
    this.name = "RecoveryRequiredError";
  }
}
export class CheckpointError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CheckpointError";
  }
}
export class TaskTimeoutError extends Error {
  constructor(id: string) {
    super("Timeout: " + id);
    this.name = "TaskTimeoutError";
  }
}
const statesAllowed = new Set([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);
const eventsAllowed = new Set([
  "started",
  "completed",
  "failed",
  "retrying",
  "skipped",
  "recovered",
]);
const own = (value: object, key: string) => Object.hasOwn(value, key);
const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);
const abortError = () => new Error("Workflow aborted");

/** Take an owned, deeply frozen JSON copy. Reject lossy serialization and cycles. */
export function jsonCopy(value: unknown): Json {
  const ancestors = new Set<object>();
  const visit = (v: unknown): Json => {
    if (v === null || typeof v === "string" || typeof v === "boolean") return v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v !== "object" || !v || ancestors.has(v))
      throw new TypeError("Task output must be finite, acyclic JSON");
    if (
      !Array.isArray(v) &&
      Object.getPrototypeOf(v) !== Object.prototype &&
      Object.getPrototypeOf(v) !== null
    )
      throw new TypeError("Task output must use plain JSON objects");
    ancestors.add(v);
    const result = Array.isArray(v)
      ? Array.from(v, visit)
      : Object.fromEntries(
          Object.entries(v).map(([key, entry]) => [key, visit(entry)]),
        );
    ancestors.delete(v);
    return Object.freeze(result) as Json;
  };
  return visit(value);
}

export function validateWorkflow(
  tasks: readonly Task[],
  concurrency = 2,
): void {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1)
    throw new WorkflowValidationError("concurrency must be a positive integer");
  const byId = new Map<string, Task>();
  for (const task of tasks) {
    if (typeof task.id !== "string" || !task.id.trim() || byId.has(task.id))
      throw new WorkflowValidationError(
        "Invalid or duplicate task ID: " + task.id,
      );
    if (typeof task.run !== "function")
      throw new WorkflowValidationError("Missing run callback: " + task.id);
    if (
      task.retries !== undefined &&
      (!Number.isSafeInteger(task.retries) ||
        task.retries < 0 ||
        task.retries > 100)
    )
      throw new WorkflowValidationError("Invalid retries: " + task.id);
    if (
      task.timeoutMs !== undefined &&
      (!Number.isSafeInteger(task.timeoutMs) ||
        task.timeoutMs <= 0 ||
        task.timeoutMs > 2147483647)
    )
      throw new WorkflowValidationError("Invalid timeout: " + task.id);
    byId.set(task.id, task);
  }
  const dependents = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const task of tasks) {
    const deps = task.dependsOn ?? [];
    if (new Set(deps).size !== deps.length)
      throw new WorkflowValidationError("Duplicate dependency for " + task.id);
    indegree.set(task.id, deps.length);
    for (const dep of deps) {
      if (!byId.has(dep))
        throw new WorkflowValidationError(
          "Unknown dependency " + dep + " for " + task.id,
        );
      const list = dependents.get(dep) ?? [];
      list.push(task.id);
      dependents.set(dep, list);
    }
  }
  const queue = tasks.filter((t) => !indegree.get(t.id)).map((t) => t.id);
  for (let i = 0; i < queue.length; i++)
    for (const id of dependents.get(queue[i]) ?? []) {
      indegree.set(id, indegree.get(id)! - 1);
      if (!indegree.get(id)) queue.push(id);
    }
  if (queue.length !== tasks.length)
    throw new WorkflowValidationError("Dependency cycle");
}
function definitionKey(
  tasks: readonly Task[],
  version: string,
  timeout: number,
): string {
  return JSON.stringify([
    version,
    tasks.map((t) => [
      t.id,
      t.dependsOn ?? [],
      t.retries ?? 0,
      t.timeoutMs ?? timeout,
    ]),
  ]);
}
/** Validate persisted data before it can authorize skipping any task. */
export function decodeCheckpoint(input: unknown): Checkpoint {
  try {
    const data = jsonCopy(input) as unknown as Checkpoint;
    if (
      !data ||
      data.schema !== 1 ||
      typeof data.runId !== "string" ||
      !data.runId ||
      typeof data.definition !== "string" ||
      !Number.isSafeInteger(data.revision) ||
      data.revision < 0 ||
      !data.states ||
      typeof data.states !== "object" ||
      !data.attempts ||
      typeof data.attempts !== "object" ||
      !data.values ||
      typeof data.values !== "object" ||
      !Array.isArray(data.events)
    )
      throw Error();
    const keys = Object.keys(data.states);
    if (
      Array.isArray(data.states) ||
      Array.isArray(data.values) ||
      Array.isArray(data.attempts) ||
      keys.length !== Object.keys(data.attempts).length
    )
      throw Error();
    for (const id of keys) {
      if (
        !statesAllowed.has(data.states[id]) ||
        !own(data.attempts, id) ||
        !Number.isSafeInteger(data.attempts[id]) ||
        data.attempts[id] < 0
      )
        throw Error();
      if ((data.states[id] === "completed") !== own(data.values, id))
        throw Error();
      if (
        ["running", "completed", "failed"].includes(data.states[id]) &&
        data.attempts[id] < 1
      )
        throw Error();
    }
    if (Object.keys(data.values).some((id) => !own(data.states, id)))
      throw Error();
    if (data.revision !== data.events.length) throw Error();
    const replayStates: Record<string, TaskState> = Object.fromEntries(
      keys.map((id) => [id, "pending"]),
    );
    const replayAttempts: Record<string, number> = Object.fromEntries(
      keys.map((id) => [id, 0]),
    );
    const retrying = new Set<string>();
    for (let i = 0; i < data.events.length; i++) {
      const e = data.events[i];
      if (
        !e ||
        e.sequence !== i + 1 ||
        !own(data.states, e.taskId) ||
        !eventsAllowed.has(e.type) ||
        !Number.isSafeInteger(e.attempt) ||
        e.attempt < 0 ||
        e.attempt > data.attempts[e.taskId] ||
        !Number.isFinite(e.timestamp) ||
        (e.detail !== undefined && typeof e.detail !== "string")
      )
        throw Error();
      const state = replayStates[e.taskId];
      const attempt = replayAttempts[e.taskId];
      if (e.type === "started") {
        if (
          (state !== "pending" && !retrying.has(e.taskId)) ||
          e.attempt !== attempt + 1
        )
          throw Error();
        replayStates[e.taskId] = "running";
        replayAttempts[e.taskId] = e.attempt;
        retrying.delete(e.taskId);
      } else {
        if (e.attempt !== attempt) throw Error();
        if (e.type === "recovered") {
          if (state === "completed") throw Error();
          replayStates[e.taskId] = "pending";
          retrying.delete(e.taskId);
        } else if (e.type === "skipped") {
          if (state !== "pending") throw Error();
          replayStates[e.taskId] = "skipped";
        } else {
          if (state !== "running" || retrying.has(e.taskId)) throw Error();
          if (e.type === "retrying") retrying.add(e.taskId);
          else replayStates[e.taskId] = e.type;
        }
      }
    }
    if (
      keys.some(
        (id) =>
          replayStates[id] !== data.states[id] ||
          replayAttempts[id] !== data.attempts[id],
      )
    )
      throw Error();
    return data;
  } catch (cause) {
    throw new CheckpointError("Invalid or unsupported checkpoint", { cause });
  }
}

async function invoke(
  task: Task,
  context: Omit<TaskContext, "signal">,
  timeout: number,
  outer: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  const forward = () => controller.abort(outer.reason ?? abortError());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => {};
  const guarded = new Promise<never>((_, reject) => {
    onAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", onAbort, { once: true });
    outer.addEventListener("abort", forward, { once: true });
    timer = setTimeout(
      () => controller.abort(new TaskTimeoutError(task.id)),
      task.timeoutMs ?? timeout,
    );
    if (outer.aborted) forward();
  });
  try {
    return await Promise.race([
      guarded,
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw controller.signal.reason;
        return task.run({ ...context, signal: controller.signal });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    outer.removeEventListener("abort", forward);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
async function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError();
  if (!ms) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runWorkflow(
  tasks: readonly Task[],
  options: EngineOptions = {},
  signal?: AbortSignal,
): Promise<Result> {
  const concurrency = options.concurrency ?? 2;
  const timeout = options.defaultTimeoutMs ?? 30000;
  const retryDelay = options.retryDelayMs ?? 0;
  validateWorkflow(tasks, concurrency);
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2147483647)
    throw new WorkflowValidationError(
      "defaultTimeoutMs must be a positive timer integer",
    );
  if (!Number.isFinite(retryDelay) || retryDelay < 0 || retryDelay > 60000)
    throw new WorkflowValidationError(
      "retryDelayMs must be within 0 and 60000",
    );
  if (options.store && !options.runId?.trim())
    throw new WorkflowValidationError("Persistence requires runId");
  const runId = options.runId ?? "ephemeral";
  const definition = definitionKey(tasks, options.version ?? "1", timeout);
  const stored = await options.store?.load(runId);
  const previous = stored == null ? undefined : decodeCheckpoint(stored);
  if (
    previous &&
    (previous.runId !== runId || previous.definition !== definition)
  )
    throw new CheckpointError("Workflow definition or run ID changed");
  if (
    previous &&
    (Object.keys(previous.states).length !== tasks.length ||
      tasks.some((t) => !own(previous.states, t.id)))
  )
    throw new CheckpointError("Checkpoint task set changed");
  if (
    previous &&
    tasks.some(
      (t) =>
        previous.states[t.id] === "completed" &&
        (t.dependsOn ?? []).some((d) => previous.states[d] !== "completed"),
    )
  )
    throw new CheckpointError("Checkpoint violates dependency order");
  if (
    previous &&
    tasks.some((t) => previous.states[t.id] !== "completed") &&
    !options.recovery
  )
    throw new RecoveryRequiredError();
  const states: Record<string, TaskState> = Object.assign(
    Object.create(null),
    previous?.states ?? Object.fromEntries(tasks.map((t) => [t.id, "pending"])),
  );
  const attempts: Record<string, number> = Object.assign(
    Object.create(null),
    previous?.attempts ?? Object.fromEntries(tasks.map((t) => [t.id, 0])),
  );
  const values: Record<string, Json> = Object.assign(
    Object.create(null),
    previous?.values ?? {},
  );
  const events: WorkflowEvent[] = [...(previous?.events ?? [])];
  let revision = previous?.revision ?? -1;
  const controller = new AbortController();
  const forward = () => controller.abort(abortError());
  signal?.addEventListener("abort", forward, { once: true });
  if (signal?.aborted) forward();
  // Every transition is serialized. Effects begin only after the start checkpoint commits.
  let queue: Promise<void> = Promise.resolve();
  const transition = (
    change: () => void,
    event?: Omit<WorkflowEvent, "sequence" | "timestamp">,
  ): Promise<void> => {
    queue = queue.then(async () => {
      change();
      let record: WorkflowEvent | undefined;
      if (event) {
        const timestamp = (options.now ?? Date.now)();
        if (!Number.isFinite(timestamp))
          throw new CheckpointError("Clock returned a non-finite timestamp");
        record = Object.freeze({
          ...event,
          sequence: events.length + 1,
          timestamp,
        });
        events.push(record);
      }
      if (options.store) {
        const checkpoint = decodeCheckpoint({
          schema: 1,
          runId,
          definition,
          revision: revision + 1,
          states,
          attempts,
          values,
          events,
        });
        try {
          await options.store.save(checkpoint, revision < 0 ? null : revision);
        } catch (cause) {
          controller.abort(
            new CheckpointError("Checkpoint write failed", { cause }),
          );
          throw new CheckpointError(
            "Checkpoint write failed; execution stopped",
            { cause },
          );
        }
      }
      revision++;
      try {
        if (record) options.onEvent?.(record);
      } catch {
        /* diagnostic subscribers cannot affect execution */
      }
    });
    return queue;
  };
  const execute = async (task: Task): Promise<void> => {
    for (
      let localAttempt = 0;
      localAttempt <= (task.retries ?? 0);
      localAttempt++
    ) {
      const attempt = attempts[task.id] + 1;
      await transition(
        () => {
          attempts[task.id] = attempt;
          states[task.id] = "running";
        },
        { taskId: task.id, type: "started", attempt },
      );
      try {
        const dependencies = new Map(
          (task.dependsOn ?? []).map((id) => [id, values[id]]),
        );
        const value = await invoke(
          task,
          {
            attempt,
            results: dependencies,
            idempotencyKey: JSON.stringify([runId, task.id]),
          },
          timeout,
          controller.signal,
        );
        const output = jsonCopy(value === undefined ? null : value);
        await transition(
          () => {
            values[task.id] = output;
            states[task.id] = "completed";
          },
          { taskId: task.id, type: "completed", attempt },
        );
        return;
      } catch (error) {
        // A rejected transition poisons the queue: never turn storage failure into a task retry.
        await queue;
        if (localAttempt < (task.retries ?? 0) && !controller.signal.aborted) {
          await transition(() => {}, {
            taskId: task.id,
            type: "retrying",
            attempt,
            detail: errorMessage(error),
          });
          try {
            await delay(
              Math.min(60000, retryDelay * 2 ** Math.min(localAttempt, 16)),
              controller.signal,
            );
          } catch {
            /* record abort below on next invoke */
          }
          continue;
        }
        await transition(
          () => {
            states[task.id] = "failed";
          },
          {
            taskId: task.id,
            type: "failed",
            attempt,
            detail: errorMessage(error),
          },
        );
        return;
      }
    }
  };
  const inFlight = new Set<Promise<void>>();
  const reserved = new Set<string>();
  try {
    if (!previous) await transition(() => {});
    else
      for (const task of tasks)
        if (states[task.id] !== "completed") {
          await transition(
            () => {
              states[task.id] = "pending";
            },
            {
              taskId: task.id,
              type: "recovered",
              attempt: attempts[task.id],
              detail: "Explicit recovery; effects may be repeated",
            },
          );
        }
    while (
      Object.values(states).some((s) => s === "pending") ||
      inFlight.size
    ) {
      for (const task of tasks) {
        if (states[task.id] !== "pending" || reserved.has(task.id)) continue;
        if (
          controller.signal.aborted ||
          (task.dependsOn ?? []).some(
            (d) => states[d] === "failed" || states[d] === "skipped",
          )
        ) {
          await transition(
            () => {
              states[task.id] = "skipped";
            },
            {
              taskId: task.id,
              type: "skipped",
              attempt: attempts[task.id],
              detail: controller.signal.aborted
                ? "Workflow aborted"
                : "Dependency did not complete",
            },
          );
        }
      }
      for (const task of tasks) {
        if (inFlight.size >= concurrency || controller.signal.aborted) break;
        if (states[task.id] !== "pending" || reserved.has(task.id)) continue;
        if ((task.dependsOn ?? []).every((d) => states[d] === "completed")) {
          // Reserve synchronously to prevent scheduling a task twice before persistence resolves.
          reserved.add(task.id);
          const running = execute(task);
          inFlight.add(running);
          // Do not create an unhandled rejection via .finally().
          void running.then(
            () => inFlight.delete(running),
            () => {},
          );
        }
      }
      if (inFlight.size) await Promise.race(inFlight);
      else if (Object.values(states).some((s) => s === "pending"))
        throw new Error("Workflow deadlocked");
    }
    return Object.freeze({
      states: Object.freeze({ ...states }),
      values: Object.freeze({ ...values }),
      events: Object.freeze([...events]),
    });
  } finally {
    controller.abort(abortError());
    await Promise.allSettled(inFlight);
    signal?.removeEventListener("abort", forward);
  }
}
