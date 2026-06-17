/**
 * V1 — 리서치 검사
 *
 * Phase 0: 구조 검사 (필드 존재·URL 형식·날짜 신선도·claims 개수)
 * Phase 1: + URL 실존 검사 (fetch HEAD) + LLM 환각 대조 (Claude)
 *
 * 입력: A1이 생성한 payload = { claims: [...] }
 * 출력: { passed: boolean, reasons: string[] }
 */

import { CONFIG } from "../config.js";
import {
  requireFields,
  requireArrayItems,
  requireFreshDate,
  requireUrl,
  requireInRange,
} from "../verify-tools/check-json.js";
import { callClaude } from "../lib/claude-runner.js";

/**
 * @param {{ claims: Array<{text:string, value:string, source_url:string, source_date:string}> }} payload
 * @returns {Promise<{ passed: boolean, reasons: string[] }>}
 */
export async function runV1(payload) {
  const errors = [];

  // ── Phase 0: 구조 검사 ────────────────────────────────────
  errors.push(...requireFields(payload, ["claims"]));
  if (errors.length) return { passed: false, reasons: errors };

  const { claimsMin, claimsMax } = CONFIG.targets;
  errors.push(...requireInRange(payload.claims.length, claimsMin, claimsMax, "claims 개수"));
  // text·value는 필수, source_url·source_date는 있으면 검사 (Gemini grounding 없는 경우 허용)
  errors.push(...requireArrayItems(payload.claims, ["text", "value"], "claims"));

  const { sourceMaxAgeDays } = CONFIG.verification;
  const warnings = [];
  for (let i = 0; i < payload.claims.length; i++) {
    const c = payload.claims[i];
    if (c?.source_url) {
      errors.push(...requireUrl(c.source_url, `claims[${i}].source_url`));
    } else {
      warnings.push(`claims[${i}] source_url 없음 — 수동 확인 권장`);
    }
    if (c?.source_date) {
      errors.push(...requireFreshDate(c.source_date, sourceMaxAgeDays, `claims[${i}].source_date`));
    }
  }
  if (warnings.length) console.warn("[V1]", warnings.join("; "));

  if (errors.length) return { passed: false, reasons: errors };

  // ── Phase 1-A: URL 실존 검사 (source_url 있는 것만) ──────
  const claimsWithUrl = payload.claims.filter(c => c?.source_url);
  const urlErrors = claimsWithUrl.length > 0 ? await checkUrlsExist(claimsWithUrl) : [];
  errors.push(...urlErrors);

  // ── Phase 1-A: LLM 환각 대조 ──────────────────────────────
  // URL 실존 검사가 일부 실패해도 LLM 검사는 계속 진행한다.
  const llmErrors = await checkFactsWithLLM(payload.claims);
  errors.push(...llmErrors);

  return { passed: errors.length === 0, reasons: errors };
}

// ── URL 실존 검사 ──────────────────────────────────────────

async function checkUrlsExist(claims) {
  const errors = [];
  const checks = claims.map((c, i) => checkOneUrl(c.source_url, i));
  const results = await Promise.allSettled(checks);
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) errors.push(r.value);
  }
  return errors;
}

async function checkOneUrl(url, idx) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; fact-checker/1.0)" },
    });
    // 2xx, 3xx: 정상
    // 401, 403: 봇 차단 — 사이트는 존재하므로 통과
    // 404, 410, 5xx: 실제 없거나 서버 오류 → 실패
    if (res.status === 404 || res.status === 410) {
      return `claims[${idx}].source_url 페이지 없음 HTTP ${res.status}: ${url}`;
    }
    if (res.status >= 500) {
      return `claims[${idx}].source_url 서버 오류 HTTP ${res.status}: ${url}`;
    }
  } catch (err) {
    // 타임아웃이나 네트워크 오류는 경고로만 기록 (차단 사이트 등 예외 있음)
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return `claims[${idx}].source_url 응답 없음(8초 초과): ${url}`;
    }
    // fetch 자체 실패(ENOTFOUND 등)만 오류 처리
    return `claims[${idx}].source_url 접근 불가: ${err.message}`;
  }
  return null; // 통과
}

// ── LLM 환각 대조 ──────────────────────────────────────────

async function checkFactsWithLLM(claims) {
  const claimList = claims
    .map(
      (c, i) =>
        `[C${i + 1}] 주장: "${c.text}" / 핵심 수치: ${c.value} / 출처: ${c.source_url}`
    )
    .join("\n");

  const prompt = `
당신은 팩트체커입니다. 아래 claims 목록을 검토하고, 각 claim에 대해 수치가 출처 URL의 내용과 일치하는지 판단하라.
URL에 직접 접근하기 어려우면 수치의 상식적 타당성과 일관성을 기준으로 판단하라.

[Claims]
${claimList}

판단 기준:
1. 수치가 명백히 과장·날조됐는가?
2. 같은 주제의 다른 claim들과 논리적으로 충돌하는가?
3. 날짜와 수치가 현실적으로 가능한 범위인가?

반드시 아래 JSON 형식으로만 응답하라:
{
  "issues": [
    { "index": 0, "reason": "오류 설명 (한국어)" }
  ]
}
문제가 없으면 issues 배열을 비워라: { "issues": [] }
`.trim();

  try {
    const { parsed } = await callClaude(prompt, {
      systemPrompt:
        "당신은 적대적 팩트체커입니다. 결함을 찾아내는 것이 임무입니다. 확실한 오류만 보고하고, 애매한 경우는 통과시키십시오.",
      maxTokens: 1024,
    });

    const issues = parsed?.issues ?? [];
    return issues.map(
      (issue) => `[LLM 환각 의심] claims[${issue.index}]: ${issue.reason}`
    );
  } catch (err) {
    // LLM 검사 실패 시 경고만 기록하고 블로킹하지 않는다
    return [`[LLM 검사 오류] ${err.message} — 수동 확인 필요`];
  }
}
