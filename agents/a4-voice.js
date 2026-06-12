/**
 * A4 — 음성 에이전트
 *
 * 대본 lines를 ElevenLabs TTS로 변환하고 오디오 + 단어 타임스탬프를 반환한다.
 * sync_offset_ms는 V4가 STT 역검증 후 채운다 (초기값 0).
 *
 * 입력: { lines, total_chars, estimated_seconds } + episodeDir(저장 경로)
 * 출력: { audio_path, timestamps, estimated_seconds, sync_offset_ms, decision_log }
 */

import path from "path";
import { callElevenLabs } from "../lib/elevenlabs-runner.js";

/**
 * @param {{ lines: string[], estimated_seconds: number }} input A3 페이로드
 * @param {string} episodeDir 에피소드 출력 디렉터리 (예: output/ep-20260612-1234)
 * @returns {Promise<{ audio_path: string, timestamps: any[], estimated_seconds: number, sync_offset_ms: number, decision_log: string }>}
 */
export async function runA4(input, episodeDir) {
  const { lines, estimated_seconds } = input;

  // 줄을 하나의 TTS 텍스트로 합침 (줄바꿈 = 자연스러운 TTS 포즈)
  const text = lines.join("\n");

  const audioPath = path.join(episodeDir, "audio.mp3");

  const { audio_path, timestamps } = await callElevenLabs(text, audioPath);

  const decision_log = `${lines.length}줄 → TTS 변환 완료 / 타임스탬프 ${timestamps.length}개 / 파일: ${audio_path}`;

  return {
    audio_path,
    timestamps,
    estimated_seconds,
    sync_offset_ms: 0, // V4 STT 역검증 후 갱신
    decision_log,
  };
}
