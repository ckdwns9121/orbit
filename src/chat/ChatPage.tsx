import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  initialContextSources,
  streamAnswerWithOrbitContext,
  type ContextSourceStatus,
} from "../data/chat-ai-repository";
import { appendChatMessage, createChatThread, deleteChatThread, listChatMessages, listChatThreads } from "../data/chat-repository";
import type { ChatMessage, ChatThread } from "../domain/chat";
import VirtualMessageList, { type DisplayMessage } from "./VirtualMessageList";
import "./ChatPage.scss";

function ContextStatusPanel({ sources, active }: { sources: ContextSourceStatus[]; active: boolean }) {
  const completed = sources.filter((source) => source.state === "complete");
  const collecting = sources.find((source) => source.state === "collecting");
  return <section className={`chat-context-panel ${active ? "active" : ""}`} aria-label="컨텍스트 수집 상태">
    <div className="chat-context-summary">
      <span className="chat-context-mark">⌘</span>
      <div><strong>연결 컨텍스트</strong><small>{collecting ? `${collecting.label} ${collecting.detail}` : active ? `${completed.length}개 소스 수집 완료` : "질문을 보내면 최신 로컬 컨텍스트를 확인합니다"}</small></div>
    </div>
    <div className="chat-context-sources">
      {sources.map((source) => <div className={`chat-context-source ${source.state}`} key={source.id}>
        <span>{source.state === "collecting" ? "" : source.state === "complete" ? "✓" : source.state === "error" ? "!" : "·"}</span>
        <div><strong>{source.label}</strong><small>{source.state === "pending" ? "응답 시 확인" : source.detail}</small></div>
      </div>)}
    </div>
  </section>;
}

export default function ChatPage() {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [isAnswering, setIsAnswering] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [contextSources, setContextSources] = useState(initialContextSources);
  const [contextStarted, setContextStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamBufferRef = useRef("");
  const streamFrameRef = useRef<number | null>(null);

  useEffect(() => { void refreshThreads(); }, []);
  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    void listChatMessages(activeId).then(setMessages).catch((cause) => setError(String(cause)));
  }, [activeId]);
  useEffect(() => () => {
    abortRef.current?.abort();
    if (streamFrameRef.current !== null) cancelAnimationFrame(streamFrameRef.current);
  }, []);

  const updateSource = useCallback((source: ContextSourceStatus) => {
    setContextSources((current) => current.map((item) => item.id === source.id ? source : item));
  }, []);

  const displayMessages = useMemo<DisplayMessage[]>(() => {
    const result: DisplayMessage[] = messages.map(({ id, role, content }) => ({ id, role, content }));
    if (isAnswering) result.push({ id: "streaming-assistant", role: "assistant", content: streamingContent, streaming: true });
    return result;
  }, [messages, isAnswering, streamingContent]);

  async function refreshThreads(selectId?: string) {
    const next = await listChatThreads();
    setThreads(next);
    setActiveId((current) => selectId ?? current ?? next[0]?.id ?? null);
  }

  function enqueueDelta(delta: string) {
    streamBufferRef.current += delta;
    if (streamFrameRef.current !== null) return;
    streamFrameRef.current = requestAnimationFrame(() => {
      setStreamingContent(streamBufferRef.current);
      streamFrameRef.current = null;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text || isAnswering) return;
    setQuestion("");
    setError(null);
    setIsAnswering(true);
    setStreamingContent("");
    streamBufferRef.current = "";
    setContextSources(initialContextSources);
    setContextStarted(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let threadId = activeId;
      if (!threadId) {
        const thread = await createChatThread(text);
        threadId = thread.id;
        setActiveId(threadId);
      }
      await appendChatMessage(threadId, "user", text);
      const withUser = await listChatMessages(threadId);
      setMessages(withUser);
      const answer = await streamAnswerWithOrbitContext(text, withUser.slice(0, -1), {
        signal: controller.signal,
        onDelta: enqueueDelta,
        onSource: updateSource,
      });
      if (streamFrameRef.current !== null) cancelAnimationFrame(streamFrameRef.current);
      streamFrameRef.current = null;
      setStreamingContent(answer.content);
      if (answer.content.trim()) {
        await appendChatMessage(threadId, "assistant", answer.content, answer.responseId ?? undefined);
      }
      setMessages(await listChatMessages(threadId));
      await refreshThreads(threadId);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      abortRef.current = null;
      setIsAnswering(false);
      setStreamingContent("");
      streamBufferRef.current = "";
    }
  }

  function startNewChat() {
    abortRef.current?.abort();
    setActiveId(null);
    setMessages([]);
    setContextSources(initialContextSources);
    setContextStarted(false);
    setError(null);
  }

  return <div className="chat-page">
    <aside className="chat-threads">
      <button className="new-chat-button" type="button" onClick={startNewChat}>＋ 새 대화</button>
      <div className="chat-thread-list">
        {threads.map((thread) => <div className={`chat-thread ${activeId === thread.id ? "active" : ""}`} key={thread.id}>
          <button type="button" onClick={() => setActiveId(thread.id)}><strong>{thread.title}</strong><small>{new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(new Date(thread.updatedAt))}</small></button>
          <button type="button" aria-label="대화 삭제" onClick={async () => { await deleteChatThread(thread.id); if (activeId === thread.id) setActiveId(null); await refreshThreads(); }}>×</button>
        </div>)}
      </div>
    </aside>
    <section className="chat-conversation">
      <ContextStatusPanel sources={contextSources} active={contextStarted} />
      {displayMessages.length === 0
        ? <div className="chat-empty"><span>✦</span><h2>Orbit에게 물어보세요</h2><p>Task, Calendar, Jira, GitHub, Slack, Confluence 컨텍스트를 모아 답합니다.</p><div><button onClick={() => setQuestion("오늘 일정과 우선순위를 정리해줘")}>오늘 일정과 우선순위</button><button onClick={() => setQuestion("2024년 온콜 관련 문서와 대화를 찾아줘")}>문서·대화 검색</button></div></div>
        : <VirtualMessageList messages={displayMessages} />}
      {error && <div className="chat-error">{error}</div>}
      <form className="chat-composer" onSubmit={submit}>
        <textarea value={question} disabled={isAnswering} onChange={(event) => setQuestion(event.target.value)} placeholder="오늘 일정 뭐야?" rows={2} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
        {isAnswering
          ? <button className="chat-cancel-button" type="button" onClick={() => abortRef.current?.abort()}><span /> 중단</button>
          : <button className="primary-button" disabled={!question.trim()}>↑</button>}
        <small>{isAnswering ? "답변을 실시간으로 생성하고 있습니다." : "연결된 업무 컨텍스트가 OpenAI로 전송됩니다. 답변은 캐시된 데이터 기준입니다."}</small>
      </form>
    </section>
  </div>;
}
