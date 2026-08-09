import type { ContextGraphEdge, ContextGraphNode, ContextGraphNodeType } from "./context-graph";

export interface GraphPoint {
  x: number;
  y: number;
}

export interface GraphViewport {
  x: number;
  y: number;
  scale: number;
}

export interface GraphVelocity {
  x: number;
  y: number;
}

export interface GraphSimulationOptions {
  width: number;
  height: number;
  alpha: number;
  pointer?: GraphPoint | null;
  fixedNodeId?: string | null;
  timeMs?: number;
}

export const graphNodeTypeLabels: Record<ContextGraphNodeType, string> = {
  task: "Task",
  jira_issue: "Jira",
  pull_request: "Pull Request",
  github_commit: "Commit",
  slack_message: "Slack",
  confluence_page: "Confluence",
  calendar_event: "Calendar",
  ai_session: "AI Session",
};

export function graphDegrees(nodes: ContextGraphNode[], edges: ContextGraphEdge[]): Map<string, number> {
  const visible = new Set(nodes.map((node) => node.id));
  const degrees = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (!visible.has(edge.fromNodeId) || !visible.has(edge.toNodeId)) continue;
    degrees.set(edge.fromNodeId, (degrees.get(edge.fromNodeId) ?? 0) + 1);
    degrees.set(edge.toNodeId, (degrees.get(edge.toNodeId) ?? 0) + 1);
  }
  return degrees;
}

export function connectedNodeIds(nodeId: string, edges: ContextGraphEdge[]): Set<string> {
  const connected = new Set<string>([nodeId]);
  for (const edge of edges) {
    if (edge.fromNodeId === nodeId) connected.add(edge.toNodeId);
    if (edge.toNodeId === nodeId) connected.add(edge.fromNodeId);
  }
  return connected;
}

export function filterGraph(
  nodes: ContextGraphNode[],
  edges: ContextGraphEdge[],
  enabledTypes: Set<ContextGraphNodeType>,
  query: string,
): { nodes: ContextGraphNode[]; edges: ContextGraphEdge[]; matchedIds: Set<string> } {
  const normalized = query.normalize("NFKC").toLocaleLowerCase().trim();
  const typeNodes = nodes.filter((node) => enabledTypes.has(node.nodeType));
  const typeIds = new Set(typeNodes.map((node) => node.id));
  const typeEdges = edges.filter((edge) => typeIds.has(edge.fromNodeId) && typeIds.has(edge.toNodeId));
  if (!normalized) return { nodes: typeNodes, edges: typeEdges, matchedIds: new Set() };

  const directMatches = new Set(typeNodes.filter((node) => (
    `${node.sourceId} ${node.label} ${node.body}`.normalize("NFKC").toLocaleLowerCase().includes(normalized)
  )).map((node) => node.id));
  const included = new Set(directMatches);
  for (const edge of typeEdges) {
    if (directMatches.has(edge.fromNodeId)) included.add(edge.toNodeId);
    if (directMatches.has(edge.toNodeId)) included.add(edge.fromNodeId);
  }
  return {
    nodes: typeNodes.filter((node) => included.has(node.id)),
    edges: typeEdges.filter((edge) => included.has(edge.fromNodeId) && included.has(edge.toNodeId)),
    matchedIds: directMatches,
  };
}

function seededUnit(seed: string, salt: number): number {
  let hash = 2166136261 ^ salt;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}

