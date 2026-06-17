/**
 * check-json.js — JSON 페이로드 필드 존재·타입 검사 유틸
 *
 * 사용법:
 *   import { requireFields, requireArrayItems } from "../verify-tools/check-json.js";
 *
 *   const errors = [
 *     ...requireFields(payload, ["claims"]),
 *     ...requireArrayItems(payload.claims, ["text", "value", "source_url", "source_date"]),
 *   ];
 *   // errors.length === 0 → 통과
 */

/**
 * 객체에 필수 필드가 존재하고 비어 있지 않은지 검사.
 * @param {object} obj
 * @param {string[]} fields
 * @returns {string[]} 오류 메시지 목록
 */
export function requireFields(obj, fields) {
  const errors = [];
  if (!obj || typeof obj !== "object") {
    return [`객체가 null이거나 object 타입이 아님: ${JSON.stringify(obj)}`];
  }
  for (const field of fields) {
    const val = obj[field];
    if (val === undefined || val === null) {
      errors.push(`필수 필드 누락: "${field}"`);
    } else if (typeof val === "string" && val.trim() === "") {
      errors.push(`필드가 빈 문자열: "${field}"`);
    }
  }
  return errors;
}

/**
 * 배열의 각 항목에 필수 필드가 있는지 검사.
 * @param {any[]} arr
 * @param {string[]} fields
 * @param {string} [label] 배열 이름 (오류 메시지용)
 * @returns {string[]} 오류 메시지 목록
 */
export function requireArrayItems(arr, fields, label = "item") {
  const errors = [];
  if (!Array.isArray(arr)) {
    return [`배열이 아님: ${label}`];
  }
  if (arr.length === 0) {
    return [`배열이 비어 있음: ${label}`];
  }
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    for (const field of fields) {
      const val = item?.[field];
      if (val === undefined || val === null) {
        errors.push(`${label}[${i}] 필수 필드 누락: "${field}"`);
      } else if (typeof val === "string" && val.trim() === "") {
        errors.push(`${label}[${i}] 필드가 빈 문자열: "${field}"`);
      }
    }
  }
  return errors;
}

/**
 * 숫자 값이 범위 안에 있는지 검사.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @param {string} label
 * @returns {string[]} 오류 메시지 목록
 */
export function requireInRange(value, min, max, label) {
  if (typeof value !== "number" || isNaN(value)) {
    return [`"${label}" 값이 숫자가 아님: ${value}`];
  }
  if (value < min || value > max) {
    return [`"${label}" 범위 초과: ${value} (허용: ${min}~${max})`];
  }
  return [];
}

/**
 * source_date 가 ISO 8601 날짜 형식(YYYY-MM-DD)이고
 * maxAgeDays 이내인지 검사.
 * @param {string} dateStr
 * @param {number} maxAgeDays
 * @param {string} label
 * @returns {string[]} 오류 메시지 목록
 */
export function requireFreshDate(dateStr, maxAgeDays, label = "source_date") {
  if (typeof dateStr !== "string") {
    return [`"${label}" 날짜 형식 오류 (YYYY-MM-DD 필요): "${dateStr}"`];
  }
  // YYYY-MM 형식은 월 첫째 날로 자동 보정
  if (/^\d{4}-\d{2}$/.test(dateStr)) {
    dateStr = dateStr + "-01";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return [`"${label}" 날짜 형식 오류 (YYYY-MM-DD 필요): "${dateStr}"`];
  }
  const date = new Date(dateStr + "T00:00:00Z");
  if (isNaN(date.getTime())) {
    return [`"${label}" 유효하지 않은 날짜: "${dateStr}"`];
  }
  const now = new Date();
  const diffDays = (now - date) / (1000 * 60 * 60 * 24);
  if (diffDays > maxAgeDays) {
    return [
      `"${label}" 신선도 기준 초과: ${dateStr} (${Math.floor(diffDays)}일 전, 최대 ${maxAgeDays}일)`,
    ];
  }
  return [];
}

/**
 * URL 형식인지 기본 검사 (http/https 시작).
 * @param {string} url
 * @param {string} label
 * @returns {string[]} 오류 메시지 목록
 */
export function requireUrl(url, label = "source_url") {
  if (typeof url !== "string" || url.trim() === "") {
    return [`"${label}" URL이 비어 있음`];
  }
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return [`"${label}" http/https가 아닌 URL: "${url}"`];
    }
  } catch {
    return [`"${label}" 잘못된 URL 형식: "${url}"`];
  }
  return [];
}
