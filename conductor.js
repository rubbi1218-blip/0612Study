/**
 * conductor.js — 파이프라인 메인 루너
 *
 * 사용법:
 *   node conductor.js "주제" "이번 편 의도" [--fresh] [--mock-voice]
 *
 * --fresh:      같은 주제의 이전 state를 무시하고 처음부터 시작
 * --mock-voice: ElevenLabs 대신 FFmpeg 테스트 음원으로 대체 (API 없이 파이프라인 검증용)
 */

import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { runA1 } from "./agents/a1-research.js";
import { runA2 } from "./agents/a2-structure.js";
import { runA3 } from "./agents/a3-script.js";
import { runA4 } from "./agents/a4-voice.js";
import { runA5 } from "./agents/a5-visual.js";

const execFileAsync = promisify(execFile);
import { runV1 } from "./verifiers/v1-research-check.js";
import { runV2 } from "./verifiers/v2-structure-check.js";
import { runV3 } from "./verifiers/v3-script-check.js";
import { runV4 } from "./verifiers/v4-voice-check.js";
import { runV5 } from "./verifiers/v5-visual-check.js";
import { StateManager } from "./lib/state-manager.js";
import { loadCanon } from "./lib/canon-loader.js";
import { humanApprove, presentEscalation, closeGate } from "./lib/human-gate.js";
import { CONFIG } from "./config.js";

const MAX_RETRIES = CONFIG.MAX_RETRIES;

// ── mock-visual 프로듀서 ────────────────────────────────────
// Imagen API 없이 FFmpeg로 placeholder PNG를 생성한다 (파이프라인 검증용)
async function mockVisualProduce(input, _canon, _feedback, episodeDir) {
  const { beats } = input;
  const assets = [];

  for (const beat of beats) {
    const filename = `beat-${beat.id}.png`;
    const outputPath = path.join(episodeDir, filename);

    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi",
      "-i", "color=c=0x1a1a2e:size=1080x1920:duration=0.033",
      "-vframes", "1",
      outputPath,
    ]);

    assets.push({ beat_id: beat.id, type: "image", file_path: outputPath, is_mock: true });
  }

  const decision_log = `[MOCK] beats ${beats.length}개 → placeholder PNG 생성`;
  return { assets, decision_log };
}

// ── mock-voice 프로듀서 ─────────────────────────────────────
// ElevenLabs 없이 FFmpeg로 테스트 음원을 생성한다.
async function mockVoiceProduce(input, _canon, _feedback, episodeDir) {
  const { lines, estimated_seconds } = input;
  const audioPath = path.join(episodeDir, "audio.mp3");

  // FFmpeg로 sine 톤 MP3 생성 (silence check 통과용)
  await execFileAsync("ffmpeg", [
    "-y",                            // 덮어쓰기
    "-f", "lavfi",
    "-i", `sine=frequency=220:duration=${estimated_seconds}`,
    "-ar", "22050", "-ac", "1",
    "-c:a", "libmp3lame", "-q:a", "4",
    audioPath,
  ]);

  // 대본 줄 수 기준으로 타임스탬프 균등 배분
  const secPerLine = estimated_seconds / lines.length;
  const timestamps = lines.flatMap((line, i) => {
    const words = line.split(/\s+/);
    const lineStart = i * secPerLine;
    const secPerWord = secPerLine / words.length;
    return words.map((word, j) => ({
      word,
      start: lineStart + j * secPerWord,
      end:   lineStart + (j + 1) * secPerWord,
    }));
  });

  const decision_log = `[MOCK] ${lines.length}줄 → FFmpeg 테스트 음원 / 타임스탬프 ${timestamps.length}개`;
  return { audio_path: audioPath, timestamps, estimated_seconds, sync_offset_ms: 0, decision_log };
}

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
    name: "structure",
    inputFrom: "research",
    async produce(input, canon, feedback, _dir, _state) {
      return await runA2(input, canon, feedback);
    },
    async verify(payload, canon, _state) {
      return await runV2(payload, canon);
    },
  },
  {
    name: "script",
    inputFrom: "structure",
    async produce(input, canon, feedback, _dir, state) {
      // input = structure payload (beats). claims는 research에서 조회
      const claims = state?.getPayload("research")?.claims ?? [];
      return await runA3({ ...input, claims }, canon, feedback);
    },
    verify(payload, _canon, state) {
      const claims = state?.getPayload("research")?.claims ?? [];
      return runV3(payload, claims);
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
  {
    name: "visual",
    inputFrom: "script",
    async produce(input, canon, feedback, episodeDir, state) {
      const beats = state?.getPayload("structure")?.beats ?? [];
      const claims = state?.getPayload("research")?.claims ?? [];
      return await runA5({ ...input, beats, claims }, canon, feedback, episodeDir);
    },
    async verify(payload, _canon, state) {
      const beats = state?.getPayload("structure")?.beats ?? [];
      return await runV5(payload, beats, _canon);
    },
  },
];

// ── 진입점 ──────────────────────────────────────────────────
async function main() {
  const args         = process.argv.slice(2);
  const fresh        = args.includes("--fresh");
  const mockVoice    = args.includes("--mock-voice");
  const filteredArgs = args.filter((a) => !a.startsWith("--"));
  const topic        = filteredArgs[0];
  const intent       = filteredArgs[1] ?? "";

  // mock-voice 모드: voice stage의 produce 함수를 교체
  if (mockVoice) {
    const voiceStage = PIPELINE.find((s) => s.name === "voice");
    voiceStage.produce = mockVoiceProduce;
    console.log("[conductor] ⚠️  mock-voice 모드: FFmpeg 테스트 음원 사용");
  }

  const mockVisual = args.includes("--mock-visual");
  if (mockVisual) {
    const visualStage = PIPELINE.find((s) => s.name === "visual");
    visualStage.produce = mockVisualProduce;
    console.log("[conductor] ⚠️  mock-visual 모드: FFmpeg placeholder 이미지 사용");
  }

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
          const produced = await stage.produce(input, canon, feedback, episodeDir, state);
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
        result = await stage.verify(payload, canon, state);
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
  closeGate();
  const audioPath = state.getPayload("voice")?.audio_path ?? "(없음)";
  console.log(`\n${"=".repeat(60)}`);
  console.log("🎉 파이프라인 완료!");
  console.log(`   에피소드: ${state.episodeId}`);
  console.log(`   출력:     ${episodeDir}`);
  console.log(`   음성:     ${audioPath}`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("\n[conductor] 예상치 못한 오류:", err);
  process.exit(1);
});
