/**
 * A1 — 리서치 에이전트
 *
 * Gemini 2.5 Pro + googleSearch 그라운딩으로 주제 관련
 * 경제 데이터·통계·뉴스를 수집하고 claims[] 를 반환한다.
 *
 * 입력: { topic, intent } + canon(string) + feedback(string[])
 * 출력: { claims: [{text, value, source_url, source_date}], decision_log: string }
 */

import { callGemini } from "../lib/gemini-runner.js";
import { CONFIG } from "../config.js";

const { claimsMin, claimsMax } = CONFIG.targets;

/**
 * @param {{ topic: string, intent: string }} input
 * @param {string} canon CANON.md 전문
 * @param {string[]} [feedback] V1 실패 이유 목록
 * @returns {Promise<{ claims: any[], decision_log: string }>}
 */
export async function runA1(input, canon, feedback = []) {
  const { topic, intent } = input;

  const systemInstruction = buildSystem(canon);
  const prompt = buildPrompt(topic, intent, claimsMin, claimsMax);

  const { parsed, groundingMetadata } = await callGemini(prompt, {
    feedback,
    systemInstruction,
  });

  // Gemini가 JSON을 감싸는 래퍼 필드 처리 ({ claims: [...] } 또는 [...] 직접)
  const claims = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.claims)
    ? parsed.claims
    : [];

  // grounding에서 출처 URL 보완: claim에 source_url 없을 시 grounding 메타데이터 활용
  const sources = extractGroundingSources(groundingMetadata);
  const enrichedClaims = enrichWithSources(claims, sources);

  const decision_log = `주제: "${topic}" / 수집 claim ${enrichedClaims.length}개 / grounding 출처 ${sources.length}개`;

  return { claims: enrichedClaims, decision_log };
}

// ── 프롬프트 빌더 ──────────────────────────────────────────

function buildSystem(canon) {
  return `당신은 팩트 기반 경제 리서처입니다. 아래 채널 정체성과 기준을 따르십시오.\n\n${canon}`;
}

function buildPrompt(topic, intent, min, max) {
  return `
주제: ${topic}
이번 편 의도: ${intent}

위 주제에 대해 신뢰할 수 있는 최신 경제 데이터·통계·뉴스를 수집하라.
googleSearch 도구를 사용해 실제 출처가 있는 수치만 수집한다.

요구사항:
- ${min}개 이상 ${max}개 이하의 claim을 반환하라.
- 각 claim은 반드시 수치(value)와 출처 URL(source_url), 출처 날짜(source_date, YYYY-MM-DD 형식)를 포함해야 한다.
- 추측이나 요약은 금지. 출처 원문에서 직접 확인한 수치만 사용하라.
- source_date는 기사·발표 원문의 날짜이며, 오늘 날짜가 아니다.

반드시 아래 JSON 형식으로만 응답하라. 다른 텍스트는 출력하지 마라:
{
  "claims": [
    {
      "text": "주장 한 문장 (한국어)",
      "value": "핵심 수치 (단위 포함, 예: 5.25%)",
      "source_url": "https://...",
      "source_date": "YYYY-MM-DD"
    }
  ]
}
`.trim();
}

// ── Grounding 메타데이터 처리 ──────────────────────────────

function extractGroundingSources(groundingMetadata) {
  if (!groundingMetadata) return [];
  const chunks = groundingMetadata.groundingChunks ?? [];
  return chunks
    .map((c) => ({
      url:   c.web?.uri   ?? null,
      title: c.web?.title ?? null,
    }))
    .filter((s) => s.url);
}

function enrichWithSources(claims, sources) {
  return claims.map((c, i) => {
    // source_url이 없거나 빈 문자열이면 grounding 소스로 보완
    if (!c.source_url && sources[i]) {
      return { ...c, source_url: sources[i].url };
    }
    return c;
  });
}
