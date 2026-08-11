export const contextGraphNodeTypes = [
  "task",
  "jira_issue",
  "pull_request",
  "github_commit",
  "slack_message",
  "confluence_page",
  "calendar_event",
  "ai_session",
] as const;

export type ContextGraphNodeType = typeof contextGraphNodeTypes[number];
export type ContextGraphDerivation = "explicit" | "inferred" | "system";

export interface ContextGraphNode {
  id: string;
  nodeType: ContextGraphNodeType;
  sourceType: string;
  sourceId: string;
  label: string;
  body: string;
  url: string | null;
  occurredAt: string | null;
  updatedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface ContextGraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relationType: string;
  derivation: ContextGraphDerivation;
  weight: number;
  evidence: Record<string, unknown>;
}

export interface ContextGraphDateRange {
  from: string;
  toExclusive: string;
}

export interface RankedGraphNode {
  node: ContextGraphNode;
  score: number;
  distance: number;
  viaEdgeIds: string[];
}

export interface ContextGraphSearchResult {
  generationId: string;
  nodes: RankedGraphNode[];
  edges: ContextGraphEdge[];
}

const genericQueryTokens = new Set([
  "관련", "내용", "작업", "업무", "대화", "메시지", "문서", "검색", "확인",
  "찾아줘", "찾아봐", "알려줘", "있어", "있냐", "뭐야", "slack", "jira",
  "github", "confluence", "슬랙", "지라", "깃허브", "컨플루언스",
]);

export function canonicalGraphText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export function graphTokens(value: string): string[] {
  const matches = canonicalGraphText(value).match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? [];
  return [...new Set(matches.filter((token) => token.length > 1 && !genericQueryTokens.has(token)).map((token) => token.slice(0, 120)))];
}

export function graphQueryTokens(question: string): string[] {
  const withoutDates = question
    .replace(/20\d{2}-\d{2}-\d{2}\s*(?:~|부터|에서)\s*20\d{2}-\d{2}-\d{2}(?:까지)?/g, " ")
    .replace(/20\d{2}-\d{2}-\d{2}(?:부터|에서|까지|에는|에|의)?/g, " ")
    .replace(/20\d{2}년(?:에는|에|의|도)?/g, " ");
  return graphTokens(withoutDates).slice(0, 12);
}

function nextYear(year: number): string {
  return `${year + 1}-01-01`;
}

