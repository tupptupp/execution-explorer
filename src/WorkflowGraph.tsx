import { useEffect, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import type { TaskState } from "../packages/workflow-engine/src/engine";
import { nodes, stateLabels } from "./workflow";
interface Props {
  states: Record<string, TaskState>;
  selected: string;
  onSelect: (id: string) => void;
}
export function WorkflowGraph({ states, selected, onSelect }: Props) {
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = viewport.current!;
    const observer = new ResizeObserver(([entry]) =>
      setFit(
        window.innerWidth <= 640
          ? 1
          : Math.min(1, entry.contentRect.width / 1120),
      ),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const scale = zoom * fit;
  return (
    <section className="graph-panel" aria-labelledby="graph-heading">
      <div className="section-bar">
        <div>
          <span className="section-number">01 /</span>
          <h2 id="graph-heading">Execution topology</h2>
        </div>
        <span className="micro">DAG · 6 NODES · 6 EDGES</span>
      </div>
      <div className="mobile-workflow" aria-label="Workflow stages">
        {nodes.map((node, index) => (
          <button
            type="button"
            className={`mobile-stage ${states[node.id]} ${selected === node.id ? "selected" : ""}`}
            key={node.id}
            onClick={() => onSelect(node.id)}
            aria-pressed={selected === node.id}
          >
            <span className="mobile-stage-index">{String(index + 1).padStart(2, "0")}</span>
            <span className="mobile-stage-copy">
              <strong>{node.label}</strong>
              <small>{node.service}</small>
              <small className="mobile-stage-deps">
                {node.dependsOn.length ? `After: ${node.dependsOn.join(", ")}` : "Workflow entry"}
              </small>
            </span>
            <span className="mobile-stage-status">{stateLabels[states[node.id]]}</span>
          </button>
        ))}
      </div>
      <div
        ref={viewport}
        className="graph-viewport"
        tabIndex={0}
        role="region"
        aria-label="Scrollable workflow graph"
      >
        <div
          className="graph-space"
          style={{ width: 1120 * scale, height: 484 * scale }}
        >
          <div className="graph-inner" style={{ transform: `scale(${scale})` }}>
            <div className="graph-orbit orbit-one" />
            <div className="graph-orbit orbit-two" />
            <svg
              className="connections"
              viewBox="0 0 1120 484"
              aria-hidden="true"
            >
              <defs>
                <linearGradient
                  id="edge-gradient"
                  gradientUnits="userSpaceOnUse"
                  x1="0"
                  x2="1120"
                >
                  <stop stopColor="#a7f3d0" />
                  <stop offset="1" stopColor="#5c968e" />
                </linearGradient>
              </defs>
              {nodes.flatMap((target) =>
                target.dependsOn.map((sourceId) => {
                  const source = nodes.find((n) => n.id === sourceId)!;
                  const fromX = source.x + 172,
                    fromY = source.y + 42,
                    toX = target.x,
                    toY = target.y + 42;
                  const d = `M ${fromX} ${fromY} C ${fromX + 36} ${fromY}, ${toX - 36} ${toY}, ${toX} ${toY}`;
                  const complete = states[sourceId] === "completed";
                  const flowing = complete && states[target.id] === "running";
                  return (
                    <g key={sourceId + "-" + target.id}>
                      <path
                        d={d}
                        className={"edge " + (complete ? "edge-complete" : "")}
                      />
                      {flowing && <path d={d} className="edge-flow" />}
                    </g>
                  );
                }),
              )}
            </svg>
            {nodes.map((node, i) => (
              <button
                key={node.id}
                className={`graph-node ${states[node.id]} ${selected === node.id ? "selected" : ""}`}
                style={{ left: node.x, top: node.y }}
                onClick={() => onSelect(node.id)}
                aria-pressed={selected === node.id}
                aria-label={`${node.label}: ${stateLabels[states[node.id]]}`}
              >
                <span className="node-heading">
                  <span className="node-symbol">
                    {states[node.id] === "completed"
                      ? "✓"
                      : states[node.id] === "failed"
                        ? "×"
                        : String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="node-state">
                    {stateLabels[states[node.id]]}
                  </span>
                </span>
                <strong>{node.label}</strong>
                <span className="node-service">{node.service}</span>
                <span className="node-port left" />
                <span className="node-port right" />
              </button>
            ))}
            <span className="graph-annotation top-annotation">
              FAN OUT / PARALLEL EXECUTION
            </span>
            <span className="graph-annotation bottom-annotation">
              FAN IN / DEPENDENCY BARRIER
            </span>
          </div>
        </div>
      </div>
      <div className="graph-foot">
        <div className="legend">
          <span>
            <i className="complete-dot" />
            Completed
          </span>
          <span>
            <i className="running-dot" />
            Running
          </span>
          <span>
            <i className="pending-dot" />
            Pending
          </span>
        </div>
        <div className="zoom-controls">
          <button
            aria-label="Zoom out"
            disabled={zoom <= 0.6}
            onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))}
          >
            <Minus size={14} />
          </button>
          <span>{Math.round(scale * 100)}%</span>
          <button
            aria-label="Zoom in"
            disabled={zoom >= 1.4}
            onClick={() => setZoom((z) => Math.min(1.4, z + 0.2))}
          >
            <Plus size={14} />
          </button>
          <button aria-label="Reset graph zoom" onClick={() => setZoom(1)}>
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
    </section>
  );
}
