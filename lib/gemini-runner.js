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

  const body = {
    contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
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
    parsed = JSON.parse(text);
  } catch {
    // JSON 파싱 실패 시 text만 반환 — 호출자가 처리
  }

  return { text, parsed, groundingMetadata };
}
