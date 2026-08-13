import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatRole } from "../../entities/work-context/model/chat";
import type { ChatAgentApproval } from "../../entities/work-context/model/chat-agent";
import ChatMarkdown from "./ChatMarkdown";
import TaskApprovalCard from "./TaskApprovalCard";
import { calculateVirtualRange } from "./virtual-range";

export interface DisplayMessage {
  id: string;
  role: ChatRole;
  content: string;
  streaming?: boolean;
  approvals?: ChatAgentApproval[];
}

function estimatedHeight(message: DisplayMessage) {
  if (message.role === "user") return 74;
  const proposalHeight = (message.approvals?.length ?? 0) * 150;
  return Math.min(1_200, 78 + Math.ceil(message.content.length / 72) * 23 + proposalHeight);
}

function MeasuredMessage({ message, top, onHeight, onApproveTask, onRejectTask }: {
  message: DisplayMessage;
  top: number;
  onHeight: (id: string, height: number) => void;
  onApproveTask: (id: string) => void;
  onRejectTask: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const report = () => onHeight(message.id, Math.ceil(element.getBoundingClientRect().height));
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [message.id, onHeight]);
  return <div className="chat-virtual-row" ref={ref} style={{ transform: `translateY(${top}px)` }}>
    <article className={`chat-message ${message.role} ${message.streaming ? "streaming" : ""}`}>
      <span>{message.role === "user" ? "나" : "✦"}</span>
      <div className="chat-message-content">
        <ChatMarkdown content={message.content || "답변을 준비하고 있습니다…"} />
        {message.approvals?.map((proposal) => <TaskApprovalCard
          key={proposal.id}
          proposal={proposal}
          onApprove={onApproveTask}
          onReject={onRejectTask}
        />)}
      </div>
    </article>
  </div>;
}

export default function VirtualMessageList({ messages, onApproveTask, onRejectTask }: {
  messages: DisplayMessage[];
  onApproveTask: (id: string) => void;
  onRejectTask: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measurements = useRef(new Map<string, number>());
  const stickToBottom = useRef(true);
  const [scrollState, setScrollState] = useState({ top: 0, height: 600 });
  const [measurementVersion, setMeasurementVersion] = useState(0);

  const heights = useMemo(
    () => messages.map((message) => measurements.current.get(message.id) ?? estimatedHeight(message)),
    // measurementVersion intentionally invalidates the cached height map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, measurementVersion],
  );
  const range = useMemo(
    () => calculateVirtualRange(heights, scrollState.top, scrollState.height),
    [heights, scrollState],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !stickToBottom.current) return;
    const frame = requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
    return () => cancelAnimationFrame(frame);
  }, [messages, range.totalHeight]);

  const reportHeight = (id: string, height: number) => {
    if (measurements.current.get(id) === height) return;
    measurements.current.set(id, height);
    setMeasurementVersion((value) => value + 1);
  };

  return <div className="chat-messages" ref={containerRef} onScroll={(event) => {
    const element = event.currentTarget;
    stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
    setScrollState({ top: element.scrollTop, height: element.clientHeight });
  }}>
    <div className="chat-message-space" style={{ height: range.totalHeight }}>
      {messages.slice(range.start, range.end).map((message, index) => <MeasuredMessage
        key={message.id}
        message={message}
        top={range.offsets[range.start + index]}
        onHeight={reportHeight}
        onApproveTask={onApproveTask}
        onRejectTask={onRejectTask}
      />)}
    </div>
    {!stickToBottom.current && <button className="chat-jump-latest" type="button" onClick={() => {
      stickToBottom.current = true;
      containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: "smooth" });
    }}>최신 답변 ↓</button>}
  </div>;
}
