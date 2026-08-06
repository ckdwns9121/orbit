import type { ChatTaskProposal } from "../domain/chat-task-proposal";

interface TaskApprovalCardProps {
  proposal: ChatTaskProposal;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

export default function TaskApprovalCard({ proposal, onApprove, onReject }: TaskApprovalCardProps) {
  const settled = proposal.status === "created" || proposal.status === "rejected";
  return <section className={`chat-task-approval ${proposal.status}`} aria-label="할 일 생성 승인">
    <div className="chat-task-approval-mark">✓</div>
    <div className="chat-task-approval-content">
      <strong>오늘 할일로 생성하시겠습니까?</strong>
      <h4>{proposal.title}</h4>
      {proposal.description && <p>{proposal.description}</p>}
      {proposal.status === "created" && <small role="status">오늘 할 일로 생성했습니다.</small>}
      {proposal.status === "rejected" && <small role="status">생성을 취소했습니다.</small>}
      {proposal.status === "error" && <small className="chat-task-approval-error" role="alert">{proposal.error || "할 일을 생성하지 못했습니다."}</small>}
      {!settled && <div className="chat-task-approval-actions">
        <button
          className="primary-button"
          type="button"
          disabled={proposal.status === "approving"}
          onClick={() => onApprove(proposal.id)}
        >{proposal.status === "approving" ? "생성 중…" : proposal.status === "error" ? "다시 시도" : "승인"}</button>
        <button type="button" disabled={proposal.status === "approving"} onClick={() => onReject(proposal.id)}>취소</button>
      </div>}
    </div>
  </section>;
}
