// IPC 기반 human gate — --ws 플래그 시 human-gate.js 대신 사용된다.
// conductor.js → process.send(gate event) → server.js → WebSocket → 브라우저
// 브라우저 → WebSocket → server.js → child.send(gate_response) → 여기서 resolve

export function openGate() {}   // no-op: readline 인터페이스 불필요
export function closeGate() {}  // no-op: readline 인터페이스 없음

export async function humanApprove(stageName, payload) {
  // 브라우저에 게이트 표시 요청
  process.send({ type: "gate", stage: stageName, payload });

  // 브라우저 응답 대기
  return new Promise((resolve) => {
    function handler(msg) {
      if (msg?.type === "gate_response" && msg.stage === stageName) {
        process.off("message", handler);
        resolve({
          approved: msg.approved,
          humanFeedback: msg.feedback ?? null,
        });
      }
    }
    process.on("message", handler);
  });
}

export function presentEscalation(stageName, reasons, statePath) {
  process.send({ type: "escalation", stage: stageName, reasons, statePath });
}
