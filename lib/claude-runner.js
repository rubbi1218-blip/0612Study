/**
 * claude-runner.js — Anthropic SDK 래퍼
 *
 * Conductor(Claude Code) 와 별개 인스턴스로 호출되어야 한다.
 * 자기 결과를 자기가 검사하는 것을 방지하기 위해
 * 이 모듈을 통해서만 Claude API를 호출한다.
 */

import fs from "fs";
import Anthropic from "@anthropic-ai/sdk";
import { CONFIG } from "../config.js";

const client = new Anthropic({ apiKey: CONFIG.apis.anthropic.key });
const { model } = CONFIG.apis.anthropic;

/**
 * @param {string} prompt
 * @param {{ systemPrompt?: string, feedback?: string[], maxTokens?: number }} [opts]
 * @returns {Promise<{ text: string, parsed: any }>}
 */
export async function callClaude(prompt, opts = {}) {
  const { systemPrompt, feedback = [], maxTokens = 4096 } = opts;

  const fullPrompt = feedback.length
    ? `[이전 검사 실패 피드백]\n${feedback.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n\n[작업]\n${prompt}`
    : prompt;

  const messages = [{ role: "user", content: fullPrompt }];

  const params = {
    model,
    max_tokens: maxTokens,
    messages,
  };
  if (systemPrompt) params.system = systemPrompt;

  const response = await client.messages.create(params);

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  let parsed = null;
  // JSON 코드 블록이 있으면 추출, 없으면 전체 파싱 시도
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  try {
    parsed = JSON.parse(jsonMatch ? jsonMatch[1].trim() : text.trim());
  } catch {
    // 파싱 실패 시 text만 반환 — 호출자가 처리
  }

  return { text, parsed };
}

/**
 * Claude 비전 API — 이미지 + 텍스트 프롬프트
 * @param {string} imagePath 이미지 파일 경로 (.png | .jpg)
 * @param {string} textPrompt
 * @param {{ systemPrompt?: string, maxTokens?: number }} [opts]
 */
export async function callClaudeVision(imagePath, textPrompt, opts = {}) {
  const { systemPrompt, maxTokens = 1024 } = opts;

  const imageData = fs.readFileSync(imagePath);
  const base64 = imageData.toString("base64");
  const mimeType = /\.(jpg|jpeg)$/i.test(imagePath) ? "image/jpeg" : "image/png";

  const messages = [
    {
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
        { type: "text", text: textPrompt },
      ],
    },
  ];

  const params = { model, max_tokens: maxTokens, messages };
  if (systemPrompt) params.system = systemPrompt;

  const response = await client.messages.create(params);
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  let parsed = null;
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  try {
    parsed = JSON.parse(jsonMatch ? jsonMatch[1].trim() : text.trim());
  } catch {}

  return { text, parsed };
}
