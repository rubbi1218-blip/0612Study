/**
 * timestamp-processor.js — 자막 타임스탬프 처리기
 *
 * V4가 sync_offset_ms를 계산한 뒤 호출한다.
 *
 * 역할:
 *   1. ElevenLabs 단어 타임스탬프 + sync_offset_ms → 오프셋 적용
 *   2. 단어를 자막 줄로 묶기 (maxLineChars 기준)
 *   3. Remotion <Subtitle> 컴포넌트가 읽을 수 있는 형식으로 변환
 *
 * Phase 2(A6 렌더)에서 Remotion에 주입된다.
 * Phase 0에서는 V4가 호출해 state.json에 저장해 둔다.
 */

import { CONFIG } from "../config.js";

const { maxLineChars, fps } = CONFIG.targets;

/**
 * @typedef {{ word: string, start: number, end: number }} WordTimestamp
 * @typedef {{ text: string, startSec: number, endSec: number, startFrame: number, endFrame: number }} SubtitleCue
 */

/**
 * 단어 타임스탬프 배열에 오프셋을 적용하고 자막 큐로 변환한다.
 *
 * @param {WordTimestamp[]} timestamps ElevenLabs 단어 타임스탬프
 * @param {number} syncOffsetMs STT 역검증으로 계산된 오프셋 (ms)
 * @returns {SubtitleCue[]}
 */
export function processTimestamps(timestamps, syncOffsetMs = 0) {
  if (!Array.isArray(timestamps) || timestamps.length === 0) return [];

  const offsetSec = syncOffsetMs / 1000;

  // 1. 오프셋 적용 (음수 오프셋은 0으로 클램프)
  const adjusted = timestamps.map((t) => ({
    word:  t.word,
    start: Math.max(0, t.start + offsetSec),
    end:   Math.max(0, t.end   + offsetSec),
  }));

  // 2. 단어를 maxLineChars 기준으로 자막 줄로 묶기
  return groupIntoCues(adjusted);
}

/**
 * 조정된 단어들을 자막 큐(줄) 단위로 묶는다.
 * @param {{ word: string, start: number, end: number }[]} words
 * @returns {SubtitleCue[]}
 */
function groupIntoCues(words) {
  const cues = [];
  let lineWords = [];
  let lineLen   = 0;

  for (const w of words) {
    const addLen = lineWords.length === 0 ? w.word.length : w.word.length + 1; // 단어 사이 공백

    if (lineLen + addLen > maxLineChars && lineWords.length > 0) {
      cues.push(makeCue(lineWords));
      lineWords = [];
      lineLen   = 0;
    }

    lineWords.push(w);
    lineLen += addLen;
  }

  if (lineWords.length > 0) cues.push(makeCue(lineWords));

  return cues;
}

/**
 * 단어 묶음 → SubtitleCue 생성
 * @param {{ word: string, start: number, end: number }[]} words
 * @returns {SubtitleCue}
 */
function makeCue(words) {
  const text       = words.map((w) => w.word).join(" ");
  const startSec   = words[0].start;
  const endSec     = words[words.length - 1].end;
  const startFrame = Math.round(startSec * fps);
  const endFrame   = Math.round(endSec   * fps);

  return { text, startSec, endSec, startFrame, endFrame };
}

/**
 * sync_offset_ms 계산 헬퍼.
 * STT 첫 단어 시작시각 - ElevenLabs 첫 단어 시작시각 (초 단위 → ms 변환).
 *
 * @param {WordTimestamp[]} elevenLabsTs ElevenLabs 타임스탬프
 * @param {{ text: string, start: number }[]} sttWords AssemblyAI 단어 목록
 * @returns {number} sync_offset_ms
 */
export function computeSyncOffset(elevenLabsTs, sttWords) {
  if (!elevenLabsTs?.length || !sttWords?.length) return 0;
  const elStart  = elevenLabsTs[0].start;
  const sttStart = sttWords[0].start;
  return Math.round((sttStart - elStart) * 1000);
}