export function createGraphLayout(
  nodes: ContextGraphNode[],
  edges: ContextGraphEdge[],
  width = 1_100,
  height = 700,
): Map<string, GraphPoint> {
  if (nodes.length === 0) return new Map();
  const degrees = graphDegrees(nodes, edges);
  const positions = new Map<string, GraphPoint>();
  const centerX = width / 2;
  const centerY = height / 2;
  const ordered = [...nodes].sort((left, right) => (degrees.get(right.id) ?? 0) - (degrees.get(left.id) ?? 0));
  for (const [index, node] of ordered.entries()) {
    const angle = index * 2.399963 + seededUnit(node.id, 7) * .35;
    const ring = index === 0 ? 0 : 28 * Math.sqrt(index);
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * ring,
      y: centerY + Math.sin(angle) * ring,
    });
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (let iteration = 0; iteration < 180; iteration += 1) {
    const movement = new Map(nodes.map((node) => [node.id, { x: 0, y: 0 }]));
    for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
      const left = ordered[leftIndex];
      const leftPoint = positions.get(left.id)!;
      for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
        const right = ordered[rightIndex];
        const rightPoint = positions.get(right.id)!;
        const dx = leftPoint.x - rightPoint.x || 0.1;
        const dy = leftPoint.y - rightPoint.y || 0.1;
        const distanceSquared = Math.max(144, dx * dx + dy * dy);
        const force = Math.min(5.2, 6_400 / distanceSquared);
        const distance = Math.sqrt(distanceSquared);
        movement.get(left.id)!.x += (dx / distance) * force;
        movement.get(left.id)!.y += (dy / distance) * force;
        movement.get(right.id)!.x -= (dx / distance) * force;
        movement.get(right.id)!.y -= (dy / distance) * force;
      }
    }
    for (const edge of edges) {
      if (!nodeById.has(edge.fromNodeId) || !nodeById.has(edge.toNodeId)) continue;
      const from = positions.get(edge.fromNodeId)!;
      const to = positions.get(edge.toNodeId)!;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const target = 105 + (1 - edge.weight) * 42;
      const force = (distance - target) * 0.024;
      movement.get(edge.fromNodeId)!.x += (dx / distance) * force;
      movement.get(edge.fromNodeId)!.y += (dy / distance) * force;
      movement.get(edge.toNodeId)!.x -= (dx / distance) * force;
      movement.get(edge.toNodeId)!.y -= (dy / distance) * force;
    }
    const temperature = Math.max(.22, 1 - iteration / 205);
    for (const node of nodes) {
      const point = positions.get(node.id)!;
      const delta = movement.get(node.id)!;
      const gravity = .006 + Math.min(0.006, (degrees.get(node.id) ?? 0) * .0007);
      const moveX = Math.max(-8, Math.min(8, delta.x + (centerX - point.x) * gravity));
      const moveY = Math.max(-8, Math.min(8, delta.y + (centerY - point.y) * gravity));
      point.x += moveX * temperature;
      point.y += moveY * temperature;
    }
  }
  const points = [...positions.values()];
  const bounds = points.reduce((result, point) => ({
    minX: Math.min(result.minX, point.x),
    maxX: Math.max(result.maxX, point.x),
    minY: Math.min(result.minY, point.y),
    maxY: Math.max(result.maxY, point.y),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  const offsetX = centerX - (bounds.minX + bounds.maxX) / 2;
  const offsetY = centerY - (bounds.minY + bounds.maxY) / 2;
  for (const point of points) {
    point.x = point.x + offsetX;
    point.y = point.y + offsetY;
  }
  return positions;
}

export function fitGraphViewport(
  positions: Map<string, GraphPoint>,
  width: number,
  height: number,
  padding = 90,
): GraphViewport {
  const points = [...positions.values()];
  if (points.length === 0) return { x: 0, y: 0, scale: 1 };
  const bounds = points.reduce((result, point) => ({
    minX: Math.min(result.minX, point.x),
    maxX: Math.max(result.maxX, point.x),
    minY: Math.min(result.minY, point.y),
    maxY: Math.max(result.maxY, point.y),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
  const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.max(.35, Math.min(1.15, (width - padding * 2) / contentWidth, (height - padding * 2) / contentHeight));
  return {
    scale,
    x: width / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
    y: height / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
  };
}

export function createGraphVelocities(nodes: ContextGraphNode[]): Map<string, GraphVelocity> {
  return new Map(nodes.map((node) => [node.id, { x: 0, y: 0 }]));
}

export function advanceGraphSimulation(
  nodes: ContextGraphNode[],
  edges: ContextGraphEdge[],
  positions: Map<string, GraphPoint>,
  velocities: Map<string, GraphVelocity>,
  options: GraphSimulationOptions,
): void {
  const { width, height, alpha, pointer = null, fixedNodeId = null, timeMs = 0 } = options;
  if (nodes.length === 0 || alpha <= 0) return;
  const centerX = width / 2;
  const centerY = height / 2;
  const forces = new Map(nodes.map((node) => [node.id, { x: 0, y: 0 }]));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const degrees = graphDegrees(nodes, edges);

  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = nodes[leftIndex];
    const leftPoint = positions.get(left.id);
    if (!leftPoint) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const right = nodes[rightIndex];
      const rightPoint = positions.get(right.id);
      if (!rightPoint) continue;
      const dx = rightPoint.x - leftPoint.x || .1;
      const dy = rightPoint.y - leftPoint.y || .1;
      const distanceSquared = Math.max(64, dx * dx + dy * dy);
      const distance = Math.sqrt(distanceSquared);
      const charge = Math.min(7, 5_600 / distanceSquared) * alpha;
      const collision = distance < 26 ? (26 - distance) * .09 : 0;
      const push = charge + collision;
      forces.get(left.id)!.x -= dx / distance * push;
      forces.get(left.id)!.y -= dy / distance * push;
      forces.get(right.id)!.x += dx / distance * push;
      forces.get(right.id)!.y += dy / distance * push;
    }
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) continue;
    const from = positions.get(edge.fromNodeId);
    const to = positions.get(edge.toNodeId);
    if (!from || !to) continue;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const target = 82 + (1 - edge.weight) * 45;
    const pull = (distance - target) * (.009 + edge.weight * .006) * alpha;
    forces.get(edge.fromNodeId)!.x += dx / distance * pull;
    forces.get(edge.fromNodeId)!.y += dy / distance * pull;
    forces.get(edge.toNodeId)!.x -= dx / distance * pull;
    forces.get(edge.toNodeId)!.y -= dy / distance * pull;
  }

  for (const node of nodes) {
    const point = positions.get(node.id);
    const force = forces.get(node.id);
    const velocity = velocities.get(node.id) ?? { x: 0, y: 0 };
    if (!point || !force) continue;
    const gravity = (.0009 + Math.min(6, degrees.get(node.id) ?? 0) * .00012) * alpha;
    force.x += (centerX - point.x) * gravity;
    force.y += (centerY - point.y) * gravity;
    const phase = timeMs / 1_800 + seededUnit(node.id, 31) * Math.PI * 2;
    force.x += Math.cos(phase) * .012 * alpha;
    force.y += Math.sin(phase) * .012 * alpha;
    if (pointer) {
      const dx = point.x - pointer.x;
      const dy = point.y - pointer.y;
      const distance = Math.max(8, Math.sqrt(dx * dx + dy * dy));
      if (distance < 145) {
        const proximity = (145 - distance) / 145;
        force.x += dx / distance * proximity * 2.8;
        force.y += dy / distance * proximity * 2.8;
      }
    }
    if (node.id === fixedNodeId) {
      velocities.set(node.id, { x: 0, y: 0 });
      continue;
    }
    velocity.x = Math.max(-5, Math.min(5, (velocity.x + force.x) * .88));
    velocity.y = Math.max(-5, Math.min(5, (velocity.y + force.y) * .88));
    point.x = Math.max(26, Math.min(width - 26, point.x + velocity.x));
    point.y = Math.max(26, Math.min(height - 26, point.y + velocity.y));
    velocities.set(node.id, velocity);
  }
}
