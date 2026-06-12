/**
 * V2 — 구성 검사
 *
 * 코드 검사: beats 수·총 러닝타임 범위
 * LLM 검사: Hook 존재·비트 전진성·감정 아크·CANON 적합성
 *
 * 입력: { beats[], total_seconds }
 * 출력: { passed: boolean, reasons: string[] }
 */

import { CONFIG } from "../config.js";
import { requireFields, requireArrayItems, requireInRange } from "../verify-tools/check-json.js";
import { callClaude } from "../lib/claude-runner.js";

const BEATS_MIN = 4;
const BEATS_MAX = 7;

/**
 * @param {{ beats: any[], total_seconds: number }} payload
 * @param {string} canon
 * @returns {Promise<{ passed: boolean, reasons: string[] }>}
 */
export async function runV2(payload, canon) {
  const errors = [];

  // ── 코드 검사 ─────────────────────────────────────────────
  errors.push(...requireFields(payload, ["beats", "total_seconds"]));
  if (errors.length) return { passed: false, reasons: errors };

  errors.push(...requireInRange(payload.beats.length, BEATS_MIN, BEATS_MAX, "beats 개수"));
  errors.push(
    ...requireInRange(
      payload.total_seconds,
      CONFIG.targets.durationSeconds.min,
      CONFIG.targets.durationSeconds.max,
      "총 러닝타임(초)"
    )
  );
  errors.push(
    ...requireArrayItems(
      payload.beats,
      ["id", "purpose", "content", "duration_seconds"],
      "beats"
    )
  );

  if (errors.length) return { passed: false, reasons: errors };

  // ── LLM 검사 ──────────────────────────────────────────────
  const llmErrors = await checkStructureWithLLM(payload.beats, canon);
  errors.push(...llmErrors);

  return { passed: errors.length === 0, reasons: errors };
}

async function checkStructureWithLLM(beats, canon) {
  const beatList = beats
    .map(
      (b) =>
        `[B${b.id}] 목적: ${b.purpose} / 내용: ${b.content} / ${b.duration_seconds}초 / 감정: ${b.emotion ?? "미정"}`
    )
    .join("\n");

  const prompt = `
당신은 적대적 영상 구성 검사자입니다. 아래 비트시트를 검토하고 결함을 찾아라.

[채널 기준]
${canon}

[비트시트]
${beatList}

검사 항목:
1. 첫 비트에 시청자를 잡는 Hook(충격·반전·질문)이 있는가?
2. 각 비트가 이전 비트에서 결말로 자연스럽게 전진하는가?
3. 감정 아크가 있는가? (긴장 → 납득 → 결심 등)
4. CANON의 페르소나·금기에 맞는가?
5. 데이터가 단순 나열이 아닌 스토리로 녹아 있는가?

반드시 아래 JSON만 반환하라:
{
  "issues": [
    { "check": "검사 항목명", "reason": "결함 설명 (한국어)" }
  ]
}
문제 없으면: { "issues": [] }
`.trim();

  try {
    const { parsed } = await callClaude(prompt, {
      systemPrompt: "결함을 찾아내는 것이 임무입니다. 확실한 문제만 보고하십시오.",
      maxTokens: 512,
    });
    return (parsed?.issues ?? []).map(
      (issue) => `[LLM 구성 검사] ${issue.check}: ${issue.reason}`
    );
  } catch (err) {
    return [`[LLM 검사 오류] ${err.message} — 수동 확인 필요`];
  }
}
