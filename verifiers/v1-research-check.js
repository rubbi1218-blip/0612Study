/**
 * V1 — 리서치 검사 (Phase 0: 코드 검사만)
 *
 * 입력: A1이 생성한 payload = { claims: [...] }
 * 출력: { passed: boolean, reasons: string[] }
 *
 * Phase 1에서 추가 예정: LLM 환각 대조 (출처 원문 vs claims 수치 일치 여부)
 */

import { CONFIG } from "../config.js";
import {
  requireFields,
  requireArrayItems,
  requireFreshDate,
  requireUrl,
  requireInRange,
} from "../verify-tools/check-json.js";

/**
 * @param {{ claims: Array<{text:string, value:string, source_url:string, source_date:string}> }} payload
 * @returns {{ passed: boolean, reasons: string[] }}
 */
export function runV1(payload) {
  const errors = [];

  // 1. 최상위 구조
  errors.push(...requireFields(payload, ["claims"]));
  if (errors.length) return { passed: false, reasons: errors };

  // 2. claims 개수 범위
  const { claimsMin, claimsMax } = CONFIG.targets;
  errors.push(
    ...requireInRange(payload.claims.length, claimsMin, claimsMax, "claims 개수")
  );

  // 3. 각 claim 필수 필드
  errors.push(
    ...requireArrayItems(
      payload.claims,
      ["text", "value", "source_url", "source_date"],
      "claims"
    )
  );

  // 4. 각 claim URL 형식 + 날짜 신선도
  const { sourceMaxAgeDays } = CONFIG.verification;
  for (let i = 0; i < payload.claims.length; i++) {
    const c = payload.claims[i];
    errors.push(
      ...requireUrl(c?.source_url, `claims[${i}].source_url`),
      ...requireFreshDate(c?.source_date, sourceMaxAgeDays, `claims[${i}].source_date`)
    );
  }

  return { passed: errors.length === 0, reasons: errors };
}
