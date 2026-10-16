import { useCallback, useEffect, useRef, useState } from "react";
import {
  decodeCheckpoint,
  runWorkflow,
  type Checkpoint,
  type WorkflowEvent,
} from "../packages/workflow-engine/src/engine";
import { IndexedDBCheckpointStore } from "../packages/workflow-engine/src/stores";
import { createTasks, type Scenario } from "./workflow";
const store = new IndexedDBCheckpointStore();
const pointer = "execution-explorer/current-v2";
interface Session {
  id: string;
  scenario: Scenario;
}
function fresh(scenario: Scenario): Session {
  return { id: scenario + ":" + crypto.randomUUID(), scenario };
}
function initial(): Session {
  try {
    const data = JSON.parse(localStorage.getItem(pointer) ?? "null");
    if (
      data &&
      typeof data.id === "string" &&
      ["success", "retry", "failure"].includes(data.scenario)
    )
      return data;
  } catch {
    /* storage may be disabled */
  }
  return fresh("retry");
}
export function useExecution() {
  const [session, setSession] = useState(initial);
  const [events, setEvents] = useState<readonly WorkflowEvent[]>([]);
  const [checkpoint, setCheckpoint] = useState<Checkpoint>();
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const controller = useRef<AbortController | undefined>(undefined);
  const active = useRef(false);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setEvents([]);
    setCheckpoint(undefined);
    setError("");
    store
      .load(session.id)
      .then((data) => {
        if (live && data) {
          const saved = decodeCheckpoint(data);
          setCheckpoint(saved);
          setEvents(saved.events);
        }
      })
      .catch((e) => {
        if (live) setError(String(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [session.id]);
  useEffect(() => () => controller.current?.abort(), []);
  const newSession = useCallback((scenario: Scenario) => {
    if (active.current) return;
    const next = fresh(scenario);
    setSession(next);
  }, []);
  const execute = useCallback(
    async (recover = false) => {
      if (active.current || loading) return;
      active.current = true;
      setBusy(true);
      setError("");
      const abort = new AbortController();
      controller.current = abort;
      try {
        if (!navigator.locks)
          throw Error(
            "This browser cannot safely own a persistent run. Use a current browser with Web Locks.",
          );
        await navigator.locks.request(
          "execution-explorer/owner",
          { ifAvailable: true },
          async (lock) => {
            if (!lock)
              throw Error(
                "Another tab owns the console. Stop that run before continuing here.",
              );
            try {
              localStorage.setItem(pointer, JSON.stringify(session));
            } catch {
              throw Error(
                "Browser storage is unavailable. Enable site storage to preserve the recovery pointer.",
              );
            }
            await runWorkflow(
              createTasks(session.scenario, recover),
              {
                runId: session.id,
                version: "onboarding-2",
                store,
                concurrency: 2,
                retryDelayMs: 350,
                ...(recover ? { recovery: "retry-incomplete" as const } : {}),
                onEvent: (event) =>
                  setEvents((previous) => [...previous, event]),
              },
              abort.signal,
            );
          },
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        try {
          const data = await store.load(session.id);
          if (data) {
            const saved = decodeCheckpoint(data);
            setCheckpoint(saved);
            setEvents(saved.events);
          }
        } catch (e) {
          setError("Cannot read saved execution: " + String(e));
        }
        active.current = false;
        setBusy(false);
        controller.current = undefined;
      }
    },
    [session, loading],
  );
  return {
    session,
    events,
    checkpoint,
    busy,
    loading,
    error,
    newSession,
    execute,
    cancel: () => controller.current?.abort(),
  };
}
