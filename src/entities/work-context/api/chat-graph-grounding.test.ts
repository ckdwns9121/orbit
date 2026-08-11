import { describe, expect, test } from "bun:test";
import type { ContextGraphSearchResult } from "../model/context-graph";
import {
  buildKnowledgeGraphGrounding,
  composeOrbitGrounding,
  initialContextSources,
  type ContextSourceStatus,
} from "./chat-ai-repository";

const emptyResult: ContextGraphSearchResult = { generationId: "g1", nodes: [], edges: [] };
const index = { generationId: "g1", sourceFingerprint: "fingerprint", nodeCount: 1, edgeCount: 0, rebuilt: false };

describe("Knowledge Graph Chat grounding", () => {
  test("adds graph status without changing the existing source order", () => {
    expect(initialContextSources.map(({ id }) => id)).toEqual([
      "tasks", "calendar", "jira", "github", "graph", "slack", "confluence",
    ]);
  });

  test("forwards the question and reports index and retrieval progress", async () => {
    const statuses: ContextSourceStatus[] = [];
    const questions: string[] = [];
    const result: ContextGraphSearchResult = {
      generationId: "g1",
      nodes: [{
        node: { id: "jira:CGKR-42", nodeType: "jira_issue", sourceType: "jira", sourceId: "CGKR-42", label: "CGKR-42", body: "피킹 슬립 누락", url: "https://jira/CGKR-42", occurredAt: "2024-01-01", updatedAt: "2024-01-02", metadata: {} },
        score: 10, distance: 0, viaEdgeIds: [],
      }],
      edges: [],
    };
    const context = await buildKnowledgeGraphGrounding("2024년 CGKR-42 찾아줘", (status) => statuses.push(status), {
      ensureIndex: async () => index,
      search: async (question) => { questions.push(question); return result; },
      format: (value) => `[Knowledge Graph] ${value.nodes[0].node.url}`,
    });

    expect(questions).toEqual(["2024년 CGKR-42 찾아줘"]);
    expect(statuses.map(({ state }) => state)).toEqual(["collecting", "collecting", "complete"]);
    expect(statuses[statuses.length - 1]?.count).toBe(1);
    expect(context).toContain("https://jira/CGKR-42");
  });

  test("keeps an explicit no-evidence section for an empty successful search", async () => {
    const statuses: ContextSourceStatus[] = [];
    const context = await buildKnowledgeGraphGrounding("없는 항목", (status) => statuses.push(status), {
      ensureIndex: async () => index,
      search: async () => emptyResult,
      format: () => "[Knowledge Graph] 근거 없음",
    });
    expect(context).toBe("[Knowledge Graph] 근거 없음");
    expect(statuses[statuses.length - 1]).toMatchObject({ state: "complete", count: 0 });
  });

  test("falls back without rejecting when indexing or search fails", async () => {
    const indexStatuses: ContextSourceStatus[] = [];
    const indexFailure = await buildKnowledgeGraphGrounding("질문", (status) => indexStatuses.push(status), {
      ensureIndex: async () => { throw new Error("database busy"); },
      search: async () => emptyResult,
      format: () => "unexpected",
    });
    expect(indexFailure).toBe("");
    expect(indexStatuses[indexStatuses.length - 1]).toMatchObject({ state: "error", detail: "database busy" });

    const searchFailure = await buildKnowledgeGraphGrounding("질문", () => undefined, {
      ensureIndex: async () => index,
      search: async () => { throw new Error("malformed graph"); },
      format: () => "unexpected",
    });
    expect(searchFailure).toBe("");
  });

  test("composition includes graph once and preserves legacy context byte-for-byte on failure", () => {
    expect(composeOrbitGrounding("base", "completion", "graph")).toBe("base\n\ncompletion\n\ngraph");
    expect(composeOrbitGrounding("base", "completion", "")).toBe("base\n\ncompletion");
  });
});
