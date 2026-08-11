export interface SlackMessage {
  id: string;
  channelId: string;
  channelName: string;
  userName: string;
  text: string;
  permalink: string;
  messageTs: string;
  discoveredAt: string;
}

export interface SlackSearchResult {
  query: string;
  messages: Omit<SlackMessage, "discoveredAt">[];
}
