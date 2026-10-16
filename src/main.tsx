import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Braces,
  Check,
  ChevronRight,
  Code2,
  GitBranch,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Square,
  Terminal,
  Workflow,
} from "lucide-react";
import { WorkflowGraph } from "./WorkflowGraph";
import { useExecution } from "./useExecution";
import {
  nodes,
  projectEvents,
  scenarios,
  stateLabels,
  type Scenario,
} from "./workflow";
import "./styles.css";
const ms = (n: number) =>
  n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(2)} s`;
function App() {
  const execution = useExecution();
  const { session, events, checkpoint, busy, loading, error } = execution;
  const [selected, setSelected] = useState("enrich"),
    [cursor, setCursor] = useState<number | null>(null),
    [playing, setPlaying] = useState(false),
    [ack, setAck] = useState(false),
    [eventFilter, setEventFilter] = useState("all");
  useEffect(() => {
    setCursor(null);
    setPlaying(false);
    setAck(false);
  }, [session.id]);
  useEffect(() => {
    if (busy) {
      setCursor(null);
      setPlaying(false);
    }
  }, [busy]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () =>
        setCursor((current) => {
          const next = (current ?? 0) + 1;
          if (next >= events.length) {
            setPlaying(false);
            return events.length;
          }
          return next;
        }),
      420,
    );
    return () => clearInterval(timer);
  }, [playing, events.length]);
  const visibleEvents = useMemo(
    () => events.slice(0, cursor ?? events.length),
    [events, cursor],
  );
  const states = useMemo(() => projectEvents(visibleEvents), [visibleEvents]);
  const node = nodes.find((n) => n.id === selected)!;
  const nodeEvents = visibleEvents.filter((e) => e.taskId === selected);
  const latest = nodeEvents.at(-1);
  const started = nodeEvents.filter((e) => e.type === "started").at(-1);
  const finished = nodeEvents
    .filter((e) => e.type === "completed" || e.type === "failed")
    .at(-1);
  const totalDuration =
    events.length > 1 ? events.at(-1)!.timestamp - events[0].timestamp : 0;
  const completed = Object.values(states).filter(
    (s) => s === "completed",
  ).length;
  const retries = visibleEvents.filter((e) => e.type === "retrying").length;
  const incomplete =
    !!checkpoint &&
    Object.values(checkpoint.states).some((s) => s !== "completed");
  const status = loading
    ? "Loading"
    : busy
      ? "Running"
      : incomplete
        ? "Recovery required"
        : checkpoint
          ? "Completed"
          : "Ready";
  const logEvents = visibleEvents
    .filter((e) => eventFilter === "all" || e.taskId === eventFilter)
    .slice(-120)
    .reverse();
  function exportTrace() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            schema: 1,
            scenario: session.scenario,
            runId: session.id,
            checkpoint: checkpoint ?? null,
            events,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "execution-trace.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return (
    <div className="app">
      <a className="skip-link" href="#console">
        Skip to console
      </a>
      <aside className="rail" aria-label="Project navigation">
        <a className="mark" href="#" aria-label="Execution Explorer home">
          <Workflow size={25} />
        </a>
        <a
          href="#console"
          className="rail-active"
          aria-label="Execution console"
        >
          <GitBranch size={21} />
        </a>
        <a href="#event-log" aria-label="Event journal">
          <Terminal size={21} />
        </a>
        <a
          href="https://github.com/tupptupp/execution-explorer/tree/feature/workflow-engine"
          aria-label="Source on GitHub"
        >
          <Code2 size={21} />
        </a>
        <span className="rail-bottom">MC / 26</span>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <a href="#" className="wordmark">
            EXECUTION<span>EXPLORER</span>
          </a>
          <span className="top-separator" />
          <span className="micro hide-mobile">
            DESIGN ENGINEERING / VOL. 01
          </span>
          <a
            className="source-link"
            href="https://github.com/tupptupp/execution-explorer/pull/1"
          >
            View source <ArrowUpRight size={14} />
          </a>
          <span className="local-badge">
            <i /> LOCAL SANDBOX
          </span>
        </header>
        <main id="console">
          <div className="intro">
            <div>
              <div className="eyebrow">
                <span /> SYSTEMS, MADE VISIBLE
              </div>
              <h1>
                Every step.
                <br />
                <span>Nothing hidden.</span>
              </h1>
              <p>
                A workflow engine you can see, interrupt, and recover.
                <br className="hide-mobile" /> Follow the decisions behind every
                execution.
              </p>
            </div>
            <div className="intro-note">
              <span className="micro">
                A WORKING SYSTEM, OPEN FOR INSPECTION
              </span>
              <p>
                Real execution. Simulated services.
                <br />
                Your browser is the runtime.
              </p>
              <a href="https://github.com/tupptupp/execution-explorer/blob/feature/workflow-engine/docs/architecture.md">
                Read the architecture <ArrowUpRight size={14} />
              </a>
            </div>
          </div>
          <section className="control-bar" aria-label="Workflow controls">
            <div className="workflow-name">
              <span className="workflow-icon">
                <GitBranch size={20} />
              </span>
              <div>
                <strong>Customer onboarding</strong>
                <span>
                  onboarding-2 <ChevronRight size={12} />{" "}
                  {session.id.split(":")[1].slice(0, 8)}
                </span>
              </div>
            </div>
            <label className="scenario-label">
              SCENARIO
              <select
                aria-label="Scenario"
                value={session.scenario}
                disabled={busy || loading}
                onChange={(e) =>
                  execution.newSession(e.target.value as Scenario)
                }
              >
                {Object.entries(scenarios).map(([key, value]) => (
                  <option value={key} key={key}>
                    {value.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="run-actions">
              {busy ? (
                <button className="button danger" onClick={execution.cancel}>
                  <Square size={13} /> Stop execution
                </button>
              ) : (
                <>
                  <button
                    className="button quiet"
                    disabled={loading}
                    onClick={() => execution.newSession(session.scenario)}
                  >
                    <RotateCcw size={14} /> New run
                  </button>
                  <button
                    className="button primary"
                    disabled={loading || !!checkpoint}
                    onClick={() => void execution.execute()}
                  >
                    <Play size={14} /> Run workflow
                  </button>
                </>
              )}
            </div>
          </section>
          <p className="scenario-description">
            {scenarios[session.scenario].description}
          </p>
          {error && (
            <div role="alert" className="error-banner">
              <strong>Execution stopped safely.</strong> {error}
            </div>
          )}
          {incomplete && !busy && (
            <section className="recovery-panel" aria-label="Recovery controls">
              <ShieldCheck size={20} />
              <div>
                <strong>Saved progress. A deliberate restart.</strong>
                <p>
                  Completed steps will be retained. Interrupted or failed steps
                  may repeat external effects. This demo resolves the injected
                  outage during recovery.
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={ack}
                    onChange={(e) => setAck(e.target.checked)}
                  />{" "}
                  I understand that incomplete steps may run again.
                </label>
              </div>
              <button
                className="button primary"
                disabled={!ack || loading}
                onClick={() => {
                  setAck(false);
                  void execution.execute(true);
                }}
              >
                Recover execution <ArrowUpRight size={14} />
              </button>
            </section>
          )}
          <section className="metrics" aria-label="Execution metrics">
            <div>
              <span>EXECUTION STATE</span>
              <strong className={busy ? "mint" : ""}>
                <i className={"status-dot " + (busy ? "active" : "")} />
                {status}
              </strong>
              <small aria-live="polite">
                {busy
                  ? "Checkpointed before every effect"
                  : checkpoint
                    ? `Revision ${checkpoint.revision} · IndexedDB`
                    : "Waiting for your first execution"}
              </small>
            </div>
            <div>
              <span>COMPLETED STEPS</span>
              <strong>
                {String(completed).padStart(2, "0")}
                <em>/ 06</em>
              </strong>
              <small>Dependency-aware scheduling</small>
            </div>
            <div>
              <span>OBSERVED DURATION</span>
              <strong>{totalDuration ? ms(totalDuration) : "—"}</strong>
              <small>Wall time, including waits and retries</small>
            </div>
            <div>
              <span>RETRY EVENTS</span>
              <strong>
                {String(retries).padStart(2, "0")}
                <em>↗</em>
              </strong>
              <small>Concurrency limit · 2 scheduled tasks</small>
            </div>
          </section>
          <div className="console-grid">
            <WorkflowGraph
              states={states}
              selected={selected}
              onSelect={setSelected}
            />
            <section className="inspector" aria-labelledby="inspector-heading">
              <div className="section-bar">
                <div>
                  <span className="section-number">02 /</span>
                  <h2 id="inspector-heading">Step inspector</h2>
                </div>
                <Braces size={16} />
              </div>
              <div className="inspector-content">
                <span className={"state-label " + states[selected]}>
                  <i />
                  {stateLabels[states[selected]]}
                </span>
                <h3>{node.label}</h3>
                <code className="service-name">{node.service}</code>
                <p>{node.detail}</p>
                <dl>
                  <div>
                    <dt>Attempt</dt>
                    <dd>{latest?.attempt ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Latest duration</dt>
                    <dd>
                      {started &&
                      finished &&
                      finished.sequence > started.sequence
                        ? ms(finished.timestamp - started.timestamp)
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Depends on</dt>
                    <dd>
                      {node.dependsOn.length
                        ? node.dependsOn.join(", ")
                        : "Entry point"}
                    </dd>
                  </div>
                  <div>
                    <dt>Timeout</dt>
                    <dd>5,000 ms</dd>
                  </div>
                </dl>
                <div className="payload-heading">
                  <span>
                    {latest?.detail ? "LAST DIAGNOSTIC" : "TASK OUTPUT"}
                  </span>
                  <span>JSON / TEXT</span>
                </div>
                <pre tabIndex={0} aria-label="Task output and diagnostic">
                  {latest?.detail ??
                    (states[selected] === "completed" &&
                    checkpoint?.values[selected]
                      ? JSON.stringify(checkpoint.values[selected], null, 2)
                      : "// Run this workflow to inspect\n// persisted task output.")}
                </pre>
              </div>
            </section>
          </div>
          <section className="replay-panel" aria-label="Event replay">
            <button
              className="replay-button"
              aria-label={playing ? "Pause replay" : "Play event replay"}
              disabled={busy || !events.length}
              onClick={() => {
                if (!playing && (cursor === null || cursor >= events.length))
                  setCursor(0);
                setPlaying((p) => !p);
              }}
            >
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <div className="replay-title">
              <strong>
                {cursor === null ? "Execution journal" : "Event replay"}
              </strong>
              <span>{cursor === null ? "LIVE VIEW" : "HISTORICAL VIEW"}</span>
            </div>
            <label className="replay-range">
              <span className="sr-only">Replay position</span>
              <input
                type="range"
                min="0"
                max={events.length || 1}
                value={cursor ?? events.length}
                disabled={busy || !events.length}
                onChange={(e) => {
                  setPlaying(false);
                  setCursor(Number(e.target.value));
                }}
              />
            </label>
            <code>
              {String(cursor ?? events.length).padStart(2, "0")} /{" "}
              {String(events.length).padStart(2, "0")}
            </code>
            <button
              className="button quiet"
              disabled={busy || cursor === null}
              onClick={() => {
                setPlaying(false);
                setCursor(null);
              }}
            >
              Live
            </button>
          </section>
          <section
            className="journal"
            id="event-log"
            aria-labelledby="journal-heading"
          >
            <div className="section-bar">
              <div>
                <span className="section-number">03 /</span>
                <h2 id="journal-heading">Event journal</h2>
                <span className="event-count">{visibleEvents.length}</span>
              </div>
              <div className="journal-actions">
                <select
                  aria-label="Filter events by step"
                  value={eventFilter}
                  onChange={(e) => setEventFilter(e.target.value)}
                >
                  <option value="all">All steps</option>
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label}
                    </option>
                  ))}
                </select>
                <button
                  className="button quiet"
                  disabled={!events.length || busy}
                  onClick={exportTrace}
                >
                  <ArrowDownToLine size={14} /> Export JSON
                </button>
              </div>
            </div>
            <div className="event-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>SEQ</th>
                    <th>TIME / RELATIVE</th>
                    <th>STEP</th>
                    <th>EVENT</th>
                    <th>DETAIL</th>
                  </tr>
                </thead>
                <tbody>
                  {logEvents.map((event) => (
                    <tr key={event.sequence}>
                      <td>{String(event.sequence).padStart(3, "0")}</td>
                      <td>+{ms(event.timestamp - events[0].timestamp)}</td>
                      <td>
                        <button onClick={() => setSelected(event.taskId)}>
                          {event.taskId}
                        </button>
                      </td>
                      <td>
                        <span className={"event-type " + event.type}>
                          {event.type}
                        </span>
                      </td>
                      <td>{event.detail ?? `Attempt ${event.attempt}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!logEvents.length && (
                <div className="empty">
                  <Terminal size={24} />
                  <strong>
                    {events.length
                      ? "No events at this position."
                      : "The next event is yours."}
                  </strong>
                  <span>
                    {events.length
                      ? "Move the replay cursor or reset the step filter."
                      : "Choose a scenario and run the workflow to begin."}
                  </span>
                </div>
              )}
            </div>
            <div className="journal-footer">
              <span>
                <Check size={12} /> Ordered, checkpointed events
              </span>
              <span>
                Newest first · Showing up to 120 events ·{" "}
                {cursor === null ? "Live view" : "Replay view"}
              </span>
            </div>
          </section>
          <footer>
            <div className="footer-brand">
              <Workflow size={18} />
              <span>
                Execution Explorer <small>by Martin Carlsson</small>
              </span>
            </div>
            <p>
              Independent portfolio project · AI-assisted implementation
              <br />
              No backend · No real customer data · No exactly-once guarantee
            </p>
            <a href="https://github.com/tupptupp/execution-explorer/blob/feature/workflow-engine/docs/verification.md">
              Verification & limitations <ArrowUpRight size={13} />
            </a>
          </footer>
        </main>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
