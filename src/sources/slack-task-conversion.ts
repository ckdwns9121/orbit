import type { SlackMessage } from "../domain/slack-message";

export interface SlackTaskConversionPreview {
  source: "slack";
  sourceIdentity: string;
  permalink: string;
  messageId: string;
  title: string;
  goal: string;
  channelLabel: string;
  approvalHash: string;
}

export interface SlackTaskConversionResult {
  workItemId: string;
  created: boolean;
  sourceIdentity: string;
}

export interface SlackReadPort {
  readByPermalink(permalink: string): Promise<SlackMessage | null>;
}

export interface LocalSlackTaskPort {
  findWorkItemBySourceIdentity(sourceIdentity: string): Promise<string | null>;
  createWorkItemWithSlackLink(input: {
    title: string;
    goal: string;
    sourceIdentity: string;
    permalink: string;
    messageId: string;
    channelLabel: string;
  }): Promise<string>;
}

export interface SlackTaskConversionPorts {
  slack: SlackReadPort;
  local: LocalSlackTaskPort;
}

function canonicalSlackPermalink(rawPermalink: string) {
  let url: URL;
  try {
    url = new URL(rawPermalink.trim());
  } catch {
    throw new Error("Slack 원문 링크를 확인해주세요.");
  }
  const hostname = url.hostname.toLocaleLowerCase();
  if (url.protocol !== "https:" || (hostname !== "slack.com" && !hostname.endsWith(".slack.com"))) {
    throw new Error("https Slack permalink만 Task로 전환할 수 있습니다.");
  }
  if (!url.pathname.startsWith("/archives/") || url.pathname.split("/").filter(Boolean).length < 3) {
    throw new Error("Slack 메시지 permalink 형식이 아닙니다.");
  }
  url.hostname = hostname;
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function boundedText(value: string, limit: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function stableHash(value: string) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

function previewHash(input: Omit<SlackTaskConversionPreview, "approvalHash">) {
  return stableHash([
    "slack-task-conversion-v1",
    input.sourceIdentity,
    input.messageId,
    input.title,
    input.goal,
    input.channelLabel,
  ].join("\u001f"));
}

export function createSlackTaskConversionPreview(message: SlackMessage): SlackTaskConversionPreview {
  const permalink = canonicalSlackPermalink(message.permalink);
  const sourceIdentity = `slack:${permalink}`;
  const excerpt = boundedText(message.text, 240);
  const title = boundedText(message.text.split("\n").find((line) => line.trim()) ?? "Slack 요청", 120) || "Slack 요청";
  const channelLabel = boundedText(message.channelName, 80) || message.channelId;
  const previewWithoutHash = {
    source: "slack" as const,
    sourceIdentity,
    permalink,
    messageId: boundedText(message.id, 200),
    title,
    goal: excerpt ? `Slack #${channelLabel} 요청: ${excerpt}` : `Slack #${channelLabel}에서 받은 요청을 확인합니다.`,
    channelLabel,
  };
  return { ...previewWithoutHash, approvalHash: previewHash(previewWithoutHash) };
}

function assertApprovedPreview(preview: SlackTaskConversionPreview, approvedHash: string) {
  const { approvalHash: _, ...withoutHash } = preview;
  if (approvedHash !== preview.approvalHash || previewHash(withoutHash) !== preview.approvalHash) {
    throw new Error("승인한 Slack Task 미리보기가 변경되었습니다. 다시 확인해주세요.");
  }
}

export async function approveSlackTaskConversion(
  preview: SlackTaskConversionPreview,
  approvedHash: string,
  ports: SlackTaskConversionPorts,
): Promise<SlackTaskConversionResult> {
  assertApprovedPreview(preview, approvedHash);

  const existingWorkItemId = await ports.local.findWorkItemBySourceIdentity(preview.sourceIdentity);
  if (existingWorkItemId) {
    return { workItemId: existingWorkItemId, created: false, sourceIdentity: preview.sourceIdentity };
  }

  // The source boundary is intentionally read-only. Slack is never mutated by conversion.
  const sourceMessage = await ports.slack.readByPermalink(preview.permalink);
  if (!sourceMessage || canonicalSlackPermalink(sourceMessage.permalink) !== preview.permalink) {
    throw new Error("Slack 원문을 확인할 수 없어 Task를 만들지 않았습니다.");
  }
  if (createSlackTaskConversionPreview(sourceMessage).approvalHash !== preview.approvalHash) {
    throw new Error("Slack 원문이 미리보기 이후 변경되었습니다. 다시 확인해주세요.");
  }
  const workItemId = await ports.local.createWorkItemWithSlackLink({
    title: preview.title,
    goal: preview.goal,
    sourceIdentity: preview.sourceIdentity,
    permalink: preview.permalink,
    messageId: preview.messageId,
    channelLabel: preview.channelLabel,
  });
  return { workItemId, created: true, sourceIdentity: preview.sourceIdentity };
}
