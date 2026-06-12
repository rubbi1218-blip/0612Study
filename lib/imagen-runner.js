/**
 * imagen-runner.js — Gemini Imagen 3 이미지 생성 클라이언트
 *
 * 모델: imagen-3.0-generate-002
 * 출력: PNG 파일을 outputPath에 저장
 */

import fs from "fs";
import { CONFIG } from "../config.js";

const IMAGEN_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict";

/**
 * @param {string} prompt 영어 이미지 프롬프트
 * @param {string} outputPath 저장 경로 (.png)
 * @param {"9:16"|"16:9"|"1:1"} [aspectRatio]
 * @returns {Promise<string>} outputPath
 */
export async function generateImage(prompt, outputPath, aspectRatio = "9:16") {
  const url = `${IMAGEN_ENDPOINT}?key=${CONFIG.apis.gemini.key}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`[imagen] HTTP ${res.status}: ${errText.slice(0, 400)}`);
  }

  const data = await res.json();
  const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) {
    throw new Error(`[imagen] 응답에 이미지 없음: ${JSON.stringify(data).slice(0, 300)}`);
  }

  fs.writeFileSync(outputPath, Buffer.from(b64, "base64"));
  return outputPath;
}
