import { describe, expect, test } from "bun:test";
import {
  boundedGraphTraversal,
  canonicalGraphText,
  extractGraphDateRange,
  findJiraKeys,
  formatGraphContext,
  graphEdgeId,
  graphNodeId,
  graphQueryTokens,
  graphTokens,
  inferTaskSourceEdge,
  rankGraphCandidates,
  type ContextGraphEdge,
  type ContextGraphNode,
} from "./context-graph";

function node(overrides: Partial<ContextGraphNode>): ContextGraphNode {
  return {
    id: "task:t1",
    nodeType: "task",
    sourceType: "task",
    sourceId: "t1",
    label: "피킹 슬립 누락 수정",
    body: "CGKR-42 다음 행동 E2E 테스트",
    url: null,
    occurredAt: "2024-05-01T01:00:00.000Z",
    updatedAt: "2024-05-02T01:00:00.000Z",
    metadata: {},
    ...overrides,
  };
}

describe("context graph primitives", () => {
  test("normalizes Unicode text and produces stable composite identities", () => {
    expect(canonicalGraphText("  ＣＧＫＲ-42   테스트 ")).toBe("cgkr-42 테스트");
    expect(graphNodeId("jira", "cgkr-42")).toBe("jira:CGKR-42");
    expect(graphEdgeId("task:t1", "TRACKED_BY", "jira:CGKR-42")).toBe(graphEdgeId("task:t1", "TRACKED_BY", "jira:CGKR-42"));
    expect(graphTokens("슬랙에서 피킹 슬립 관련 내용 찾아줘")).toEqual(["슬랙에서", "피킹", "슬립"]);
    expect(graphQueryTokens("2024년에 작업 찾아줘")).toEqual([]);
    expect(graphQueryTokens("2024년에는 작업 찾아줘")).toEqual([]);
    expect(graphQueryTokens("2024-05-01 작업 찾아줘")).toEqual([]);
    expect(graphQueryTokens("2024-05-01부터 2024-05-03까지 작업 찾아줘")).toEqual([]);
    expect(graphQueryTokens("2024-05-01에서 2024-05-03까지 작업 찾아줘")).toEqual([]);
    expect(graphQueryTokens("유빈2024년 작업 찾아줘")).toEqual(["유빈"]);
  });

  test("extracts explicit day ranges and year ranges without imposing a default year", () => {
    expect(extractGraphDateRange("2024년에 작업 찾아줘")).toEqual({ from: "2024-01-01", toExclusive: "2025-01-01" });
    expect(extractGraphDateRange("2024-05-01부터 2024-05-03까지")).toEqual({ from: "2024-05-01", toExclusive: "2024-05-04" });
    expect(extractGraphDateRange("2024-02-31 작업")).toBeNull();
    expect(extractGraphDateRange("2024-05-03부터 2024-05-01까지")).toBeNull();
    expect(extractGraphDateRange("유빈 관련 대화 있어?")).toBeNull();
  });

  test("extracts Jira references and prefers key evidence over fuzzy overlap", () => {
    const jira = node({ id: "jira:CGKR-42", nodeType: "jira_issue", sourceType: "jira", sourceId: "CGKR-42", label: "피킹 누락", body: "" });
    expect(findJiraKeys("cgkr-42와 PAY-7 확인")).toEqual(["CGKR-42", "PAY-7"]);
    expect(inferTaskSourceEdge(node({}), jira)).toMatchObject({ relationType: "REFERENCES", derivation: "inferred", weight: 0.82 });
  });

  test("requires conservative title overlap and rejects a single generic match", () => {
    const related = node({ id: "slack:m1", nodeType: "slack_message", sourceType: "slack", sourceId: "m1", label: "피킹 슬립 상품 누락", body: "" });
    const weak = node({ id: "slack:m2", nodeType: "slack_message", sourceType: "slack", sourceId: "m2", label: "피킹 작업", body: "" });
    expect(inferTaskSourceEdge(node({ body: "" }), related)).toMatchObject({ relationType: "RELATED_TO", derivation: "inferred" });
    expect(inferTaskSourceEdge(node({ body: "" }), weak)).toBeNull();
  });

  test("ranks date-matching seeds and traverses explicit relations ahead of inferred ones", () => {
    const task = node({});
    const jira = node({ id: "jira:CGKR-42", nodeType: "jira_issue", sourceType: "jira", sourceId: "CGKR-42", label: "피킹 슬립 누락", body: "" });
    const slack = node({ id: "slack:m1", nodeType: "slack_message", sourceType: "slack", sourceId: "m1", label: "원인 논의", body: "피킹 슬립 누락 원인은 배치" });
    const outside = node({ id: "slack:m2", nodeType: "slack_message", sourceType: "slack", sourceId: "m2", occurredAt: "2025-01-01T00:00:00Z", label: "피킹 슬립", body: "" });
    const edges: ContextGraphEdge[] = [
      { id: "e1", fromNodeId: task.id, toNodeId: jira.id, relationType: "TRACKED_BY", derivation: "explicit", weight: 1, evidence: {} },
      { id: "e2", fromNodeId: task.id, toNodeId: slack.id, relationType: "RELATED_TO", derivation: "inferred", weight: 0.5, evidence: {} },
    ];
    const seeds = rankGraphCandidates("2024년 CGKR-42 찾아줘", [task, jira, slack, outside]);
    expect(seeds.some(({ node: item }) => item.id === outside.id)).toBeFalse();
    const results = boundedGraphTraversal(seeds, [task, jira, slack, outside], edges);
    expect(results.find(({ node: item }) => item.id === task.id)?.viaEdgeIds).toContain("e1");
    expect(results.findIndex(({ node: item }) => item.id === jira.id)).toBeLessThan(results.findIndex(({ node: item }) => item.id === slack.id));
  });

  test("uses a supplied year or day as a date-only seed filter", () => {
    const inside = node({ id: "task:inside", sourceId: "inside" });
    const outside = node({ id: "task:outside", sourceId: "outside", occurredAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z" });
    expect(rankGraphCandidates("2024년에 작업 찾아줘", [inside, outside]).map(({ node: item }) => item.id)).toEqual([inside.id]);
    expect(rankGraphCandidates("2024-05-01 작업 찾아줘", [inside, outside]).map(({ node: item }) => item.id)).toEqual([inside.id]);
    expect(rankGraphCandidates("2024-05-01부터 2024-05-03까지 작업 찾아줘", [inside, outside]).map(({ node: item }) => item.id)).toEqual([inside.id]);
    expect(rankGraphCandidates("2024-05-01에서 2024-05-03까지 작업 찾아줘", [inside, outside]).map(({ node: item }) => item.id)).toEqual([inside.id]);
  });

  test("formats URLs, relations and provenance without inventing empty evidence", () => {
    const task = node({ url: "https://example.test/task/t1" });
    const edge: ContextGraphEdge = { id: "e1", fromNodeId: task.id, toNodeId: "jira:CGKR-42", relationType: "TRACKED_BY", derivation: "explicit", weight: 1, evidence: {} };
    const context = formatGraphContext({ generationId: "g1", nodes: [{ node: task, score: 10, distance: 0, viaEdgeIds: ["e1"] }], edges: [edge] });
    expect(context).toContain("[피킹 슬립 누락 수정](https://example.test/task/t1)");
    expect(context).toContain("TRACKED_BY/explicit");
    expect(formatGraphContext({ generationId: "g1", nodes: [], edges: [] })).toContain("관계나 연결을 추론해서 만들지 마세요");
  });

  test("keeps traversal bounded and duplicate-free on a large cyclic graph", () => {
    const nodes = Array.from({ length: 10_000 }, (_, index) => node({
      id: `task:${index}`,
      sourceId: `${index}`,
      label: index === 0 ? "대규모 검색 시작점" : `노드 ${index}`,
      body: "",
    }));
    const edges = Array.from({ length: 50_000 }, (_, index): ContextGraphEdge => ({
      id: `edge:${index}`,
      fromNodeId: `task:${index % nodes.length}`,
      toNodeId: `task:${(index * 17 + 1) % nodes.length}`,
      relationType: "RELATED_TO",
      derivation: "inferred",
      weight: 0.5,
      evidence: {},
    }));
    const seeds = rankGraphCandidates("대규모 검색 시작점", nodes);
    const result = boundedGraphTraversal(seeds, nodes, edges, 2, 30);
    expect(result.length).toBeLessThanOrEqual(30);
    expect(new Set(result.map(({ node: item }) => item.id)).size).toBe(result.length);
  });
});
