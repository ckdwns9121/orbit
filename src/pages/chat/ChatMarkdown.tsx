import { Fragment, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

const inlinePattern = /(\[[^\]]+\]\(https?:\/\/[^)]+\)|\*\*[^*]+\*\*|`[^`]+`)/g;

function renderInline(text: string): ReactNode[] {
  return text.split(inlinePattern).filter(Boolean).map((part, index) => {
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (link) {
      return <button className="chat-markdown-link" type="button" key={`${part}-${index}`} onClick={() => void openUrl(link[2])}>{link[1]} ↗</button>;
    }
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>;
    return <Fragment key={`${part}-${index}`}>{part}</Fragment>;
  });
}

export default function ChatMarkdown({ content }: { content: string }) {
  return <div className="chat-markdown">{content.split("\n").map((line, index) => {
    if (!line.trim()) return <div className="chat-markdown-gap" key={`gap-${index}`} />;
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) return <h3 key={`heading-${index}`}>{renderInline(heading[1])}</h3>;
    const list = line.match(/^\s*(?:[-*]|(\d+)\.)\s+(.+)$/);
    if (list) return <div className="chat-markdown-list" key={`list-${index}`}><span>{list[1] ? `${list[1]}.` : "•"}</span><p>{renderInline(list[2])}</p></div>;
    return <p key={`line-${index}`}>{renderInline(line)}</p>;
  })}</div>;
}
