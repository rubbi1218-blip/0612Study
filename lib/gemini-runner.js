/**
 * gemini-runner.js — Gemini 2.5 Pro HTTP 클라이언트
 *
 * googleSearch 그라운딩 활성화 + JSON 구조화 출력 강제.
 * 피드백이 있으면 프롬프트 앞에 블록으로 삽입한다.
 */

import { CONFIG } from "../config.js";

const { key, model, endpoint } = CONFIG.apis.gemini;

/**
 * @param {string} prompt
 * @param {{ feedback?: string[], systemInstruction?: string }} [opts]
 * @returns {Promise<{ text: string, parsed: any, groundingMetadata: any }>}
 */
export async function callGemini(prompt, opts = {}) {
  const { feedback = [], systemInstruction } = opts;

  const fullPrompt = feedback.length
    ? `[이전 검사 실패 피드백]\n${feedback.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n\n[작업]\n${prompt}`
    : prompt;

  // googleSearch 도구와 responseMimeType:"application/json" 은 동시에 쓸 수 없음.
  // 도구 사용 시 JSON 출력은 프롬프트로 유도하고 텍스트에서 직접 파싱한다.
  const body = {
    contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: {
      temperature: 0.2,
    },
  };

  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const url = `${endpoint}/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`[gemini] HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate) throw new Error("[gemini] 응답에 candidates 없음");

  const text = candidate.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const groundingMetadata = candidate.groundingMetadata ?? null;

  let parsed = null;
  try {
    // 1순위: 코드 블록 안의 JSON
    const blockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    // 2순위: { } 로 감싸진 첫 번째 JSON 객체
    const braceMatch = text.match(/(\{[\s\S]*\})/);
    // 3순위: 전체 텍스트 그대로
    const raw = blockMatch?.[1]?.trim() ?? braceMatch?.[1]?.trim() ?? text.trim();
    parsed = JSON.parse(raw);
  } catch {
    // JSON 파싱 실패 시 text만 반환 — 호출자가 처리
  }

  return { text, parsed, groundingMetadata };
}
