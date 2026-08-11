import { describe, expect, test } from "bun:test";
import type { ContextGraphEdge, ContextGraphNode } from "./context-graph";
import { advanceGraphSimulation, connectedNodeIds, createGraphLayout, createGraphVelocities, filterGraph, fitGraphViewport, graphDegrees } from "./graph-visualization";

const nodes: ContextGraphNode[] = [
  { id: "task:1", nodeType: "task", sourceType: "task", sourceId: "1", label: "결제 오류", body: "checkout", url: null, occurredAt: null, updatedAt: null, metadata: {} },
  { id: "jira:A-1", nodeType: "jira_issue", sourceType: "jira", sourceId: "A-1", label: "A-1 결제", body: "", url: null, occurredAt: null, updatedAt: null, metadata: {} },
  { id: "slack:1", nodeType: "slack_message", sourceType: "slack", sourceId: "1", label: "#dev", body: "배포 이야기", url: null, occurredAt: null, updatedAt: null, metadata: {} },
];
const edges: ContextGraphEdge[] = [
  { id: "e1", fromNodeId: "task:1", toNodeId: "jira:A-1", relationType: "TRACKED_BY", derivation: "explicit", weight: 1, evidence: {} },
];

describe("graph visualization", () => {
  test("counts visible connections and returns direct neighbors", () => {
    expect(graphDegrees(nodes, edges).get("task:1")).toBe(1);
    expect([...connectedNodeIds("task:1", edges)]).toEqual(["task:1", "jira:A-1"]);
  });

  test("search keeps matches and their immediate context", () => {
    const result = filterGraph(nodes, edges, new Set(nodes.map((node) => node.nodeType)), "결제 오류");
    expect(result.nodes.map((node) => node.id)).toEqual(["task:1", "jira:A-1"]);
    expect(result.matchedIds.has("task:1")).toBe(true);
  });

  test("type filters remove dangling edges", () => {
    const result = filterGraph(nodes, edges, new Set(["task"]), "");
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(0);
  });

  test("layout is deterministic and remains inside the canvas", () => {
    const first = createGraphLayout(nodes, edges, 800, 500);
    const second = createGraphLayout(nodes, edges, 800, 500);
    expect(first).toEqual(second);
    for (const point of first.values()) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(800);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(500);
    }
  });

  test("fits an off-center layout into the viewport", () => {
    const viewport = fitGraphViewport(new Map([
      ["a", { x: 700, y: 300 }],
      ["b", { x: 900, y: 500 }],
    ]), 800, 600);
    expect(viewport.scale).toBeGreaterThan(0);
    expect((700 + 900) / 2 * viewport.scale + viewport.x).toBeCloseTo(400);
    expect((300 + 500) / 2 * viewport.scale + viewport.y).toBeCloseTo(300);
  });

  test("simulation pulls linked nodes together and repels nodes near the pointer", () => {
    const positions = new Map([
      ["task:1", { x: 100, y: 250 }],
      ["jira:A-1", { x: 700, y: 250 }],
      ["slack:1", { x: 400, y: 250 }],
    ]);
    const velocities = createGraphVelocities(nodes);
    const initialLinkDistance = positions.get("jira:A-1")!.x - positions.get("task:1")!.x;
    const initialSlackX = positions.get("slack:1")!.x;
    for (let frame = 0; frame < 80; frame += 1) {
      advanceGraphSimulation(nodes, edges, positions, velocities, {
        width: 800, height: 500, alpha: .8, pointer: { x: 380, y: 250 }, timeMs: frame * 16,
      });
    }
    expect(positions.get("jira:A-1")!.x - positions.get("task:1")!.x).toBeLessThan(initialLinkDistance);
    expect(positions.get("slack:1")!.x).toBeGreaterThan(initialSlackX);
  });
});
