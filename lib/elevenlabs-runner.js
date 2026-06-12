/**
 * elevenlabs-runner.js — ElevenLabs TTS HTTP 클라이언트
 *
 * /with-timestamps 엔드포인트로 오디오 + 단어별 타이밍을 한 번에 받는다.
 * 오디오는 즉시 디스크에 저장하고, 타임스탬프 배열을 반환한다.
 */

import fs from "fs";
import path from "path";
import { CONFIG } from "../config.js";

const { key, voiceId, endpoint, model } = CONFIG.apis.elevenlabs;

/**
 * @param {string} text TTS 변환할 텍스트
 * @param {string} outputPath 저장할 MP3 파일 경로
 * @returns {Promise<{ audio_path: string, timestamps: Array<{word:string, start:number, end:number}> }>}
 */
export async function callElevenLabs(text, outputPath) {
  const url = `${endpoint}/${voiceId}/with-timestamps`;

  const body = {
    text,
    model_id: model,
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.8,
      style: 0.2,
      use_speaker_boost: true,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`[elevenlabs] HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();

  // audio_base64 → MP3 파일 저장
  const audioBase64 = data.audio_base64;
  if (!audioBase64) throw new Error("[elevenlabs] audio_base64 필드 없음");

  const audioBuffer = Buffer.from(audioBase64, "base64");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, audioBuffer);

  // 타임스탬프 정규화: { characters, character_start_times_seconds, character_end_times_seconds }
  // → 단어 단위로 묶어서 반환
  const timestamps = normalizeTimestamps(data.alignment ?? {});

  return { audio_path: outputPath, timestamps };
}

/**
 * ElevenLabs alignment 객체를 단어 단위 배열로 변환.
 * @param {{ characters: string[], character_start_times_seconds: number[], character_end_times_seconds: number[] }} alignment
 * @returns {Array<{ word: string, start: number, end: number }>}
 */
function normalizeTimestamps(alignment) {
  const { characters = [], character_start_times_seconds = [], character_end_times_seconds = [] } = alignment;

  const words = [];
  let currentWord = "";
  let wordStart = null;

  for (let i = 0; i < characters.length; i++) {
    const char  = characters[i];
    const start = character_start_times_seconds[i] ?? 0;
    const end   = character_end_times_seconds[i]   ?? 0;

    if (char === " " || char === "\n") {
      if (currentWord) {
        words.push({ word: currentWord, start: wordStart, end: character_end_times_seconds[i - 1] ?? end });
        currentWord = "";
        wordStart   = null;
      }
    } else {
      if (!currentWord) wordStart = start;
      currentWord += char;
    }
  }
  // 마지막 단어 처리
  if (currentWord) {
    const lastEnd = character_end_times_seconds[characters.length - 1] ?? 0;
    words.push({ word: currentWord, start: wordStart, end: lastEnd });
  }

  return words;
}