function nextIsoDay(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function validIsoDay(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function extractGraphDateRange(question: string): ContextGraphDateRange | null {
  const explicitRange = question.match(/\b(20\d{2}-\d{2}-\d{2})\s*(?:~|부터|에서)\s*(20\d{2}-\d{2}-\d{2})/);
  if (explicitRange) {
    if (!validIsoDay(explicitRange[1]) || !validIsoDay(explicitRange[2]) || explicitRange[1] > explicitRange[2]) return null;
    return { from: explicitRange[1], toExclusive: nextIsoDay(explicitRange[2]) };
  }
  const day = question.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (day) return validIsoDay(day[1]) ? { from: day[1], toExclusive: nextIsoDay(day[1]) } : null;
  const year = question.match(/(?:^|\D)(20\d{2})(?:년|\D|$)/)?.[1];
  return year ? { from: `${year}-01-01`, toExclusive: nextYear(Number(year)) } : null;
}

function normalizedSourceId(sourceType: string, sourceId: string): string {
  if (sourceType === "jira" || sourceType === "jira_issue") return sourceId.toUpperCase();
  if (sourceType === "github_pr" || sourceType === "github_commit") return sourceId.toLocaleLowerCase();
  return sourceId;
}

export function graphNodeId(sourceType: string, sourceId: string): string {
  return `${sourceType}:${encodeURIComponent(normalizedSourceId(sourceType, sourceId).trim())}`;
}

export function graphEdgeId(fromNodeId: string, relationType: string, toNodeId: string): string {
  return [fromNodeId, relationType, toNodeId].map(encodeURIComponent).join("|");
}

export function findJiraKeys(value: string): string[] {
  return [...new Set((value.match(/\b[A-Z][A-Z0-9]+-\d+\b/gi) ?? []).map((key) => key.toUpperCase()))];
}

export function inferTaskSourceEdge(task: ContextGraphNode, source: ContextGraphNode): ContextGraphEdge | null {
  if (task.nodeType !== "task" || source.nodeType === "task" || task.id === source.id) return null;
  const taskText = `${task.label} ${task.body}`;
  const sourceText = `${source.sourceId} ${source.label} ${source.body}`;
  const taskJira = new Set(findJiraKeys(taskText));
  const sharedJira = findJiraKeys(sourceText).find((key) => taskJira.has(key));
  if (sharedJira) {
    return {
      id: graphEdgeId(task.id, "REFERENCES", source.id),
      fromNodeId: task.id,
      toNodeId: source.id,
      relationType: "REFERENCES",
      derivation: "inferred",
      weight: 0.82,
      evidence: { rule: "shared_jira_key", value: sharedJira },
    };
  }

  const taskTokens = new Set(graphTokens(task.label));
  const sourceTokens = new Set(graphTokens(source.label));
  const shared = [...taskTokens].filter((token) => sourceTokens.has(token));
  const denominator = new Set([...taskTokens, ...sourceTokens]).size;
  const hasDistinctiveToken = shared.some((token) => /[^\x00-\x7F]/.test(token) ? token.length >= 2 : token.length >= 3);
  if (shared.length < 2 || denominator === 0 || shared.length / denominator < 0.3 || !hasDistinctiveToken) return null;
  return {
    id: graphEdgeId(task.id, "RELATED_TO", source.id),
    fromNodeId: task.id,
    toNodeId: source.id,
    relationType: "RELATED_TO",
    derivation: "inferred",
    weight: Math.min(0.7, 0.45 + shared.length * 0.05),
    evidence: { rule: "title_token_overlap", tokens: shared.slice(0, 8) },
  };
}

function withinRange(node: ContextGraphNode, range: ContextGraphDateRange | null): boolean {
  if (!range) return true;
  const timestamp = node.occurredAt ?? node.updatedAt;
  if (!timestamp) return false;
  const day = timestamp.slice(0, 10);
  return day >= range.from && day < range.toExclusive;
}

export function rankGraphCandidates(
  question: string,
  nodes: ContextGraphNode[],
  limit = 12,
): RankedGraphNode[] {
  const query = canonicalGraphText(question).slice(0, 500);
  const tokens = graphQueryTokens(question);
  const jiraKeys = findJiraKeys(question);
  const range = extractGraphDateRange(question);
  return nodes.flatMap((node): RankedGraphNode[] => {
    if (!withinRange(node, range)) return [];
    const label = canonicalGraphText(node.label);
    const body = canonicalGraphText(`${node.sourceId} ${node.body}`);
    let score = jiraKeys.includes(node.sourceId.toUpperCase()) ? 16 : 0;
    if (range && tokens.length === 0) score = node.nodeType === "task" ? 2 : 1;
    if (query && label.includes(query)) score += 10;
    let matchedTokens = 0;
    for (const token of tokens) {
      const sourceMatch = canonicalGraphText(node.sourceId) === token;
      const labelMatch = label.includes(token);
      const bodyMatch = body.includes(token);
      if (sourceMatch || labelMatch || bodyMatch) matchedTokens += 1;
      if (sourceMatch) score += 8;
      if (labelMatch) score += 4;
      if (bodyMatch) score += 1;
    }
    if (tokens.length > 1 && matchedTokens === tokens.length) score += 10;
    if (score <= 0) return [];
    return [{ node, score, distance: 0, viaEdgeIds: [] }];
  }).sort((left, right) => right.score - left.score
    || (right.node.updatedAt ?? right.node.occurredAt ?? "").localeCompare(left.node.updatedAt ?? left.node.occurredAt ?? ""))
    .slice(0, limit);
}

export function boundedGraphTraversal(
  seeds: RankedGraphNode[],
  nodes: ContextGraphNode[],
  edges: ContextGraphEdge[],
  maxDepth = 2,
  limit = 30,
): RankedGraphNode[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const adjacent = new Map<string, ContextGraphEdge[]>();
  for (const edge of edges) {
    adjacent.set(edge.fromNodeId, [...(adjacent.get(edge.fromNodeId) ?? []), edge]);
    adjacent.set(edge.toNodeId, [...(adjacent.get(edge.toNodeId) ?? []), edge]);
  }
  const best = new Map(seeds.map((seed) => [seed.node.id, seed]));
  let frontier = [...seeds];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next: RankedGraphNode[] = [];
    for (const current of frontier) {
      for (const edge of adjacent.get(current.node.id) ?? []) {
        const neighborId = edge.fromNodeId === current.node.id ? edge.toNodeId
          : edge.toNodeId === current.node.id ? edge.fromNodeId : null;
        const neighbor = neighborId ? nodesById.get(neighborId) : null;
        if (!neighbor) continue;
        const derivationBoost = edge.derivation === "explicit" ? 1 : edge.derivation === "system" ? 0.9 : 0.72;
        const score = current.score * edge.weight * derivationBoost * (depth === 1 ? 0.8 : 0.55);
        const candidate = { node: neighbor, score, distance: depth, viaEdgeIds: [...current.viaEdgeIds, edge.id] };
        if (score > (best.get(neighbor.id)?.score ?? 0)) {
          best.set(neighbor.id, candidate);
          next.push(candidate);
        }
      }
    }
    frontier = next;
  }
  return [...best.values()].sort((left, right) => right.score - left.score || left.distance - right.distance).slice(0, limit);
}

function safeContextValue(value: string, limit: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

export function formatGraphContext(result: ContextGraphSearchResult): string {
  if (result.nodes.length === 0) {
    return "[Knowledge Graph — 연결 근거]\n검색 결과: 질문과 연결된 그래프 근거가 없습니다.\n응답 규칙: 관계나 연결을 추론해서 만들지 마세요.";
  }
  const includedIds = new Set(result.nodes.map(({ node }) => node.id));
  const lines = result.nodes.map(({ node, distance, viaEdgeIds }) => {
    const link = node.url ? `[${safeContextValue(node.label, 240)}](${node.url})` : safeContextValue(node.label, 240);
    const relations = result.edges.filter((edge) => viaEdgeIds.includes(edge.id) || (
      includedIds.has(edge.fromNodeId) && includedIds.has(edge.toNodeId)
    )).filter((edge) => edge.fromNodeId === node.id || edge.toNodeId === node.id)
      .slice(0, 6)
      .map((edge) => `${edge.relationType}/${edge.derivation}`)
      .join(", ");
    return `- ${node.nodeType}: ${link} | source=${node.sourceType}:${node.sourceId} | time=${node.occurredAt ?? node.updatedAt ?? "unknown"} | distance=${distance}${relations ? ` | relations=${relations}` : ""}\n  ${safeContextValue(node.body, 700)}`;
  });
  return [
    "[Knowledge Graph — 연결 근거]",
    `검색 결과: ${result.nodes.length}개 노드. 명시적 연결을 추론 연결보다 우선하고 아래 근거 밖의 관계는 만들지 마세요.`,
    ...lines,
  ].join("\n").slice(0, 30_000);
}
