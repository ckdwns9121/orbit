import { useState } from "react";
import { Bot, Check, Clipboard, LoaderCircle, RefreshCw, Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { DailyBriefing } from "../../../entities/work-context/model/daily-briefing";
import "./style.scss";

export default function DailyBriefingPanel({ briefing, isCollecting, error, onCollect, onClose }: {
  briefing: DailyBriefing | null;
  isCollecting: boolean;
  error: string | null;
  onCollect: () => Promise<void>;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copyMarkdown() {
    if (!briefing) return;
    await navigator.clipboard.writeText(briefing.markdown);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }

  return (
    <div className="daily-briefing-backdrop modal-backdrop" onMouseDown={onClose}>
      <section className="daily-briefing-panel" role="dialog" aria-modal="true" aria-labelledby="daily-briefing-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div className="daily-briefing-mark"><Bot size={20} /></div>
          <div><span>ORBIT ASSISTANT</span><h2 id="daily-briefing-title">오늘의 업무 보고서</h2><p>연결된 도구의 실제 기록을 하나의 문서로 정리합니다.</p></div>
          <button type="button" aria-label="닫기" onClick={onClose}><X size={18} /></button>
        </header>

        {!briefing && !isCollecting && <div className="daily-briefing-empty"><Sparkles size={26} /><strong>오늘의 업무 보고서를 만들어보세요</strong><p>어제 한 일, 오늘 예정, 확인 필요 항목과 참고 링크를 한 문서로 정리합니다.</p><button className="primary-button" type="button" onClick={() => void onCollect()}><Sparkles size={15} />보고서 만들기</button></div>}
        {isCollecting && <div className="daily-briefing-empty"><LoaderCircle className="daily-briefing-spinner" size={27} /><strong>업무 보고서를 작성하고 있어요</strong><p>Slack, Jira, AI 세션, Calendar, GitHub와 로컬 Git 기록을 확인합니다.</p></div>}
        {error && <div className="daily-briefing-error" role="alert">보고서를 만들지 못했습니다. {error}</div>}

        {briefing && !isCollecting && <div className="daily-markdown-content">
          <div className="daily-briefing-toolbar">
            <span><strong>{fileDate(briefing.generatedAt)} 업무 보고서</strong><small>{displayGeneratedAt(briefing.generatedAt)} 생성 · 읽기 전용</small></span>
            <div><button type="button" onClick={() => void onCollect()}><RefreshCw size={14} />다시 생성</button><button type="button" onClick={() => void copyMarkdown()}>{copied ? <Check size={14} /> : <Clipboard size={14} />}{copied ? "복사됨" : "원문 복사"}</button></div>
          </div>
          <article className="daily-markdown-document" aria-label="생성된 업무 보고서"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
            a: ({ href, children }) => <a href={href} onClick={(event) => { event.preventDefault(); if (href) void openUrl(href); }}>{children}</a>,
          }}>{briefing.markdown}</ReactMarkdown></article>
        </div>}

        <footer><span>원문 복사 후 Slack, GitHub, Notion 등에 그대로 붙여넣을 수 있습니다.</span><button className="primary-button" type="button" onClick={onClose}>확인</button></footer>
      </section>
    </div>
  );
}

function fileDate(value: string) { return new Intl.DateTimeFormat("sv-SE").format(new Date(value)); }
function displayGeneratedAt(value: string) { return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
