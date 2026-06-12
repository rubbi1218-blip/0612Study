/**
 * conductor.js — 파이프라인 메인 루너
 *
 * 사용법:
 *   node conductor.js "주제" "이번 편 의도" [--fresh]
 *
 * --fresh: 같은 주제의 이전 state를 무시하고 처음부터 시작
 */

import path from "path";
import { runA1 } from "./agents/a1-research.js";
import { runA3 } from "./agents/a3-script.js";
import { runA4 } from "./agents/a4-voice.js";
import { runV1 } from "./verifiers/v1-research-check.js";
import { runV3 } from "./verifiers/v3-script-check.js";
import { runV4 } from "./verifiers/v4-voice-check.js";
import { StateManager } from "./lib/state-manager.js";
import { loadCanon } from "./lib/canon-loader.js";
import { humanApprove, presentEscalation } from "./lib/human-gate.js";
import { CONFIG } from "./config.js";

const MAX_RETRIES = CONFIG.MAX_RETRIES;

// ── 파이프라인 정의 ─────────────────────────────────────────
// produce / verify 시그니처를 stage마다 정규화한다.
const PIPELINE = [
  {
    name: "research",
    inputFrom: null,
    async produce(input, canon, feedback, _dir) {
      return await runA1(input, canon, feedback);
    },
    verify(payload) {
      return runV1(payload);
    },
  },
  {
    name: "script",
    inputFrom: "research",
    async produce(input, canon, feedback, _dir) {
      return await runA3(input, canon, feedback);
    },
    verify(payload) {
      return runV3(payload);
    },
  },
  {
    name: "voice",
    inputFrom: "script",
    async produce(input, _canon, _feedback, episodeDir) {
      return await runA4(input, episodeDir);
    },
    async verify(payload) {
      return await runV4(payload);
    },
  },
];

// ── 진입점 ──────────────────────────────────────────────────
async function main() {
  const args         = process.argv.slice(2);
  const fresh        = args.includes("--fresh");
  const filteredArgs = args.filter((a) => a !== "--fresh");
  const topic        = filteredArgs[0];
  const intent       = filteredArgs[1] ?? "";

  if (!topic) {
    console.error('사용법: node conductor.js "주제" "이번 편 의도" [--fresh]');
    process.exit(1);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`CONDUCTOR — Phase ${CONFIG.PHASE} 파이프라인 시작`);
  console.log(`주제: ${topic}`);
  if (intent) console.log(`의도: ${intent}`);
  console.log("=".repeat(60));

  const canon      = loadCanon();
  const state      = StateManager.loadOrInit(topic, intent, fresh);
  const episodeDir = path.dirname(state.statePath);

  let stageIndex       = 0;
  let humanRejFeedback = []; // 사람 거부 시 다음 produce에 전달

  while (stageIndex < PIPELINE.length) {
    const stage     = PIPELINE[stageIndex];
    const stageData = state._state.stages[stage.name];

    // ── 이미 완료 → 건너뜀 ────────────────────────────────
    if (state.isStageComplete(stage.name)) {
      console.log(`\n[${stage.name}] ✅ 이미 완료 — 건너뜀`);
      stageIndex++;
      humanRejFeedback = [];
      continue;
    }

    // ── 검증 통과했지만 사람 승인 미완료 (재개 시) ─────────
    if (stageData.status === "verified" && !stageData.human_approved) {
      console.log(`\n[${stage.name}] ⏸ 검증 완료, 사람 승인 대기`);
      const { approved, humanFeedback } = await humanApprove(
        stage.name,
        state.getPayload(stage.name)
      );
      if (approved) {
        state.markStageHumanApproved(stage.name);
        stageIndex++;
        humanRejFeedback = [];
      } else {
        state.resetStage(stage.name);
        humanRejFeedback = [humanFeedback];
      }
      continue;
    }

    // ── Producer + Verifier 루프 ────────────────────────────
    // produced 상태(produce 완료, verify 미실행)면 produce 단계를 건너뛴다.
    let skipProduce  = stageData.status === "produced" && stageData.payload !== null;
    let passed       = false;
    let feedback     = [...humanRejFeedback];
    humanRejFeedback = [];

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      console.log(`\n[${stage.name}] 🔄 attempt ${attempt}/${MAX_RETRIES}`);

      // — Produce —
      if (!skipProduce) {
        state.markStageStart(stage.name);
        const input = state.getLastPayload(stage.inputFrom);
        try {
          const produced = await stage.produce(input, canon, feedback, episodeDir);
          state.saveStageResult(stage.name, produced, produced.decision_log ?? "");
          console.log(`[${stage.name}] 📝 produce 완료. ${produced.decision_log ?? ""}`);
        } catch (err) {
          console.error(`[${stage.name}] ❌ produce 오류: ${err.message}`);
          feedback = [err.message];
          skipProduce = false;
          continue;
        }
      } else {
        console.log(`[${stage.name}] ⏭ produce 건너뜀 (이미 완료된 payload 사용)`);
        skipProduce = false; // 다음 attempt부터는 재실행
      }

      // — Verify —
      const payload = state.getPayload(stage.name);
      let result;
      try {
        result = await stage.verify(payload);
      } catch (err) {
        console.error(`[${stage.name}] ❌ verify 오류: ${err.message}`);
        feedback = [err.message];
        continue;
      }

      if (result.passed) {
        state.markStageVerified(stage.name, result);
        console.log(`[${stage.name}] ✅ 검증 통과`);
        passed = true;
        break;
      }

      console.log(`[${stage.name}] ❌ 검증 실패 (${result.reasons.length}개):`);
      result.reasons.forEach((r, i) => console.log(`   ${i + 1}. ${r}`));
      feedback = result.reasons;
    }

    // — 3회 모두 실패 → 에스컬레이션 —
    if (!passed) {
      state.addEscalation(stage.name, feedback);
      presentEscalation(stage.name, feedback, state.statePath);
      process.exit(1);
    }

    // — 사람 승인 게이트 —
    const { approved, humanFeedback } = await humanApprove(
      stage.name,
      state.getPayload(stage.name)
    );
    if (approved) {
      state.markStageHumanApproved(stage.name);
      stageIndex++;
    } else {
      console.log(`\n[${stage.name}] 🔄 사람 거부. 피드백: "${humanFeedback}"`);
      state.resetStage(stage.name);
      humanRejFeedback = [humanFeedback];
      // stageIndex 유지 → 같은 stage 재실행
    }
  }

  // ── 완료 ───────────────────────────────────────────────────
  const audioPath = state.getPayload("voice")?.audio_path ?? "(없음)";
  console.log(`\n${"=".repeat(60)}`);
  console.log("🎉 Phase 0 파이프라인 완료!");
  console.log(`   에피소드: ${state.episodeId}`);
  console.log(`   출력:     ${episodeDir}`);
  console.log(`   음성:     ${audioPath}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("\n[conductor] 예상치 못한 오류:", err);
  process.exit(1);
});
