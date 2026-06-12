/**
 * M1 — 최종 검사 (종단)
 *
 * 파이프라인 전 단계 완료 후 실행하는 종단 품질 검사.
 * 단계별 오류 누적을 잡는다.
 *
 * 코드 검사:
 *   - 모든 스테이지가 verified + human_approved 상태인가
 *   - video.mp4 파일이 존재하는가
 *   - claims 수치 ↔ chart_spec 수치 최종 일치 (소수점 오차 ±5% 허용)
 *
 * LLM 검사 (Claude, 별개 인스턴스):
 *   - 대본이 최초 주제와 의도를 이행했는가
 *   - 페르소나가 대본 전체에서 일관됐는가
 *   - CANON 금기가 대본 어디에도 없는가
 *
 * 입력: state (전 스테이지 페이로드 접근), canon, topic
 * 출력: { passed, reasons[] }
 */

import fs from "fs";
import { callClaude } from "../lib/claude-runner.js";

/**
 * @param {import("../lib/state-manager.js").StateManager} state
 * @param {string} canon
 * @param {string} topic
 * @returns {Promise<{ passed: boolean, reasons: string[] }>}
 */
export async function runM1(state, canon, topic) {
  const errors = [];

  // ── 코드 검사 1: 모든 스테이지 완료 여부 ───────────────────
  const REQUIRED_STAGES = ["research", "structure", "script", "voice", "visual", "render"];
  for (const stage of REQUIRED_STAGES) {
    if (!state.isStageComplete(stage)) {
      errors.push(`스테이지 미완료: ${stage}`);
    }
  }

  // ── 코드 검사 2: video.mp4 존재 ────────────────────────────
  const videoPath = state.getPayload("render")?.video_path;
  if (!videoPath || !fs.existsSync(videoPath)) {
    errors.push(`video.mp4 없음: ${videoPath ?? "(경로 없음)"}`);
  }

  // ── 코드 검사 3: claims ↔ chart_spec 수치 일치 ────────────
  const claims  = state.getPayload("research")?.claims ?? [];
  const assets  = state.getPayload("visual")?.assets  ?? [];
  const numErrors = checkNumberConsistency(claims, assets);
  errors.push(...numErrors);

  if (errors.length) return { passed: false, reasons: errors };

  // ── LLM 검사: 주제이행 · 페르소나 · CANON 금기 ────────────
  const script = state.getPayload("script");
  const intent = state._state.intent ?? "";
  const llmErrors = await checkWithLLM(topic, intent, script?.lines ?? [], claims, canon);
  errors.push(...llmErrors);

  return { passed: errors.length === 0, reasons: errors };
}

// ── 수치 정합 검사 ────────────────────────────────────────────
function checkNumberConsistency(claims, assets) {
  const errors = [];
  const chartAssets = assets.filter((a) => a.type === "chart" && a.chart_spec?.data);

  for (const asset of chartAssets) {
    for (const point of asset.chart_spec.data) {
      const val = point.value;
      if (val === undefined || val === null) continue;

      // 해당 수치가 claims 중 하나와 ±5% 이내로 매칭되는가
      const matched = claims.some((c) => {
        const claimNum = parseFloat(String(c.value).replace(/[^0-9.\-]/g, ""));
        if (isNaN(claimNum)) return false;
        return Math.abs(claimNum - val) / Math.max(Math.abs(claimNum), 0.001) <= 0.05;
      });

      if (!matched) {
        errors.push(
          `[M1 수치불일치] 차트 beat_id=${asset.beat_id} 값 ${val}이 claims 원본과 ±5% 이상 차이`
        );
      }
    }
  }
  return errors;
}

// ── LLM 종단 검사 ─────────────────────────────────────────────
async function checkWithLLM(topic, intent, scriptLines, claims, canon) {
  const script = scriptLines.join("\n");
  const claimSummary = claims
    .slice(0, 8)
    .map((c, i) => `[C${i + 1}] ${c.text} (${c.value})`)
    .join("\n");

  const prompt = `
당신은 적대적 최종 검사자입니다. 아래 영상 대본이 기준을 위반하는지 검사하라.

[최초 주제]
${topic}

[이번 편 의도]
${intent || "(없음)"}

[채널 기준(CANON)]
${canon}

[핵심 Claims (수집된 팩트)]
${claimSummary}

[최종 대본]
${script}

검사 항목:
1. 대본이 최초 주제를 실질적으로 다루고 있는가? (단순 언급이 아닌 핵심 내용 포함)
2. 페르소나(스마트한 동료, 냉철한 분석가)가 대본 전체에서 일관됐는가?
3. CANON 금기 표현("함께", "우리", "파이팅", 종목 매수/매도 추천 등)이 없는가?
4. 대본의 수치·사실이 제공된 claims를 심각하게 왜곡하지 않았는가?
5. 첫 3초(= 첫 1~2줄)에 시청자를 잡는 Hook이 있는가?

반드시 아래 JSON만 반환하라:
{
  "issues": [
    { "check": "항목명", "reason": "결함 설명 (한국어)" }
  ]
}
문제 없으면: { "issues": [] }
`.trim();

  try {
    const { parsed } = await callClaude(prompt, {
      systemPrompt: "결함을 찾아내는 것이 임무입니다. 확실한 문제만 보고하십시오.",
      maxTokens: 768,
    });
    return (parsed?.issues ?? []).map((i) => `[M1 LLM] ${i.check}: ${i.reason}`);
  } catch (err) {
    return [`[M1 LLM 오류] ${err.message} — 수동 확인 필요`];
  }
}
