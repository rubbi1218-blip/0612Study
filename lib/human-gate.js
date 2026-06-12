import readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import path from "path";

const DIVIDER = "=".repeat(60);
const LINE    = "─".repeat(60);

// ── 메인 승인 게이트 ────────────────────────────────────────
export async function humanApprove(stageName, payload) {
  console.log(`\n${DIVIDER}`);
  console.log(`HUMAN CHECKPOINT — ${stageName.toUpperCase()}`);
  console.log(DIVIDER);

  displayPayload(stageName, payload);

  console.log(`\n${DIVIDER}`);

  const rl = readline.createInterface({ input, output });
  try {
    while (true) {
      const answer = await rl.question(
        `\n[${stageName}] y=승인 / n=거부+피드백 / q=중단 : `
      );
      const cmd = answer.trim().toLowerCase();

      if (cmd === "y") {
        console.log("  ✅ 승인 완료.");
        return { approved: true, humanFeedback: null };
      }

      if (cmd === "n") {
        const feedback = await rl.question("  피드백 입력 (무엇을 고쳐야 하나요?): ");
        const trimmed = feedback.trim();
        if (!trimmed) {
          console.log("  피드백을 입력해야 거부할 수 있습니다.");
          continue;
        }
        console.log(`  ❌ 거부. 피드백: "${trimmed}"`);
        return { approved: false, humanFeedback: trimmed };
      }

      if (cmd === "q") {
        console.log("\n  파이프라인 중단. state.json은 보존됩니다. 재실행하면 이어서 진행됩니다.");
        process.exit(0);
      }

      console.log("  y, n, q 중 하나를 입력하세요.");
    }
  } finally {
    rl.close();
  }
}

// ── 에스컬레이션 출력 ────────────────────────────────────────
export function presentEscalation(stageName, reasons, statePath) {
  console.error(`\n${"!".repeat(60)}`);
  console.error(`ESCALATION — ${stageName.toUpperCase()} 3회 실패`);
  console.error("!".repeat(60));
  console.error(`\n실패 이유:`);
  reasons.forEach((r, i) => console.error(`  ${i + 1}. ${r}`));
  console.error(`\nstate.json 위치: ${statePath}`);
  console.error("state.json을 수정하거나 문제를 해결한 뒤 재실행하세요.");
}

// ── 스테이지별 포맷 출력 ────────────────────────────────────
function displayPayload(stageName, payload) {
  switch (stageName) {
    case "research":
      displayResearch(payload);
      break;
    case "script":
      displayScript(payload);
      break;
    case "voice":
      displayVoice(payload);
      break;
    default:
      console.log(JSON.stringify(payload, null, 2));
  }
}

function displayResearch(payload) {
  const claims = payload?.claims ?? [];
  console.log(`\nClaims (${claims.length}개):\n${LINE}`);
  claims.forEach((c, i) => {
    console.log(`[C${i + 1}] ${c.text}`);
    console.log(`      수치: ${c.value}`);
    console.log(`      날짜: ${c.source_date}`);
    console.log(`      출처: ${c.source_url}`);
    if (i < claims.length - 1) console.log();
  });
  console.log(LINE);
}

function displayScript(payload) {
  const lines    = payload?.lines ?? [];
  const chars    = payload?.total_chars ?? 0;
  const seconds  = payload?.estimated_seconds ?? 0;
  console.log(`\n대본 (${chars}자 / 약 ${seconds}초):\n${LINE}`);
  lines.forEach((line, i) => {
    console.log(`${String(i + 1).padStart(3)}: ${line}`);
  });
  console.log(LINE);
}

function displayVoice(payload) {
  const audioPath = payload?.audio_path ?? "(경로 없음)";
  const duration  = payload?.duration_seconds ?? "?";
  const offset    = payload?.sync_offset_ms ?? 0;
  const absPath   = path.resolve(audioPath);

  console.log(`\n음성 파일 정보:`);
  console.log(`  경로:        ${absPath}`);
  console.log(`  길이:        ${duration}초`);
  console.log(`  자막 오프셋: ${offset}ms`);
  console.log(`\n▶ 음성을 들으려면 아래 명령어를 터미널에 붙여넣기:`);
  console.log(`  start "" "${absPath}"`);
}
