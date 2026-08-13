import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  initialContextSources,
  resolveChatAgentApproval,
  streamAnswerWithOrbitContext,
  type ContextSourceStatus,
} from "../../entities/work-context/api/chat-ai-repository";
import { appendChatMessage, createChatThread, deleteChatThread, listChatMessages, listChatThreads } from "../../entities/work-context/api/chat-repository";
import { attachAgentApprovalsToMessage, listThreadAgentApprovals } from "../../entities/work-context/api/chat-agent-repository";
import {
  chooseOpenAiModel,
  fallbackOpenAiModels,
  listAvailableOpenAiModels,
  type OpenAiModelOption,
} from "../../entities/work-context/api/openai-model-repository";
import { getAppSettings, setAppSettings } from "../../entities/work-context/api/settings-repository";
import type { ChatMessage, ChatThread } from "../../entities/work-context/model/chat";
import type { ChatAgentApproval, ChatAgentStepView } from "../../entities/work-context/model/chat-agent";
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

function groupApprovalsByMessage(approvals: ChatAgentApproval[]): Record<string, ChatAgentApproval[]> {
  return approvals.reduce<Record<string, ChatAgentApproval[]>>((result, approval) => {
    if (!approval.messageId) return result;
    (result[approval.messageId] ||= []).push(approval);
    return result;
  }, {});
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
  const [models, setModels] = useState<OpenAiModelOption[]>(fallbackOpenAiModels);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [modelNotice, setModelNotice] = useState<string | null>(null);
  const [approvalsByMessage, setApprovalsByMessage] = useState<Record<string, ChatAgentApproval[]>>({});
  const [agentSteps, setAgentSteps] = useState<ChatAgentStepView[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const streamBufferRef = useRef("");
  const streamFrameRef = useRef<number | null>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const approvingTaskIdsRef = useRef(new Set<string>());

  useEffect(() => { void refreshThreads(); }, []);
  useEffect(() => {
    let active = true;
    void Promise.all([getAppSettings(), listAvailableOpenAiModels()])
      .then(async ([settings, available]) => {
        if (!active) return;
        const selected = chooseOpenAiModel(available, settings.openai_model);
        setModels(available);
        setSelectedModelId(selected.id);
        if (settings.openai_model !== selected.id) {
          await setAppSettings({ openai_model: selected.id });
          if (active && settings.openai_model) setModelNotice(`사용할 수 없는 ${settings.openai_model} 대신 ${selected.label}을 선택했습니다.`);
        }
      })
      .catch(async (cause) => {
        if (!active) return;
        const settings = await getAppSettings().catch(() => ({ openai_model: undefined }));
        const selected = chooseOpenAiModel(fallbackOpenAiModels, settings.openai_model);
        setModels(fallbackOpenAiModels);
        setSelectedModelId(selected.id);
        setModelNotice(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    void Promise.all([listChatMessages(activeId), listThreadAgentApprovals(activeId)]).then(([nextMessages, approvals]) => {
      setMessages(nextMessages);
      setApprovalsByMessage(groupApprovalsByMessage(approvals));
    }).catch((cause) => setError(String(cause)));
  }, [activeId]);
  useEffect(() => () => {
    abortRef.current?.abort();
    if (streamFrameRef.current !== null) cancelAnimationFrame(streamFrameRef.current);
  }, []);
  useEffect(() => {
    if (!isModelPickerOpen) return;
    const close = (event: PointerEvent) => {
      if (!modelPickerRef.current?.contains(event.target as Node)) setIsModelPickerOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [isModelPickerOpen]);

  const selectedModel = models.find((model) => model.id === selectedModelId) || chooseOpenAiModel(models);

  const updateSource = useCallback((source: ContextSourceStatus) => {
    setContextSources((current) => current.map((item) => item.id === source.id ? source : item));
  }, []);

  const displayMessages = useMemo<DisplayMessage[]>(() => {
    const result: DisplayMessage[] = messages.map(({ id, role, content }) => ({
      id,
      role,
      content,
      approvals: approvalsByMessage[id],
    }));
    if (isAnswering) result.push({ id: "streaming-assistant", role: "assistant", content: streamingContent, streaming: true });
    return result;
  }, [messages, isAnswering, streamingContent, approvalsByMessage]);

  const updateTaskProposal = useCallback((proposalId: string, update: (proposal: ChatAgentApproval) => ChatAgentApproval) => {
    setApprovalsByMessage((current) => Object.fromEntries(Object.entries(current).map(([messageId, proposals]) => [
      messageId,
      proposals.map((proposal) => proposal.id === proposalId ? update(proposal) : proposal),
    ])));
  }, []);

  const persistAgentContinuation = useCallback(async (threadId: string, answer: Awaited<ReturnType<typeof resolveChatAgentApproval>>) => {
    if (!answer) return;
    const content = answer.content.trim() || (answer.approvals.length ? "다음 변경 작업을 진행하려면 아래 승인 요청을 확인해주세요." : "");
    if (content) {
      const messageId = await appendChatMessage(threadId, "assistant", content, answer.responseId);
      if (answer.approvals.length) await attachAgentApprovalsToMessage(answer.runId, messageId);
    }
    const [nextMessages, approvals] = await Promise.all([listChatMessages(threadId), listThreadAgentApprovals(threadId)]);
    setMessages(nextMessages);
    setApprovalsByMessage(groupApprovalsByMessage(approvals));
  }, []);

  const approveTask = useCallback(async (proposalId: string) => {
    if (approvingTaskIdsRef.current.has(proposalId)) return;
    const proposal = Object.values(approvalsByMessage).flat().find((item) => item.id === proposalId);
    if (!proposal || (proposal.status !== "pending" && proposal.status !== "failed")) return;
    approvingTaskIdsRef.current.add(proposalId);
    updateTaskProposal(proposalId, (item) => ({ ...item, status: "executing", error: null }));
    try {
      setIsAnswering(true); setAgentSteps([]);
      const answer = await resolveChatAgentApproval(proposal, true, { onDelta: enqueueDelta, onSource: updateSource, onSteps: setAgentSteps });
      updateTaskProposal(proposalId, (item) => ({ ...item, status: "approved", error: null }));
      if (activeId) await persistAgentContinuation(activeId, answer);
    } catch (cause) {
      updateTaskProposal(proposalId, (item) => ({
        ...item,
        status: "failed",
        error: cause instanceof Error ? cause.message : String(cause),
      }));
    } finally {
      approvingTaskIdsRef.current.delete(proposalId);
      setIsAnswering(false); setStreamingContent(""); streamBufferRef.current = "";
    }
  }, [activeId, approvalsByMessage, persistAgentContinuation, updateSource, updateTaskProposal]);

  const rejectTask = useCallback((proposalId: string) => {
    if (approvingTaskIdsRef.current.has(proposalId)) return;
    const proposal = Object.values(approvalsByMessage).flat().find((item) => item.id === proposalId);
    if (!proposal) return;
    approvingTaskIdsRef.current.add(proposalId);
    setIsAnswering(true);
    setAgentSteps([]);
    updateTaskProposal(proposalId, (item) => item.status === "pending" || item.status === "failed"
      ? { ...item, status: "executing", error: null }
      : item);
    void resolveChatAgentApproval(proposal, false, { onDelta: enqueueDelta, onSource: updateSource, onSteps: setAgentSteps })
      .then(async (answer) => {
        updateTaskProposal(proposalId, (item) => ({ ...item, status: "rejected", error: null }));
        if (activeId) await persistAgentContinuation(activeId, answer);
      }).catch((cause) => updateTaskProposal(proposalId, (item) => ({ ...item, status: "failed", error: String(cause) })))
      .finally(() => {
        approvingTaskIdsRef.current.delete(proposalId);
        setIsAnswering(false);
        setStreamingContent("");
        streamBufferRef.current = "";
      });
  }, [activeId, approvalsByMessage, persistAgentContinuation, updateSource, updateTaskProposal]);

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
    if (!text || isAnswering || !selectedModel?.id) return;
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
      setAgentSteps([]);
      const answer = await streamAnswerWithOrbitContext(text, withUser.slice(0, -1), selectedModel.id, threadId, {
        signal: controller.signal,
        onDelta: enqueueDelta,
        onSource: updateSource,
        onSteps: setAgentSteps,
      });
      if (streamFrameRef.current !== null) cancelAnimationFrame(streamFrameRef.current);
      streamFrameRef.current = null;
      const assistantContent = answer.content.trim()
        ? answer.content
        : answer.approvals.length > 0
          ? "변경 작업을 진행하려면 아래 승인 요청을 확인해주세요."
          : "";
      setStreamingContent(assistantContent);
      if (assistantContent) {
        const assistantMessageId = await appendChatMessage(threadId, "assistant", assistantContent, answer.responseId ?? undefined);
        if (answer.approvals.length) await attachAgentApprovalsToMessage(answer.runId, assistantMessageId);
      }
      const nextMessages = await listChatMessages(threadId);
      setMessages(nextMessages);
      if (answer.approvals.length && nextMessages.length) setApprovalsByMessage((current) => ({ ...current, [nextMessages[nextMessages.length - 1].id]: answer.approvals }));
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
      {agentSteps.length > 0 && <section className="chat-agent-steps" aria-live="polite"><strong>에이전트 실행</strong>{agentSteps.map((step) => <span className={step.state} key={step.id}>{step.state === "complete" ? "✓" : step.state === "waiting" ? "…" : "·"} {step.label}</span>)}</section>}
      {displayMessages.length === 0
        ? <div className="chat-empty"><span>✦</span><h2>Orbit에게 물어보세요</h2><p>Task, Calendar, Jira, GitHub, Slack, Confluence를 연결한 Knowledge Graph로 답합니다.</p><div><button onClick={() => setQuestion("오늘 일정과 우선순위를 정리해줘")}>오늘 일정과 우선순위</button><button onClick={() => setQuestion("2024년 온콜 관련 문서와 대화를 찾아줘")}>문서·대화 검색</button></div></div>
        : <VirtualMessageList messages={displayMessages} onApproveTask={approveTask} onRejectTask={rejectTask} />}
      {error && <div className="chat-error">{error}</div>}
      <form className="chat-composer" onSubmit={submit}>
        <div className="chat-composer-toolbar">
          <div className="chat-model-picker" ref={modelPickerRef}>
            <button type="button" aria-haspopup="listbox" aria-expanded={isModelPickerOpen} disabled={isAnswering} onClick={() => setIsModelPickerOpen((current) => !current)}>
              <span>✦</span><strong>{selectedModel.label}</strong><small>{selectedModel.description}</small><i>⌄</i>
            </button>
            {isModelPickerOpen && (
              <div className="chat-model-menu" role="listbox" aria-label="OpenAI 모델 선택">
                <header><strong>응답 모델</strong><span>API 키에서 사용 가능한 모델</span></header>
                {models.map((model) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={model.id === selectedModel.id}
                    className={model.id === selectedModel.id ? "selected" : ""}
                    key={model.id}
                    onClick={async () => {
                      setSelectedModelId(model.id);
                      setIsModelPickerOpen(false);
                      setModelNotice(null);
                      try { await setAppSettings({ openai_model: model.id }); }
                      catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
                    }}
                  >
                    <span><strong>{model.label}</strong><small>{model.id}</small></span>
                    <em>{model.description}</em>
                    {model.id === selectedModel.id && <b>✓</b>}
                  </button>
                ))}
              </div>
            )}
          </div>
          {modelNotice && <span className="chat-model-notice" title={modelNotice}>{modelNotice}</span>}
        </div>
        <textarea value={question} disabled={isAnswering} onChange={(event) => setQuestion(event.target.value)} placeholder="오늘 일정 뭐야?" rows={2} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
        {isAnswering
          ? <button className="chat-cancel-button" type="button" onClick={() => abortRef.current?.abort()}><span /> 중단</button>
          : <button className="primary-button" disabled={!question.trim() || !selectedModelId}>↑</button>}
        <small>{isAnswering ? "에이전트가 필요한 도구를 실행하고 결과를 확인하고 있습니다." : "연결된 업무 컨텍스트가 OpenAI로 전송됩니다. 답변은 캐시된 데이터 기준입니다."}</small>
      </form>
    </section>
  </div>;
}
