/**
 * A3 — 대본 에이전트
 *
 * V1 통과한 claims로 내레이션 대본을 집필한다.
 * Phase 0: beats 없음 — 모델이 Hook + 기승전결을 자체 구성.
 * Phase 2: A2(구성)가 생성한 beats를 받아 구조대로 작성.
 *
 * 입력: { claims[] } + canon(string) + feedback(string[])
 * 출력: { lines: string[], total_chars: number, estimated_seconds: number, decision_log: string }
 */

import { callClaude } from "../lib/claude-runner.js";
import { CONFIG } from "../config.js";

const { durationSeconds, charsPerSecond, scriptLineMaxChars } = CONFIG.targets;

/**
 * @param {{ claims: any[] }} input V1 통과한 리서치 페이로드
 * @param {string} canon CANON.md 전문
 * @param {string[]} [feedback] V3 실패 이유 목록
 * @returns {Promise<{ lines: string[], total_chars: number, estimated_seconds: number, decision_log: string }>}
 */
export async function runA3(input, canon, feedback = []) {
  const { claims } = input;

  const targetMin = Math.round(durationSeconds.min * charsPerSecond);
  const targetMax = Math.round(durationSeconds.max * charsPerSecond);

  const systemPrompt = buildSystem(canon);
  const prompt = buildPrompt(claims, targetMin, targetMax, scriptLineMaxChars);

  const { parsed } = await callClaude(prompt, { systemPrompt, feedback, maxTokens: 2048 });

  const lines = extractLines(parsed);

  // 글자수는 모델 자기보고를 신뢰하지 않고 Conductor가 직접 계산
  const totalText  = lines.join("").replace(/\s/g, "");
  const totalChars = totalText.length;
  const estimatedSeconds = Math.round(totalChars / charsPerSecond);

  const decision_log = `글자수 ${totalChars}자 / 약 ${estimatedSeconds}초 / ${lines.length}줄 / claims ${claims.length}개 반영`;

  return { lines, total_chars: totalChars, estimated_seconds: estimatedSeconds, decision_log };
}

// ── 프롬프트 빌더 ──────────────────────────────────────────

function buildSystem(canon) {
  return `당신은 날카로운 경제 채널의 전문 내레이터입니다. 아래 채널 정체성을 철저히 따르십시오.\n\n${canon}`;
}

function buildPrompt(claims, targetMin, targetMax, maxLineChars) {
  const claimList = claims
    .map((c, i) => `[C${i + 1}] ${c.text} (${c.value})`)
    .join("\n");

  return `
아래 검증된 claims를 바탕으로 한국어 내레이션 대본을 작성하라.

[검증된 Claims]
${claimList}

[작성 규칙]
1. 총 글자수(공백 제외): ${targetMin}자 이상 ${targetMax}자 이하
2. 한 줄 최대 ${maxLineChars}자 (TTS 호흡 단위)
3. 구조: Hook(첫 2~3줄로 시청자를 잡아라) → 전개 → 결말
4. claims의 수치를 왜곡하거나 과장하지 마라. 원본 그대로 사용하라.
5. CANON의 톤·페르소나·금기를 엄수하라.
6. TTS가 읽기 어려운 특수문자·이모지·영어 약어(풀어쓰기 가능한 경우)는 피하라.

반드시 아래 JSON 형식으로만 응답하라. 다른 텍스트는 출력하지 마라:
{
  "lines": [
    "줄1",
    "줄2",
    "..."
  ]
}
`.trim();
}

// ── 응답 파싱 ──────────────────────────────────────────────

function extractLines(parsed) {
  // { lines: [...] } 형식 또는 직접 배열
  let raw = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.lines)
    ? parsed.lines
    : [];

  // 문자열이 아닌 항목 제거, 빈 줄 제거
  return raw
    .filter((l) => typeof l === "string" && l.trim().length > 0)
    .map((l) => l.trim());
}
