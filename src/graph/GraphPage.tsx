import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronLeft, ExternalLink, Focus, Minus, Plus, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import { loadContextGraphSnapshot, type ContextGraphSnapshot } from "../data/context-graph-repository";
import { contextGraphNodeTypes, type ContextGraphNode, type ContextGraphNodeType } from "../domain/context-graph";
import {
  advanceGraphSimulation,
  connectedNodeIds,
  createGraphLayout,
  createGraphVelocities,
  filterGraph,
  fitGraphViewport,
  graphDegrees,
  graphNodeTypeLabels,
  type GraphPoint,
} from "../domain/graph-visualization";
import "./GraphPage.scss";

const nodeColors: Record<ContextGraphNodeType, string> = {
  task: "#7770e4",
  jira_issue: "#2684ff",
  pull_request: "#9b6bd6",
  github_commit: "#7c8797",
  slack_message: "#de5d83",
  confluence_page: "#2f83d0",
  calendar_event: "#52a56b",
  ai_session: "#d38b32",
};

function shortDate(value: string | null) {
  if (!value) return "날짜 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function GraphInspector({
  node,
  neighbors,
  onClose,
  onSelect,
}: {
  node: ContextGraphNode;
  neighbors: Array<{ node: ContextGraphNode; relation: string }>;
  onClose: () => void;
  onSelect: (node: ContextGraphNode) => void;
}) {
  return (
    <aside className="graph-inspector" aria-label="선택한 노드 정보">
      <div className="graph-inspector-heading">
        <span className="graph-node-type"><i style={{ background: nodeColors[node.nodeType] }} />{graphNodeTypeLabels[node.nodeType]}</span>
        <button type="button" aria-label="상세 닫기" onClick={onClose}><X size={15} /></button>
      </div>
      <h2>{node.label}</h2>
      <div className="graph-node-meta"><span>{node.sourceId}</span><span>{shortDate(node.updatedAt ?? node.occurredAt)}</span></div>
      {node.body && <p>{node.body}</p>}
      {node.url && (
        <button className="graph-open-source" type="button" onClick={() => void openUrl(node.url!)}>
          원본 열기 <ExternalLink size={13} />
        </button>
      )}
      <section>
        <div className="graph-connections-title"><strong>연결</strong><span>{neighbors.length}</span></div>
        <div className="graph-neighbor-list">
          {neighbors.length === 0 && <div className="graph-neighbor-empty">현재 표시 범위에 연결이 없습니다.</div>}
          {neighbors.map(({ node: neighbor, relation }) => (
            <button type="button" key={neighbor.id} onClick={() => onSelect(neighbor)}>
              <i style={{ background: nodeColors[neighbor.nodeType] }} />
              <span><strong>{truncate(neighbor.label, 50)}</strong><small>{relation} · {graphNodeTypeLabels[neighbor.nodeType]}</small></span>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}

export default function GraphPage() {
  const canvasRef = useRef<SVGSVGElement | null>(null);
  const [snapshot, setSnapshot] = useState<ContextGraphSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [showIsolated, setShowIsolated] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [localOnly, setLocalOnly] = useState(false);
  const [enabledTypes, setEnabledTypes] = useState<Set<ContextGraphNodeType>>(() => new Set(contextGraphNodeTypes));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [size, setSize] = useState({ width: 1_100, height: 700 });
  const [positions, setPositions] = useState<Map<string, GraphPoint>>(new Map());
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const pointerState = useRef<{ kind: "pan" | "node"; id?: string; x: number; y: number; moved: boolean } | null>(null);
  const positionsRef = useRef<Map<string, GraphPoint>>(new Map());
  const velocitiesRef = useRef(createGraphVelocities([]));
  const pointerGraphRef = useRef<GraphPoint | null>(null);
  const simulationAlphaRef = useRef(.9);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const next = await loadContextGraphSnapshot();
      setSnapshot(next);
      setSelectedId((current) => current && next.nodes.some((node) => node.id === current) ? current : null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const filtered = useMemo(() => {
    const result = filterGraph(snapshot?.nodes ?? [], snapshot?.edges ?? [], enabledTypes, query);
    let visible = result;
    if (!showIsolated && !query.trim()) {
      const connected = new Set(result.edges.flatMap((edge) => [edge.fromNodeId, edge.toNodeId]));
      visible = { ...result, nodes: result.nodes.filter((node) => connected.has(node.id)) };
    }
    if (!localOnly || !selectedId) return visible;
    const localIds = connectedNodeIds(selectedId, visible.edges);
    return {
      ...visible,
      nodes: visible.nodes.filter((node) => localIds.has(node.id)),
      edges: visible.edges.filter((edge) => localIds.has(edge.fromNodeId) && localIds.has(edge.toNodeId)),
    };
  }, [snapshot, enabledTypes, query, showIsolated, localOnly, selectedId]);
  const degrees = useMemo(() => graphDegrees(filtered.nodes, filtered.edges), [filtered]);
  const nodesById = useMemo(() => new Map(filtered.nodes.map((node) => [node.id, node])), [filtered.nodes]);

  useEffect(() => {
    const nextPositions = createGraphLayout(filtered.nodes, filtered.edges, size.width, size.height);
    positionsRef.current = nextPositions;
    velocitiesRef.current = createGraphVelocities(filtered.nodes);
    simulationAlphaRef.current = .9;
    setPositions(nextPositions);
    setViewport(fitGraphViewport(nextPositions, size.width, size.height));
  }, [snapshot?.generationId, enabledTypes, query, showIsolated, size.width, size.height]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || filtered.nodes.length === 0) return;
    let frameId = 0;
    let lastPaint = 0;
    const tick = (time: number) => {
      advanceGraphSimulation(filtered.nodes, filtered.edges, positionsRef.current, velocitiesRef.current, {
        width: size.width,
        height: size.height,
        alpha: simulationAlphaRef.current,
        pointer: pointerGraphRef.current,
        fixedNodeId: pointerState.current?.kind === "node" ? pointerState.current.id : null,
        timeMs: time,
      });
      simulationAlphaRef.current = Math.max(pointerGraphRef.current ? .24 : .075, simulationAlphaRef.current * .994);
      if (time - lastPaint >= 16) {
        setPositions(new Map(positionsRef.current));
        lastPaint = time;
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [filtered.nodes, filtered.edges, size.width, size.height]);

  const selectedNode = selectedId ? nodesById.get(selectedId) ?? snapshot?.nodes.find((node) => node.id === selectedId) ?? null : null;
  const activeNodeId = hoveredId ?? selectedId;
  const selectedConnections = useMemo(() => activeNodeId ? connectedNodeIds(activeNodeId, filtered.edges) : new Set<string>(), [activeNodeId, filtered.edges]);
  const neighbors = useMemo(() => {
    if (!selectedNode) return [];
    return filtered.edges.flatMap((edge) => {
      const neighborId = edge.fromNodeId === selectedNode.id ? edge.toNodeId : edge.toNodeId === selectedNode.id ? edge.fromNodeId : null;
      const node = neighborId ? nodesById.get(neighborId) : null;
      return node ? [{ node, relation: edge.relationType }] : [];
    }).sort((left, right) => (degrees.get(right.node.id) ?? 0) - (degrees.get(left.node.id) ?? 0));
  }, [selectedNode, filtered.edges, nodesById, degrees]);

  function toggleType(type: ContextGraphNodeType) {
    setEnabledTypes((current) => {
      const next = new Set(current);
      if (next.has(type) && next.size > 1) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function handleWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    setViewport((current) => {
      const scale = Math.max(0.35, Math.min(2.8, current.scale * (event.deltaY > 0 ? 0.9 : 1.1)));
      return {
        scale,
        x: cursorX - ((cursorX - current.x) / current.scale) * scale,
        y: cursorY - ((cursorY - current.y) / current.scale) * scale,
      };
    });
  }

  function beginPointer(event: ReactPointerEvent<SVGElement>, kind: "pan" | "node", id?: string) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerState.current = { kind, id, x: event.clientX, y: event.clientY, moved: false };
  }

  function movePointer(event: ReactPointerEvent<SVGElement>) {
    const pointer = pointerState.current;
    if (!pointer) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        pointerGraphRef.current = {
          x: (event.clientX - rect.left - viewport.x) / viewport.scale,
          y: (event.clientY - rect.top - viewport.y) / viewport.scale,
        };
        simulationAlphaRef.current = Math.max(.34, simulationAlphaRef.current);
      }
      return;
    }
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) pointer.moved = true;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (pointer.kind === "node" && pointer.id) {
      const point = positionsRef.current.get(pointer.id);
      if (point) {
        positionsRef.current.set(pointer.id, { x: point.x + dx / viewport.scale, y: point.y + dy / viewport.scale });
        velocitiesRef.current.set(pointer.id, { x: 0, y: 0 });
        simulationAlphaRef.current = .72;
        setPositions(new Map(positionsRef.current));
      }
    } else {
      setViewport((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
    }
  }

  function endPointer(event: ReactPointerEvent<SVGElement>) {
    const pointer = pointerState.current;
    if (pointer?.kind === "node" && pointer.id && !pointer.moved) setSelectedId(pointer.id);
    if (pointer?.kind === "pan" && !pointer.moved) setSelectedId(null);
    pointerState.current = null;
    simulationAlphaRef.current = Math.max(.48, simulationAlphaRef.current);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const visibleIds = activeNodeId ? selectedConnections : null;

  return (
    <div className="graph-page">
      <aside className={`graph-controls ${showControls ? "" : "collapsed"}`}>
        {showControls ? <>
        <div className="graph-controls-heading"><span><SlidersHorizontal size={13} />Graph controls</span><button type="button" aria-label="그래프 설정 접기" onClick={() => setShowControls(false)}><ChevronLeft size={14} /></button></div>
        <div className="graph-search">
          <Search size={14} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="노드 검색" aria-label="그래프 노드 검색" />
          {query && <button type="button" aria-label="검색어 지우기" onClick={() => setQuery("")}><X size={13} /></button>}
        </div>
        <div className="graph-stats">
          <div><strong>{snapshot?.nodeCount ?? 0}</strong><span>전체 노드</span></div>
          <div><strong>{snapshot?.edgeCount ?? 0}</strong><span>전체 연결</span></div>
        </div>
        <div className="graph-filter-heading"><strong>노드 유형</strong><button type="button" onClick={() => setEnabledTypes(new Set(contextGraphNodeTypes))}>전체</button></div>
        <div className="graph-type-filters">
          {contextGraphNodeTypes.map((type) => {
            const count = snapshot?.nodes.filter((node) => node.nodeType === type).length ?? 0;
            return (
              <button type="button" className={enabledTypes.has(type) ? "active" : ""} key={type} onClick={() => toggleType(type)}>
                <i style={{ background: nodeColors[type] }} /><span>{graphNodeTypeLabels[type]}</span><b>{count}</b>
              </button>
            );
          })}
        </div>
        <div className="graph-legend"><span><i className="explicit" />직접 연결</span><span><i className="inferred" />추론 연결</span></div>
        <label className="graph-isolated-toggle">
          <input type="checkbox" checked={showIsolated} onChange={(event) => setShowIsolated(event.target.checked)} />
          <span>연결 없는 노드도 표시</span>
        </label>
        <p>전체 {snapshot?.nodeCount ?? 0}개 중 연결도가 높은 노드 최대 240개를 불러옵니다.</p>
        </> : <button className="graph-controls-open" type="button" aria-label="그래프 설정 열기" onClick={() => setShowControls(true)}><SlidersHorizontal size={15} /></button>}
      </aside>

      <section className="graph-stage" aria-label="컨텍스트 그래프">
        <div className="graph-stage-toolbar">
          <div className="graph-view-mode">
            <button type="button" className={!localOnly ? "active" : ""} onClick={() => setLocalOnly(false)}>전체 그래프</button>
            <button type="button" className={localOnly ? "active" : ""} disabled={!selectedId} onClick={() => setLocalOnly(true)}>로컬 그래프</button>
          </div>
          <span className="graph-live-status">Live · {filtered.nodes.length} nodes · {filtered.edges.length} links</span>
          <div>
            <button type="button" title="축소" aria-label="축소" onClick={() => setViewport((current) => ({ ...current, scale: Math.max(.35, current.scale - .15) }))}><Minus size={14} /></button>
            <button type="button" title="화면 맞춤" aria-label="화면 맞춤" onClick={() => setViewport(fitGraphViewport(positions, size.width, size.height))}><Focus size={14} /></button>
            <button type="button" title="확대" aria-label="확대" onClick={() => setViewport((current) => ({ ...current, scale: Math.min(2.8, current.scale + .15) }))}><Plus size={14} /></button>
            <button type="button" title="그래프 새로고침" aria-label="그래프 새로고침" disabled={isLoading} onClick={() => void refresh()}><RefreshCw size={14} className={isLoading ? "spin" : ""} /></button>
          </div>
        </div>
        {error ? (
          <div className="graph-state"><strong>그래프를 불러오지 못했습니다.</strong><span>{error}</span><button type="button" onClick={() => void refresh()}>다시 시도</button></div>
        ) : isLoading && !snapshot ? (
          <div className="graph-state"><RefreshCw className="spin" size={22} /><strong>연결 그래프 구성 중…</strong><span>최신 업무 컨텍스트를 불러오고 있습니다.</span></div>
        ) : filtered.nodes.length === 0 ? (
          <div className="graph-state"><strong>{query ? "검색 결과가 없습니다." : "표시할 연결이 없습니다."}</strong><span>{query ? "다른 키워드로 검색해보세요." : "Task에 Jira, Slack 또는 AI 세션을 연결하면 여기에 나타납니다."}</span></div>
        ) : (
          <svg
            ref={canvasRef}
            className="graph-canvas"
            onWheel={handleWheel}
            onPointerDown={(event) => beginPointer(event, "pan")}
            onPointerMove={movePointer}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            onPointerLeave={() => { pointerGraphRef.current = null; setHoveredId(null); }}
            onDoubleClick={() => setViewport(fitGraphViewport(positions, size.width, size.height))}
          >
            <defs>
              <filter id="graph-glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            </defs>
            <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
              {filtered.edges.map((edge) => {
                const from = positions.get(edge.fromNodeId);
                const to = positions.get(edge.toNodeId);
                if (!from || !to) return null;
                const emphasized = activeNodeId ? edge.fromNodeId === activeNodeId || edge.toNodeId === activeNodeId : true;
                return <line key={edge.id} className={`graph-edge ${edge.derivation} ${emphasized ? "emphasized" : "muted"}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} strokeWidth={Math.max(.65, edge.weight * 1.6)} />;
              })}
              {filtered.nodes.map((node) => {
                const point = positions.get(node.id);
                if (!point) return null;
                const degree = degrees.get(node.id) ?? 0;
                const radius = Math.min(9.5, 3.2 + Math.sqrt(degree) * 1.15 + (node.nodeType === "task" ? 1.2 : 0));
                const selected = node.id === selectedId;
                const muted = Boolean(visibleIds && !visibleIds.has(node.id));
                const matched = filtered.matchedIds.has(node.id);
                const showLabel = selected || matched || node.nodeType === "task" || degree >= 4;
                const placeLabelLeft = point.x > size.width * .76;
                return (
                  <g
                    key={node.id}
                    className={`graph-node ${selected ? "selected" : ""} ${muted ? "muted" : ""} ${matched ? "matched" : ""}`}
                    transform={`translate(${point.x} ${point.y})`}
                    onPointerDown={(event) => { event.stopPropagation(); beginPointer(event, "node", node.id); }}
                    onPointerUp={(event) => { event.stopPropagation(); endPointer(event); }}
                    onClick={(event) => { event.stopPropagation(); setSelectedId(node.id); }}
                    onPointerEnter={() => { setHoveredId(node.id); simulationAlphaRef.current = Math.max(.42, simulationAlphaRef.current); }}
                    onPointerLeave={() => setHoveredId((current) => current === node.id ? null : current)}
                    role="button"
                    tabIndex={0}
                    aria-label={`${graphNodeTypeLabels[node.nodeType]} ${node.label}`}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedId(node.id); }}
                  >
                    <circle className="graph-node-halo" r={radius + 6} fill={nodeColors[node.nodeType]} />
                    <circle className="graph-node-dot" r={radius} fill={nodeColors[node.nodeType]} filter={selected ? "url(#graph-glow)" : undefined} />
                    {showLabel && <text x={placeLabelLeft ? -(radius + 7) : radius + 7} y="4" textAnchor={placeLabelLeft ? "end" : "start"}>{truncate(node.label, 34)}</text>}
                  </g>
                );
              })}
            </g>
          </svg>
        )}
        <div className="graph-help">마우스로 신경망 반응 · 노드 드래그 · 스크롤 확대/축소</div>
      </section>

      {selectedNode && <GraphInspector node={selectedNode} neighbors={neighbors} onClose={() => setSelectedId(null)} onSelect={(node) => setSelectedId(node.id)} />}
    </div>
  );
}
