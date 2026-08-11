import { describe, expect, test } from "bun:test";
import type { SlackMessage } from "../../../entities/work-context/model/slack-message";
import {
  approveSlackTaskConversion,
  createSlackTaskConversionPreview,
  type SlackTaskConversionPorts,
} from "../../../features/sources/slack-task-conversion";

const message: SlackMessage = {
  id: "C123:1722927600.000100",
  channelId: "C123",
  channelName: "cgkr-alerts",
  userName: "operator",
  text: "피킹 슬립 오류를 확인해주세요.\n재현 주문은 1234입니다.",
  permalink: "https://colosseum.slack.com/archives/C123/p1722927600000100?thread_ts=ignored#reply",
  messageTs: "1722927600.000100",
  discoveredAt: "2026-08-06T00:00:00.000Z",
};

function fakePorts(existingWorkItemId: string | null = null) {
  let slackWriteCalls = 0;
  let localCreateCalls = 0;
  const slack = {
    async readByPermalink() { return message; },
    async postMessage() { slackWriteCalls += 1; },
  };
  const ports: SlackTaskConversionPorts = {
    slack,
    local: {
      async findWorkItemBySourceIdentity() { return existingWorkItemId; },
      async createWorkItemWithSlackLink() { localCreateCalls += 1; return "task-1"; },
    },
  };
  return {
    ports,
    counts: () => ({ slackWriteCalls, localCreateCalls }),
  };
}

describe("Slack to Task approval boundary", () => {
  test("uses the canonical permalink as the exact local source identity", () => {
    const preview = createSlackTaskConversionPreview(message);
    expect(preview.permalink).toBe("https://colosseum.slack.com/archives/C123/p1722927600000100");
    expect(preview.sourceIdentity).toBe(`slack:${preview.permalink}`);
    expect(preview.title).toBe("피킹 슬립 오류를 확인해주세요.");
    expect(preview.goal.length).toBeLessThanOrEqual(280);
  });

  test("creates one local Task and never invokes a Slack write", async () => {
    const fake = fakePorts();
    const preview = createSlackTaskConversionPreview(message);
    const result = await approveSlackTaskConversion(preview, preview.approvalHash, fake.ports);
    expect(result).toEqual({ workItemId: "task-1", created: true, sourceIdentity: preview.sourceIdentity });
    expect(fake.counts()).toEqual({ slackWriteCalls: 0, localCreateCalls: 1 });
  });

  test("returns the existing exact permalink link idempotently", async () => {
    const fake = fakePorts("task-existing");
    const preview = createSlackTaskConversionPreview(message);
    const result = await approveSlackTaskConversion(preview, preview.approvalHash, fake.ports);
    expect(result.created).toBe(false);
    expect(result.workItemId).toBe("task-existing");
    expect(fake.counts()).toEqual({ slackWriteCalls: 0, localCreateCalls: 0 });
  });

  test("rejects cancellation/tampering without a local or external write", async () => {
    const fake = fakePorts();
    const preview = { ...createSlackTaskConversionPreview(message), title: "tampered" };
    await expect(approveSlackTaskConversion(preview, preview.approvalHash, fake.ports)).rejects.toThrow("변경되었습니다");
    expect(fake.counts()).toEqual({ slackWriteCalls: 0, localCreateCalls: 0 });
  });

  test("expires approval when the Slack source message changed", async () => {
    const fake = fakePorts();
    fake.ports.slack.readByPermalink = async () => ({ ...message, text: "수정된 요청" });
    const preview = createSlackTaskConversionPreview(message);
    await expect(approveSlackTaskConversion(preview, preview.approvalHash, fake.ports)).rejects.toThrow("원문이");
    expect(fake.counts()).toEqual({ slackWriteCalls: 0, localCreateCalls: 0 });
  });

  test("rejects non-Slack and non-message links", () => {
    expect(() => createSlackTaskConversionPreview({ ...message, permalink: "https://example.com/archives/C123/p1" })).toThrow("Slack permalink");
    expect(() => createSlackTaskConversionPreview({ ...message, permalink: "https://colosseum.slack.com/files/U123/F123" })).toThrow("메시지 permalink");
  });
});
