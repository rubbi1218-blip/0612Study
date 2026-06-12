/**
 * V3 — 대본 검사
 *
 * Phase 0: 글자수 범위, 줄 길이, total_chars 일치
 * Phase 1: + claims↔대본 수치 LLM 대조 + 금기어 코드 검사 + TTS 가독성 검사
 *
 * 입력: { lines, total_chars, estimated_seconds } + claims(V1 통과본)
 * 출력: { passed: boolean, reasons: string[] }
 */

import { CONFIG } from "../config.js";
import { requireFields } from "../verify-tools/check-json.js";
import { callClaude } from "../lib/claude-runner.js";

// ── CANON 금기어 목록 (코드 검사용) ───────────────────────
const FORBIDDEN_PATTERNS = [
  { pattern: /매수|매도|사야|팔아야|지금 사|지금 팔/g, label: "종목 매매 추천" },
  { pattern: /카더라|소문|루머|음모/g,                  label: "루머·음모론" },
  { pattern: /파이팅|함께|우리|할 수 있다|화이팅/g,     label: "동기부여 클리셰" },
  { pattern: /반드시|무조건\s*오른다|무조건\s*내린다/g,  label: "단정적 가격 예측" },
];

// TTS 가독성 저해 패턴
const TTS_BAD_PATTERNS = [
  { pattern: /[()（）\[\]【】]/g,   label: "괄호 문자" },
  { pattern: /[\/\\]/g,              label: "슬래시" },
  { pattern: /[☀-➿\uD83C-􏰀-\uDFFF]/g, label: "이모지" },
  { pattern: /[&@#\^*~`|]/g,        label: "특수기호" },
];

/**
 * @param {{ lines: string[], total_chars: number, estimated_seconds: number }} payload
 * @param {Array<{text:string, value:string}>} [claims] V1 통과한 claims (Phase 1 팩트 대조용)
 * @returns {Promise<{ passed: boolean, reasons: string[] }>}
 */
export async function runV3(payload, claims = []) {
  const errors = [];

  // ── Phase 0: 구조·글자수·줄 길이 검사 ────────────────────
  errors.push(...requireFields(payload, ["lines", "total_chars", "estimated_seconds"]));
  if (errors.length) return { passed: false, reasons: errors };

  if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
    return { passed: false, reasons: ["lines 배열이 비어 있음"] };
  }

  const { durationSeconds, charsPerSecond, scriptLineMaxChars } = CONFIG.targets;
  const { scriptCharTolerance } = CONFIG.verification;

  const lo = durationSeconds.min * charsPerSecond * (1 - scriptCharTolerance);
  const hi = durationSeconds.max * charsPerSecond * (1 + scriptCharTolerance);

  if (payload.total_chars < lo || payload.total_chars > hi) {
    errors.push(
      `total_chars 범위 초과: ${payload.total_chars}자 (허용: ${Math.round(lo)}~${Math.round(hi)}자)`
    );
  }

  payload.lines.forEach((line, i) => {
    if (typeof line !== "string") { errors.push(`lines[${i}] 문자열 아님`); return; }
    if (line.length > scriptLineMaxChars) {
      errors.push(`lines[${i}] 줄 길이 초과: ${line.length}자 (최대 ${scriptLineMaxChars}자)`);
    }
  });

  const computedChars = payload.lines.join("").replace(/\s/g, "").length;
  if (Math.abs(computedChars - payload.total_chars) > 10) {
    errors.push(
      `total_chars 불일치: 보고 ${payload.total_chars}자 vs 실제 ${computedChars}자`
    );
  }

  // ── Phase 1: 금기어 코드 검사 ─────────────────────────────
  const fullText = payload.lines.join(" ");
  for (const { pattern, label } of FORBIDDEN_PATTERNS) {
    const matches = fullText.match(pattern);
    if (matches) {
      errors.push(`금기 표현 발견 (${label}): "${matches[0]}"`);
    }
  }

  // ── Phase 1: TTS 가독성 검사 ──────────────────────────────
  for (const { pattern, label } of TTS_BAD_PATTERNS) {
    const matches = fullText.match(pattern);
    if (matches) {
      errors.push(`TTS 가독성 저해 문자 (${label}): "${matches[0]}"`);
    }
  }

  // 구조/코드 검사 실패 시 LLM 검사 생략 (LLM 비용 절감)
  if (errors.length) return { passed: false, reasons: errors };

  // ── Phase 1: claims↔대본 수치 LLM 대조 ───────────────────
  if (claims.length > 0) {
    const llmErrors = await checkFactsMatchScript(claims, payload.lines);
    errors.push(...llmErrors);
  }

  return { passed: errors.length === 0, reasons: errors };
}

// ── LLM 수치 대조 ──────────────────────────────────────────

async function checkFactsMatchScript(claims, lines) {
  const claimList = claims
    .map((c, i) => `[C${i + 1}] ${c.text} → 핵심 수치: ${c.value}`)
    .join("\n");
  const scriptText = lines.join("\n");

  const prompt = `
당신은 적대적 팩트체커입니다. 아래 원본 claims의 수치와 대본 텍스트를 비교하라.

[원본 Claims]
${claimList}

[대본]
${scriptText}

확인할 것:
1. 대본이 claims의 수치를 다르게 표현했는가? (예: 4.2% → 4.5%로 바꿈)
2. 대본이 claims에 없는 수치를 새로 만들어냈는가?
3. 수치의 의미를 반대로 바꿨는가? (예: 상승 → 하락)

반드시 아래 JSON만 반환하라:
{
  "issues": [
    { "claim_index": 0, "script_excerpt": "문제 구절", "reason": "오류 설명" }
  ]
}
문제 없으면: { "issues": [] }
`.trim();

  try {
    const { parsed } = await callClaude(prompt, {
      systemPrompt: "결함을 찾아내는 것이 임무입니다. 확실한 수치 왜곡만 보고하십시오.",
      maxTokens: 1024,
    });

    return (parsed?.issues ?? []).map(
      (issue) =>
        `[LLM 수치 왜곡] claims[${issue.claim_index}]: ${issue.reason} — "${issue.script_excerpt}"`
    );
  } catch (err) {
    return [`[LLM 검사 오류] ${err.message} — 수동 확인 필요`];
  }
}
