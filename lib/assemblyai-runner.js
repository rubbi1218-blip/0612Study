/**
 * assemblyai-runner.js — AssemblyAI STT 클라이언트
 *
 * Phase 0: export만 정의, 실제 호출은 Phase 1(V4 STT 역검증)에서 사용.
 * Phase 1에서 V4가 생성된 audio.mp3를 STT로 받아쓰기 → script와 대조한다.
 */

import { CONFIG } from "../config.js";

const { key } = CONFIG.apis.assemblyai;
const BASE_URL = "https://api.assemblyai.com/v2";

/**
 * 로컬 MP3 파일을 AssemblyAI에 업로드하고 STT 결과를 반환한다.
 *
 * @param {string} audioPath 로컬 파일 경로
 * @param {{ languageCode?: string }} [opts]
 * @returns {Promise<{ text: string, words: Array<{ text: string, start: number, end: number }> }>}
 */
export async function transcribeAudio(audioPath, opts = {}) {
  const { languageCode = "ko" } = opts;

  // 1. 파일 업로드
  const uploadUrl = await uploadFile(audioPath);

  // 2. 트랜스크립션 요청
  const transcriptId = await requestTranscription(uploadUrl, languageCode);

  // 3. 완료 대기 (폴링)
  const result = await waitForTranscription(transcriptId);

  return {
    text: result.text ?? "",
    words: (result.words ?? []).map((w) => ({
      text:  w.text,
      start: w.start / 1000, // ms → seconds
      end:   w.end   / 1000,
    })),
  };
}

async function uploadFile(filePath) {
  const { createReadStream } = await import("fs");
  const stream = createReadStream(filePath);

  const res = await fetch(`${BASE_URL}/upload`, {
    method: "POST",
    headers: {
      authorization: key,
      "Transfer-Encoding": "chunked",
    },
    body: stream,
    duplex: "half",
  });
  if (!res.ok) throw new Error(`[assemblyai] 업로드 실패 HTTP ${res.status}`);
  const data = await res.json();
  return data.upload_url;
}

async function requestTranscription(audioUrl, languageCode) {
  const res = await fetch(`${BASE_URL}/transcript`, {
    method: "POST",
    headers: {
      authorization: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      audio_url:     audioUrl,
      language_code: languageCode,
      word_boost:    [],
    }),
  });
  if (!res.ok) throw new Error(`[assemblyai] 트랜스크립션 요청 실패 HTTP ${res.status}`);
  const data = await res.json();
  return data.id;
}

async function waitForTranscription(transcriptId, maxWaitMs = 120_000) {
  const pollInterval = 3000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollInterval));

    const res = await fetch(`${BASE_URL}/transcript/${transcriptId}`, {
      headers: { authorization: key },
    });
    if (!res.ok) throw new Error(`[assemblyai] 상태 조회 실패 HTTP ${res.status}`);
    const data = await res.json();

    if (data.status === "completed") return data;
    if (data.status === "error") throw new Error(`[assemblyai] 트랜스크립션 오류: ${data.error}`);
    // "queued" | "processing" → 계속 대기
  }
  throw new Error(`[assemblyai] 시간 초과 (${maxWaitMs / 1000}초)`);
}
