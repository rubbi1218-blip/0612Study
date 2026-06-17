/**
 * A4 — 음성 에이전트
 *
 * 대본 lines를 TTS로 변환하고 오디오 + 단어 타임스탬프를 반환한다.
 * TTS 엔진은 TTS_ENGINE 환경변수 또는 --tts 플래그로 선택:
 *   elevenlabs (기본) | qwen3
 *
 * 입력: { lines, total_chars, estimated_seconds } + episodeDir
 * 출력: { audio_path, timestamps, estimated_seconds, sync_offset_ms, decision_log }
 */

import path from "path";
import { getTTSEngine } from "../lib/tts-engine.js";

/**
 * @param {{ lines: string[], estimated_seconds: number }} input A3 페이로드
 * @param {string} episodeDir 에피소드 출력 디렉터리
 * @param {string} [ttsOverride] 런타임 엔진 오버라이드 ("elevenlabs" | "qwen3")
 * @returns {Promise<{ audio_path, timestamps, estimated_seconds, sync_offset_ms, decision_log }>}
 */
export async function runA4(input, episodeDir, ttsOverride) {
  const { lines, estimated_seconds } = input;
  const text = lines.join("\n");

  const engine = await getTTSEngine(ttsOverride);
  const engineName = (ttsOverride ?? process.env.TTS_ENGINE ?? "elevenlabs").toLowerCase();

  // Qwen3는 WAV 출력, ElevenLabs는 MP3
  const ext = engineName === "qwen3" ? "wav" : "mp3";
  const audioPath = path.join(episodeDir, `audio.${ext}`);

  const { audio_path, timestamps } = await engine.synthesize(text, audioPath);

  const decision_log = `[${engineName}] ${lines.length}줄 → TTS 완료 / 타임스탬프 ${timestamps.length}개 / 파일: ${audio_path}`;

  return {
    audio_path,
    timestamps,
    estimated_seconds,
    sync_offset_ms: 0,
    decision_log,
  };
}
