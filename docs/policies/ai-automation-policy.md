# AI 자동화 정책

- 상태: Accepted

## 정책

1. AI는 Task 생성, 연결, 우선순위, 목표 시간과 상태 변경을 제안할 수 있다.
2. Task 또는 외부 시스템을 변경하는 tool call은 적용 전 사용자에게 대상과 결과를 보여준다.
3. 승인은 제안 당시의 source identity와 revision에 결합한다. 내용이 바뀐 승인은 재사용하지 않는다.
4. 자동 연결은 점수와 이유를 표시하고 사용자가 해제할 수 있어야 한다.
5. AI 세션 완료만으로 Task를 자동 완료하지 않는다. 모든 연결 세션이 끝나도 review 또는 완료 제안으로만 전환한다.
6. 답변에는 사용한 로컬·외부 근거와 신선도 실패를 구분한다.
7. 근거가 없거나 조회가 실패한 경우 사실을 만들어 채우지 않는다.
8. 자동화는 기본적으로 opt-in이며 금지된 상태 변경을 우회할 수 없다.

## 근거

- `src/entities/work-context/model/automation.ts`
- `src/entities/work-context/model/task-flow.ts`
- `src/entities/work-context/api/chat-completion-grounding.test.ts`
- `src/entities/work-context/api/chat-graph-grounding.test.ts`
