/**
 * V3 — 대본 검사 (Phase 0: 코드 검사만)
 *
 * 입력: A3이 생성한 payload = { lines: string[], total_chars: number, estimated_seconds: number }
 * 출력: { passed: boolean, reasons: string[] }
 *
 * Phase 1에서 추가 예정: LLM 팩트 왜곡 검사 (V1 claims vs 대본 수치 대조)
 */

import { CONFIG } from "../config.js";
import { requireFields, requireArrayItems } from "../verify-tools/check-json.js";

/**
 * @param {{ lines: string[], total_chars: number, estimated_seconds: number }} payload
 * @returns {{ passed: boolean, reasons: string[] }}
 */
export function runV3(payload) {
  const errors = [];

  // 1. 최상위 구조
  errors.push(...requireFields(payload, ["lines", "total_chars", "estimated_seconds"]));
  if (errors.length) return { passed: false, reasons: errors };

  // 2. lines 배열 필드 검사 (각 줄이 string이어야 함)
  if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
    errors.push("lines 배열이 비어 있음");
    return { passed: false, reasons: errors };
  }

  // 3. 총 글자수가 목표 범위 ±10% 안인지
  const { durationSeconds, charsPerSecond, scriptCharTolerance } = {
    ...CONFIG.targets,
    ...CONFIG.verification,
  };
  const targetChars = durationSeconds.min * charsPerSecond; // 최소 기준으로 비교
  const targetMax   = durationSeconds.max * charsPerSecond;
  const lo = targetChars * (1 - scriptCharTolerance);
  const hi = targetMax   * (1 + scriptCharTolerance);

  const actualChars = payload.total_chars;
  if (typeof actualChars !== "number" || isNaN(actualChars)) {
    errors.push(`total_chars가 숫자가 아님: ${actualChars}`);
  } else if (actualChars < lo || actualChars > hi) {
    errors.push(
      `total_chars 범위 초과: ${actualChars}자 (허용: ${Math.round(lo)}~${Math.round(hi)}자, 목표 ${durationSeconds.min}~${durationSeconds.max}초 기준)`
    );
  }

  // 4. 각 줄이 scriptLineMaxChars 이하인지
  const { scriptLineMaxChars } = CONFIG.targets;
  payload.lines.forEach((line, i) => {
    if (typeof line !== "string") {
      errors.push(`lines[${i}] 문자열이 아님`);
      return;
    }
    if (line.length > scriptLineMaxChars) {
      errors.push(
        `lines[${i}] 줄 길이 초과: ${line.length}자 (최대 ${scriptLineMaxChars}자) — "${line.slice(0, 30)}..."`
      );
    }
  });

  // 5. total_chars와 실제 lines 글자수 합계 일치 여부 (모델 자기보고 신뢰 안 함)
  const computedChars = payload.lines.join("").replace(/\s/g, "").length;
  const reportedChars = payload.total_chars;
  if (Math.abs(computedChars - reportedChars) > 10) {
    errors.push(
      `total_chars 불일치: 모델 보고 ${reportedChars}자 vs 실제 계산 ${computedChars}자 (차이 ${Math.abs(computedChars - reportedChars)}자)`
    );
  }

  return { passed: errors.length === 0, reasons: errors };
}
