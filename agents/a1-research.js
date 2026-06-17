/**
 * A1 — 리서치 에이전트 (2-pass)
 *
 * Pass 1: callGemini (googleSearch ON) → grounded 자유 텍스트 수집
 * Pass 2: callGeminiJson (도구 없음, responseMimeType:json) → claims[] 구조화
 *
 * 입력: { topic, intent } + canon(string) + feedback(string[])
 * 출력: { claims: [{text, value, source_url, source_date}], decision_log: string }
 */

import { callGemini, callGeminiJson } from "../lib/gemini-runner.js";
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
  const systemInstruction = `당신은 팩트 기반 경제 리서처입니다.\n\n${canon}`;

  // ── Pass 1: 검색 수집 ──────────────────────────────────────
  const searchPrompt = buildSearchPrompt(topic, intent, claimsMin, claimsMax);
  const { text: researchText, groundingMetadata } = await callGemini(searchPrompt, {
    feedback,
    systemInstruction,
  });

  if (!researchText?.trim()) {
    throw new Error("[A1] Pass 1 응답이 비어 있음");
  }

  // ── Pass 2: JSON 구조화 ────────────────────────────────────
  const structurePrompt = buildStructurePrompt(researchText, claimsMin, claimsMax);
  const { text: rawJson, parsed: structured } = await callGeminiJson(structurePrompt, {
    systemInstruction: "JSON만 출력하라. 다른 텍스트는 일절 출력하지 마라.",
  });

  const claims = Array.isArray(structured?.claims) ? structured.claims : null;

  if (!claims || claims.length === 0) {
    const preview = (rawJson ?? "").slice(0, 400);
    throw new Error(
      `[A1] 2단계 구조화 실패: claims ${claims?.length ?? 0}개.\nraw: ${preview}`
    );
  }

  // grounding 메타데이터에서 URL 목록 추출 (인덱스 매핑 사용 안 함)
  const groundingUrls = extractGroundingUrls(groundingMetadata);
  const enrichedClaims = fillMissingSourceUrls(claims, groundingUrls);

  const decision_log =
    `주제: "${topic}" / 수집 claim ${enrichedClaims.length}개 / grounding 출처 ${groundingUrls.length}개`;

  return { claims: enrichedClaims, decision_log };
}

// ── 프롬프트 빌더 ──────────────────────────────────────────

function buildSearchPrompt(topic, intent, min, max) {
  return `
주제: ${topic}
이번 편 의도: ${intent ?? ""}

위 주제와 관련된 최신 경제 데이터·통계·뉴스를 googleSearch로 검색하라.
수치와 출처 URL·날짜가 포함된 사실들을 ${min}개 이상 ${max}개 이하로 수집한다.

각 사실은 아래 정보를 포함해야 한다:
- 핵심 주장 (한국어 한 문장)
- 구체적 수치 (단위 포함)
- 출처 URL
- 기사·발표 날짜 (YYYY-MM-DD)

검색 결과를 바탕으로 사실들을 자유 텍스트로 정리하라. JSON 출력 불필요.
`.trim();
}

function buildStructurePrompt(researchText, min, max) {
  return `
아래 리서치 결과에서 경제 데이터 claim들을 추출해 JSON으로 정리하라.

[리서치 결과]
${researchText}

[출력 형식]
{
  "claims": [
    {
      "text": "주장 한 문장 (한국어)",
      "value": "핵심 수치 (단위 포함, 예: 3.00%)",
      "source_url": "리서치에 언급된 URL (없으면 빈 문자열)",
      "source_date": "YYYY-MM-DD (불명확하면 리서치에서 가장 최근 날짜)"
    }
  ]
}

규칙:
- ${min}개 이상 ${max}개 이하의 claim을 출력하라.
- text와 value는 반드시 채워라.
- source_url이 리서치에 없으면 "" (빈 문자열)로 두어라. 추측하지 마라.
- 중복 claim 금지.
`.trim();
}

// ── Grounding 처리 ─────────────────────────────────────────

function extractGroundingUrls(groundingMetadata) {
  if (!groundingMetadata) return [];
  return (groundingMetadata.groundingChunks ?? [])
    .map(c => c.web?.uri ?? null)
    .filter(Boolean);
}

/**
 * source_url이 없는 claim에 grounding URL을 순서 무관하게 채운다.
 * 인덱스 순서로 매핑하지 않고, 빈 슬롯에 남은 URL을 앞에서부터 할당한다.
 */
function fillMissingSourceUrls(claims, groundingUrls) {
  const urlPool = [...groundingUrls];
  return claims.map(c => {
    if (!c.source_url && urlPool.length > 0) {
      return { ...c, source_url: urlPool.shift() };
    }
    return c;
  });
}
