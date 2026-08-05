import { expect, test } from "bun:test";
import { readStoredSlackConnection, storeSlackConnection } from "./slack-connection";

test("Slack 연결 식별 정보를 설정에 저장하고 복원한다", () => {
  const connection = { workspaceName: "Colosseum", workspaceId: "T123", userName: "Changjun", userId: "U123" };
  expect(readStoredSlackConnection(storeSlackConnection(connection))).toEqual(connection);
});

test("불완전한 Slack 연결 정보는 연결됨으로 표시하지 않는다", () => {
  expect(readStoredSlackConnection({ slack_workspace: "Colosseum" })).toBeNull();
});
