import type { AppSettings } from "../../entities/work-context/api/settings-repository";

export type SlackConnection = {
  workspaceName: string;
  workspaceId: string;
  userName: string;
  userId: string;
};

export function readStoredSlackConnection(settings: AppSettings): SlackConnection | null {
  if (!settings.slack_workspace || !settings.slack_workspace_id || !settings.slack_user_name || !settings.slack_user_id) return null;
  return {
    workspaceName: settings.slack_workspace,
    workspaceId: settings.slack_workspace_id,
    userName: settings.slack_user_name,
    userId: settings.slack_user_id,
  };
}

export function storeSlackConnection(connection: SlackConnection): AppSettings {
  return {
    slack_workspace: connection.workspaceName,
    slack_workspace_id: connection.workspaceId,
    slack_user_name: connection.userName,
    slack_user_id: connection.userId,
  };
}

export const emptySlackConnectionSettings: AppSettings = {
  slack_workspace: "",
  slack_workspace_id: "",
  slack_user_name: "",
  slack_user_id: "",
};
