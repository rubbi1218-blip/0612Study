/**
 * A5 — 비주얼 에이전트
 *
 * 비트별 asset 유형 결정 후 이미지 생성 또는 차트 스펙 반환.
 * "chart" 타입은 AI 이미지 생성 금지 → A6(Remotion)에서 코드로 렌더링.
 * "image" 타입은 Gemini Imagen 3로 생성.
 *
 * 입력: { beats[], lines[], claims[] } + canon + feedback[]
 * 출력: { assets[], decision_log }
 *   asset = { beat_id, type:"image"|"chart", file_path?, is_mock?, chart_spec? }
 */

import path from "path";
import { callClaude } from "../lib/claude-runner.js";
import { generateImage } from "../lib/imagen-runner.js";

/**
 * @param {{ beats: any[], lines: string[], claims: any[] }} input
 * @param {string} canon
 * @param {string[]} [feedback]
 * @param {string} episodeDir
 */
export async function runA5(input, canon, feedback = [], episodeDir) {
  const { beats, claims } = input;

  // Step 1: Claude가 각 비트를 image/chart로 분류하고 프롬프트/스펙 생성
  const classifications = await classifyBeats(beats, claims, canon, feedback);

  // Step 2: asset 생성
  const assets = [];

  for (const item of classifications) {
    if (item.type === "chart") {
      assets.push({
        beat_id: item.beat_id,
        type: "chart",
        chart_spec: item.chart_spec ?? null,
      });
    } else {
      const filename = `beat-${item.beat_id}.png`;
      const outputPath = path.join(episodeDir, filename);
      try {
        await generateImage(item.image_prompt, outputPath);
        assets.push({
          beat_id: item.beat_id,
          type: "image",
          file_path: outputPath,
          image_prompt: item.image_prompt,
        });
      } catch (err) {
        assets.push({
          beat_id: item.beat_id,
          type: "image",
          file_path: null,
          error: err.message,
          image_prompt: item.image_prompt,
        });
      }
    }
  }

  const charts = assets.filter((a) => a.type === "chart").length;
  const images = assets.filter((a) => a.type === "image" && a.file_path).length;
  const errors = assets.filter((a) => a.error).length;
  const decision_log =
    `beats ${beats.length}개 → chart ${charts}개 / image ${images}개` +
    (errors ? ` / 생성 오류 ${errors}개` : "");

  return { assets, decision_log };
}

async function classifyBeats(beats, claims, canon, feedback) {
  const beatList = beats
    .map(
      (b) =>
        `[B${b.id}] 목적: ${b.purpose} / 내용: ${b.content} / claim_refs: [${(b.claim_refs ?? []).join(",")}]`
    )
    .join("\n");

  const claimList = claims
    .map((c, i) => `[C${i + 1}] ${c.text} — 수치: ${c.value}`)
    .join("\n");

  const prompt = `
아래 비트시트와 claims를 분석하여 각 비트의 시각 자료 유형을 결정하고, 유형별 스펙을 작성하라.

[비트시트]
${beatList}

[검증된 Claims]
${claimList}

[분류 기준]
- "chart": 비트가 데이터 비교·추이·통계를 직접 보여줘야 할 때. AI 이미지 생성 절대 금지.
- "image": 분위기·배경·상황을 표현하는 비트 (Hook, 결론, 맥락 설명 등).

[image_prompt 작성 규칙]
- 영어로 작성 (이미지 생성 모델은 영어 프롬프트가 더 정확함)
- 세로형 9:16, 시네마틱, 어둡고 고급스러운 느낌
- 텍스트·숫자·차트·그래프는 절대 포함하지 마라
- 경제·금융 채널: 차갑고 분석적인 시각 분위기

[chart_spec 작성 규칙]
- type: "bar" | "line" | "area" 중 가장 적합한 것
- data: claims의 수치를 반드시 그대로 사용 (절대 변형 금지)
- unit: 단위 (%, 달러, 억원 등)

반드시 아래 JSON만 반환하라:
{
  "classifications": [
    {
      "beat_id": 1,
      "type": "image",
      "image_prompt": "Dark cinematic shot of empty trading floor, dramatic lighting, 9:16 vertical, no text"
    },
    {
      "beat_id": 2,
      "type": "chart",
      "chart_spec": {
        "title": "차트 제목",
        "type": "bar",
        "unit": "%",
        "data": [{"label": "항목명", "value": 5.2}]
      }
    }
  ]
}
`.trim();

  const { parsed } = await callClaude(prompt, {
    systemPrompt:
      "당신은 경제 채널 비주얼 디렉터입니다. 각 비트에 최적의 시각 자료를 배정하십시오.",
    feedback,
    maxTokens: 1024,
  });

  return Array.isArray(parsed?.classifications) ? parsed.classifications : [];
}
