import { approvalPrompt, approvalTitle, type ChatAgentApproval } from "../../entities/work-context/model/chat-agent";

interface TaskApprovalCardProps {
  proposal: ChatAgentApproval;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

export default function TaskApprovalCard({ proposal, onApprove, onReject }: TaskApprovalCardProps) {
  const settled = proposal.status === "approved" || proposal.status === "rejected";
  return <section className={`chat-task-approval ${proposal.status}`} aria-label="에이전트 변경 승인">
    <div className="chat-task-approval-mark">✓</div>
    <div className="chat-task-approval-content">
      <strong>{approvalPrompt(proposal.toolName)}</strong>
      <h4>{approvalTitle(proposal)}</h4>
      {proposal.toolName === "create_task" && typeof proposal.arguments.description === "string" && <p>{proposal.arguments.description}</p>}
      {proposal.toolName === "update_task" && <p>{[proposal.arguments.priority, proposal.arguments.target_at].filter(Boolean).join(" · ")}</p>}
      {proposal.status === "approved" && <small role="status">승인한 변경을 적용했고 에이전트가 결과를 확인했습니다.</small>}
      {proposal.status === "rejected" && <small role="status">변경하지 않고 에이전트에게 거절 결과를 전달했습니다.</small>}
      {proposal.status === "failed" && <small className="chat-task-approval-error" role="alert">{proposal.error || "변경을 적용하지 못했습니다."}</small>}
      {!settled && <div className="chat-task-approval-actions">
        <button
          className="primary-button"
          type="button"
          disabled={proposal.status === "executing"}
          onClick={() => onApprove(proposal.id)}
        >{proposal.status === "executing" ? "적용 중…" : proposal.status === "failed" ? "다시 시도" : "승인"}</button>
        <button type="button" disabled={proposal.status === "executing"} onClick={() => onReject(proposal.id)}>거절</button>
      </div>}
    </div>
  </section>;
}
