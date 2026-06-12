/**
 * A2 — 구성 에이전트
 *
 * V1 통과한 claims로 영상의 비트시트(beats[])를 설계한다.
 * Hook + 기승전결 구조로, 각 비트는 목적·내용·예상 초를 포함한다.
 *
 * 입력: { claims[] } + canon + feedback[]
 * 출력: { beats[], total_seconds, decision_log }
 */

import { callClaude } from "../lib/claude-runner.js";
import { CONFIG } from "../config.js";

const { durationSeconds } = CONFIG.targets;

/**
 * @param {{ claims: any[] }} input
 * @param {string} canon
 * @param {string[]} [feedback]
 * @returns {Promise<{ beats: any[], total_seconds: number, decision_log: string }>}
 */
export async function runA2(input, canon, feedback = []) {
  const { claims } = input;

  const systemPrompt = `당신은 숏폼 영상 구성 전문가입니다. 아래 채널 정체성을 철저히 따르십시오.\n\n${canon}`;
  const prompt = buildPrompt(claims, durationSeconds.min, durationSeconds.max);

  const { parsed } = await callClaude(prompt, { systemPrompt, feedback, maxTokens: 1024 });

  const beats = Array.isArray(parsed?.beats) ? parsed.beats : [];
  const total_seconds = beats.reduce((sum, b) => sum + (b.duration_seconds ?? 0), 0);
  const decision_log = `beats ${beats.length}개 / 총 ${total_seconds}초 / claims ${claims.length}개 반영`;

  return { beats, total_seconds, decision_log };
}

function buildPrompt(claims, minSec, maxSec) {
  const claimList = claims
    .map((c, i) => `[C${i + 1}] ${c.text} (${c.value})`)
    .join("\n");

  return `
아래 검증된 claims를 바탕으로 숏폼 영상의 비트시트를 설계하라.

[검증된 Claims]
${claimList}

[설계 규칙]
1. 총 길이: ${minSec}초 이상 ${maxSec}초 이하
2. 첫 비트(Hook): 시청자를 반드시 잡아라. 충격적 수치나 반전 질문으로 시작.
3. 비트 수: 4개 이상 7개 이하
4. 각 비트는 이전 비트에서 다음 비트로 자연스럽게 전진해야 한다.
5. 마지막 비트: 행동 유도(CTA) 또는 핵심 메시지 요약
6. CANON의 톤·페르소나·금기를 엄수하라.

반드시 아래 JSON 형식으로만 응답하라:
{
  "beats": [
    {
      "id": 1,
      "purpose": "이 비트의 목적 (예: Hook — 충격 유발)",
      "content": "이 비트에서 다룰 내용 한 문장",
      "claim_refs": [1, 2],
      "duration_seconds": 10,
      "emotion": "긴장/놀라움/납득/결심 중 하나"
    }
  ]
}
`.trim();
}
