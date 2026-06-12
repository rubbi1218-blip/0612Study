/**
 * V5 — 비주얼 검사
 *
 * 코드 검사: 모든 beats에 asset 배정 여부, image 타입 file_path 존재
 * LLM 비전 검사: 이미지 ↔ 비트 내용 일치, 아티팩트, 브랜드 분위기
 * 차트 검사: chart_spec 존재 여부
 *
 * 입력: { assets[] } + beats[] + canon
 * 출력: { passed, reasons[] }
 */

import fs from "fs";
import { callClaudeVision } from "../lib/claude-runner.js";

const MOCK_SIZE_THRESHOLD = 50_000; // 50KB 이하 → mock 이미지로 간주, 비전 검사 생략

/**
 * @param {{ assets: any[] }} payload
 * @param {any[]} beats
 * @param {string} canon
 * @returns {Promise<{ passed: boolean, reasons: string[] }>}
 */
export async function runV5(payload, beats, canon) {
  const errors = [];
  const { assets } = payload;

  if (!Array.isArray(assets)) {
    return { passed: false, reasons: ["assets 배열 없음"] };
  }

  // ── 코드 검사 ─────────────────────────────────────────────
  const beatIds = beats.map((b) => b.id);
  const assetBeatIds = new Set(assets.map((a) => a.beat_id));

  // 모든 beat에 asset이 있는가
  const missing = beatIds.filter((id) => !assetBeatIds.has(id));
  if (missing.length) {
    errors.push(`asset 미배정 beats: ${missing.join(", ")}`);
  }

  // image 타입은 file_path가 있어야 함
  for (const a of assets) {
    if (a.type === "image" && !a.file_path) {
      errors.push(`[B${a.beat_id}] 이미지 생성 실패: ${a.error ?? "file_path 없음"}`);
    }
  }

  // chart 타입은 chart_spec이 있어야 함
  for (const a of assets) {
    if (a.type === "chart" && !a.chart_spec) {
      errors.push(`[B${a.beat_id}] chart_spec 없음`);
    }
  }

  if (errors.length) return { passed: false, reasons: errors };

  // ── LLM 비전 검사 (image 타입만) ──────────────────────────
  const imageAssets = assets.filter(
    (a) =>
      a.type === "image" &&
      a.file_path &&
      !a.is_mock &&
      fs.existsSync(a.file_path) &&
      fs.statSync(a.file_path).size >= MOCK_SIZE_THRESHOLD
  );

  for (const asset of imageAssets) {
    const beat = beats.find((b) => b.id === asset.beat_id);
    if (!beat) continue;
    const visionErrors = await checkImageWithVision(asset.file_path, beat);
    errors.push(...visionErrors);
  }

  return { passed: errors.length === 0, reasons: errors };
}

async function checkImageWithVision(imagePath, beat) {
  const prompt = `
아래 이미지를 분석하고 결함을 찾아라.

[비트 정보]
목적: ${beat.purpose}
내용: ${beat.content}

검사 항목:
1. 이미지가 비트 내용과 시각적 연관성이 있는가?
2. 이미지에 텍스트·숫자·차트가 포함됐는가? (있으면 결함)
3. 어둡고 고급스러운 경제 채널 분위기와 맞는가?
4. 깨진 픽셀·아티팩트·왜곡이 심한가?

반드시 아래 JSON만 반환하라:
{
  "issues": [
    { "check": "항목명", "reason": "결함 설명" }
  ]
}
문제 없으면: { "issues": [] }
`.trim();

  try {
    const { parsed } = await callClaudeVision(imagePath, prompt, {
      systemPrompt: "적대적 비주얼 검사자. 확실한 결함만 보고하라.",
      maxTokens: 512,
    });
    return (parsed?.issues ?? []).map(
      (i) => `[B${beat.id} 비전] ${i.check}: ${i.reason}`
    );
  } catch (err) {
    return [`[B${beat.id} 비전 검사 오류] ${err.message}`];
  }
}
