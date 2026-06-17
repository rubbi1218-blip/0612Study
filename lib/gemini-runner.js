/**
 * gemini-runner.js — Gemini 2.5 Flash HTTP 클라이언트
 *
 * callGemini:     googleSearch 도구 ON, 자유 텍스트 출력 (grounding 수집용)
 * callGeminiJson: 도구 없음, responseMimeType:application/json (구조화 출력용)
 *
 * 두 함수를 조합해 "검색 → 구조화" 2-pass를 구현한다.
 */

import { CONFIG } from "../config.js";

const { key, model, endpoint } = CONFIG.apis.gemini;

// ── 공통 HTTP 호출 ──────────────────────────────────────────

async function fetchGemini(body) {
  const url = `${endpoint}/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`[gemini] HTTP ${res.status}: ${errText.slice(0, 400)}`);
  }
  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate) throw new Error("[gemini] 응답에 candidates 없음");
  return candidate;
}

// ── Pass 1: googleSearch ON, 자유 텍스트 ────────────────────

/**
 * @param {string} prompt
 * @param {{ feedback?: string[], systemInstruction?: string }} [opts]
 * @returns {Promise<{ text: string, groundingMetadata: any }>}
 */
export async function callGemini(prompt, opts = {}) {
  const { feedback = [], systemInstruction } = opts;

  const cleanFeedback = feedback.map(f =>
    f.replace(/https?:\/\/\S{80,}/g, "(URL 생략)")
  );
  const fullPrompt = cleanFeedback.length
    ? `[이전 검사 실패 피드백]\n${cleanFeedback.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n\n[작업]\n${prompt}`
    : prompt;

  const body = {
    contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: { temperature: 0.2 },
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const candidate = await fetchGemini(body);
  const text = candidate.content?.parts?.map(p => p.text ?? "").join("") ?? "";
  const groundingMetadata = candidate.groundingMetadata ?? null;

  return { text, groundingMetadata };
}

// ── Pass 2: 도구 없음, responseMimeType:application/json ────

/**
 * @param {string} prompt
 * @param {{ systemInstruction?: string }} [opts]
 * @returns {Promise<{ parsed: any }>}
 */
export async function callGeminiJson(prompt, opts = {}) {
  const { systemInstruction } = opts;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const candidate = await fetchGemini(body);
  const text = candidate.content?.parts?.map(p => p.text ?? "").join("") ?? "";

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // responseMimeType:json 임에도 파싱 실패 → 호출자가 에러 처리
    parsed = null;
  }

  return { text, parsed };
}

// ── 레거시 호환: JSON 추출이 필요한 단일 호출 ─────────────

/**
 * googleSearch 없이 JSON 추출을 시도하는 단일 호출.
 * callClaude 방식과 동일한 { text, parsed } 인터페이스 유지.
 * @deprecated 새 코드는 callGemini + callGeminiJson 2-pass를 사용하라.
 */
export async function callGeminiWithJson(prompt, opts = {}) {
  const { systemInstruction } = opts;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2 },
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const candidate = await fetchGemini(body);
  const text = candidate.content?.parts?.map(p => p.text ?? "").join("") ?? "";

  let parsed = null;
  try {
    const blockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = blockMatch?.[1]?.trim() ?? extractFirstJson(text) ?? text.trim();
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  return { text, parsed };
}

// ── brace-balanced JSON 추출 ─────────────────────────────────

function extractFirstJson(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
