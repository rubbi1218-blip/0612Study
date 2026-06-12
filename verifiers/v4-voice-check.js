/**
 * V4 — 음성 검사 (Phase 0: 파일 존재 + 길이 + 무음)
 *
 * 입력: A4가 생성한 payload = { audio_path, duration_seconds, estimated_seconds, timestamps, sync_offset_ms }
 * 출력: { passed: boolean, reasons: string[] }
 *
 * Phase 1에서 추가 예정: STT 역검증 (AssemblyAI로 받아쓰기 → script 대조)
 */

import { CONFIG } from "../config.js";
import { requireFields } from "../verify-tools/check-json.js";
import { runAudioChecks } from "../verify-tools/check-audio.js";

/**
 * @param {{ audio_path: string, estimated_seconds: number, duration_seconds?: number, timestamps?: any[], sync_offset_ms?: number }} payload
 * @returns {Promise<{ passed: boolean, reasons: string[] }>}
 */
export async function runV4(payload) {
  const errors = [];

  // 1. 필수 필드
  errors.push(...requireFields(payload, ["audio_path", "estimated_seconds"]));
  if (errors.length) return { passed: false, reasons: errors };

  // 2. FFmpeg 기반 파일 존재·길이·무음 검사
  const { voiceLengthTolerance } = CONFIG.verification;
  const result = await runAudioChecks(
    payload.audio_path,
    payload.estimated_seconds,
    voiceLengthTolerance
  );
  errors.push(...result.errors);

  // 3. timestamps 배열 존재 여부 (ElevenLabs with-timestamps 엔드포인트 결과)
  if (!Array.isArray(payload.timestamps) || payload.timestamps.length === 0) {
    errors.push("timestamps 배열이 없거나 비어 있음 (자막 싱크 불가)");
  }

  // 4. probe 결과를 payload에 다시 기록 (duration_seconds 실측값으로 덮어씀)
  //    — Conductor가 이 값을 state에 저장해 human-gate 출력에 쓴다
  if (result.probe) {
    payload.duration_seconds = result.probe.duration;
  }

  return { passed: errors.length === 0, reasons: errors };
}
