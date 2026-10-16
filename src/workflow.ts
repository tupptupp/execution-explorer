import type {
  Task,
  TaskState,
  WorkflowEvent,
} from "../packages/workflow-engine/src/engine";

export type Scenario = "success" | "retry" | "failure";
export const scenarios: Record<
  Scenario,
  { label: string; description: string }
> = {
  success: {
    label: "Happy path",
    description: "Two parallel branches converge into a durable checkpoint.",
  },
  retry: {
    label: "Transient failure",
    description: "Enrichment fails once, backs off, then succeeds.",
  },
  failure: {
    label: "Service outage",
    description: "Storage fails after retries. Resolve the fault and recover.",
  },
};
export const nodes = [
  {
    id: "receive",
    label: "Receive event",
    service: "gateway",
    x: 24,
    y: 208,
    dependsOn: [],
    detail: "Validate the incoming envelope and allocate a correlation key.",
    duration: 480,
  },
  {
    id: "validate",
    label: "Validate schema",
    service: "schema-registry",
    x: 248,
    y: 96,
    dependsOn: ["receive"],
    detail: "Check required fields against the workflow contract.",
    duration: 760,
  },
  {
    id: "enrich",
    label: "Enrich context",
    service: "profile-service",
    x: 248,
    y: 320,
    dependsOn: ["receive"],
    detail:
      "Resolve profile context. The transient scenario fails the first attempt.",
    duration: 1060,
  },
  {
    id: "aggregate",
    label: "Merge branches",
    service: "transform",
    x: 472,
    y: 208,
    dependsOn: ["validate", "enrich"],
    detail: "Wait for both branches, then combine their immutable results.",
    duration: 540,
  },
  {
    id: "persist",
    label: "Persist record",
    service: "record-store",
    x: 696,
    y: 208,
    dependsOn: ["aggregate"],
    detail:
      "Simulated external write. The outage scenario fails until recovery resolves the fault.",
    duration: 680,
  },
  {
    id: "notify",
    label: "Publish event",
    service: "event-bus",
    x: 920,
    y: 208,
    dependsOn: ["persist"],
    detail: "Publish the final acknowledgement after the record is committed.",
    duration: 460,
  },
] as const;
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const finish = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}
export function createTasks(scenario: Scenario, repaired = false): Task[] {
  return nodes.map((node) => ({
    id: node.id,
    dependsOn: node.dependsOn,
    retries: node.id === "enrich" || node.id === "persist" ? 1 : 0,
    timeoutMs: 5000,
    run: async ({ signal, attempt, results, idempotencyKey }) => {
      await sleep(node.duration, signal);
      if (scenario === "retry" && node.id === "enrich" && attempt === 1)
        throw Error("503 Profile service temporarily unavailable");
      if (scenario === "failure" && node.id === "persist" && !repaired)
        throw Error("503 Record store unavailable");
      return {
        stage: node.id,
        accepted: true,
        inputs: [...results.keys()],
        idempotencyKey,
      };
    },
  }));
}
export function projectEvents(
  events: readonly WorkflowEvent[],
): Record<string, TaskState> {
  const states: Record<string, TaskState> = Object.fromEntries(
    nodes.map((n) => [n.id, "pending"]),
  );
  for (const event of events)
    states[event.taskId] =
      event.type === "started" || event.type === "retrying"
        ? "running"
        : event.type === "recovered"
          ? "pending"
          : event.type;
  return states;
}
export const stateLabels: Record<TaskState, string> = {
  pending: "Pending",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
};
