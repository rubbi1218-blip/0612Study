/**
 * hyperframes-renderer.js — HyperFrames 기반 렌더 구현체
 *
 * D-RENDER-2: HyperFrames 선택 이유 — HTML/CSS를 그대로 영상으로 변환.
 *   에이전트가 HTML을 직접 작성·수정할 수 있어 LLM 친화적.
 *   Remotion(React 필요)보다 의존성 가벼움.
 *   탈출구: RENDER_ENGINE=remotion 으로 즉시 교체.
 *
 * 동작 방식:
 *   1. beats + assets + subtitleCues → HTML 컴포지션 파일 생성
 *   2. `npx hyperframes render <file> --output <mp4>` CLI 실행
 *   3. 결과 mp4 경로 반환
 *
 * 요구사항: Node.js >=22, FFmpeg, hyperframes npm 패키지
 * 인터페이스: render(input, episodeDir, onProgress) → { video_path, total_frames, total_seconds, decision_log }
 */

import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { processTimestamps } from "../timestamp-processor.js";
import { CONFIG } from "../../config.js";

const FPS = CONFIG.targets.fps ?? 30;

// 비트별 기본 배경색 (이미지 없을 때)
const BEAT_BG = ["#0d0d1a", "#0f1923", "#111827", "#0a0f1e", "#0c1b33", "#0f172a"];

export async function render(input, episodeDir, onProgress) {
  const { voice = {}, structure = {}, visual = {} } = input;
  const { audio_path, timestamps = [], sync_offset_ms = 0, estimated_seconds = 60 } = voice;
  const { beats = [] } = structure;
  const { assets = [] } = visual;

  const subtitleCues = processTimestamps(timestamps, sync_offset_ms);

  const totalSecs = Math.max(
    beats.reduce((s, b) => s + (b.duration_seconds ?? 0), 0),
    estimated_seconds,
    1
  );
  const totalFrames = Math.round(totalSecs * FPS);

  // 숏폼 기본 (9:16), config에 longform 설정 있으면 16:9
  const width  = 1080;
  const height = 1920;

  const compositionPath = path.join(episodeDir, "hf-composition.html");
  const outputPath      = path.join(episodeDir, "video.mp4");

  // 1. HTML 컴포지션 생성
  const html = buildComposition({ beats, assets, subtitleCues, audio_path, totalSecs, width, height });
  fs.writeFileSync(compositionPath, html, "utf8");
  console.log(`[A6/hyperframes] 컴포지션 작성: ${compositionPath}`);

  // 2. npx hyperframes render 실행
  onProgress?.(5);
  console.log(`[A6/hyperframes] 렌더 시작: ${totalSecs.toFixed(1)}초 / ${totalFrames}프레임`);

  await runHyperFrames(compositionPath, outputPath, onProgress);

  console.log("[A6/hyperframes] 렌더 완료");

  return {
    video_path:    outputPath,
    total_frames:  totalFrames,
    total_seconds: totalSecs,
    decision_log:  `[hyperframes] HTML컴포지션 렌더 / ${totalSecs.toFixed(1)}초 / 자막 ${subtitleCues.length}개`,
  };
}

// ── CLI 실행 ────────────────────────────────────────────
function runHyperFrames(compositionPath, outputPath, onProgress) {
  return new Promise((resolve, reject) => {
    // Windows: npx.cmd / POSIX: npx
    const npx  = process.platform === "win32" ? "npx.cmd" : "npx";
    const args = ["hyperframes", "render", compositionPath, "--output", outputPath];

    const proc = spawn(npx, args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10 * 60 * 1000,   // 최대 10분
    });

    let lastPct = 5;

    proc.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);

      // 진행률 파싱 (예: "Rendering... 42%", "[42/100]")
      const m = text.match(/(\d{1,3})\s*%/) ?? text.match(/\[(\d+)\/(\d+)\]/);
      if (m) {
        const pct = m[2]
          ? Math.round((parseInt(m[1], 10) / parseInt(m[2], 10)) * 100)
          : parseInt(m[1], 10);
        if (pct > lastPct) { lastPct = pct; onProgress?.(pct); }
      }
    });

    proc.stderr.on("data", (chunk) => {
      process.stderr.write(chunk.toString());
    });

    proc.on("close", (code) => {
      if (code === 0) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`[A6/hyperframes] CLI 종료 코드 ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`[A6/hyperframes] CLI 실행 실패: ${err.message}\n` +
        "hyperframes가 설치되어 있는지 확인하세요: npm i hyperframes\n" +
        "Node.js >=22 및 FFmpeg가 필요합니다."));
    });
  });
}

// ── HTML 컴포지션 생성 ────────────────────────────────────
function buildComposition({ beats, assets, subtitleCues, audio_path, totalSecs, width, height }) {
  let cumSecs = 0;

  // 비트 씬 (배경 이미지 + 텍스트)
  const beatClips = beats.map((beat, i) => {
    const start    = cumSecs;
    const duration = beat.duration_seconds ?? 0;
    cumSecs += duration;
    if (duration <= 0) return "";

    const asset    = assets[i] ?? null;
    const imgPath  = asset?.file_path ? asset.file_path.replace(/\\/g, "/") : "";
    const bgStyle  = imgPath
      ? `background:url('${imgPath}') center/cover no-repeat`
      : `background:${BEAT_BG[i % BEAT_BG.length]}`;

    const label = esc(beat.purpose ?? `BEAT ${i + 1}`);
    const desc  = esc(beat.content ?? beat.description ?? "");

    return `
  <!-- Beat ${i + 1}: ${label} -->
  <div class="clip"
       data-start="${start.toFixed(3)}"
       data-duration="${duration.toFixed(3)}"
       data-track-index="0"
       style="position:absolute;inset:0;${bgStyle}">
    <div style="position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,.25) 0%,rgba(0,0,0,.6) 100%)"></div>
    ${desc ? `<div style="position:absolute;bottom:220px;left:40px;right:40px;color:#fff;font-family:'Noto Sans KR',sans-serif">
      <div style="font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;opacity:.65;margin-bottom:10px">${label}</div>
      <div style="font-size:30px;font-weight:600;line-height:1.45">${desc}</div>
    </div>` : ""}
  </div>`;
  }).join("\n");

  // 자막 클립
  const subtitleClips = subtitleCues.map((cue) => {
    const start    = cue.start ?? 0;
    const duration = (cue.end ?? 0) - start;
    if (duration <= 0 || !cue.text) return "";
    return `
  <div class="clip"
       data-start="${start.toFixed(3)}"
       data-duration="${duration.toFixed(3)}"
       data-track-index="2"
       style="position:absolute;bottom:72px;left:28px;right:28px;text-align:center;
              background:rgba(0,0,0,.58);border-radius:10px;padding:11px 18px;
              color:#fff;font-family:'Noto Sans KR',sans-serif;font-size:24px;
              font-weight:500;line-height:1.45;letter-spacing:-.3px">
    ${esc(cue.text)}
  </div>`;
  }).join("\n");

  // 오디오 트랙
  const audioEl = audio_path
    ? `\n  <audio data-start="0" data-duration="${totalSecs.toFixed(3)}" data-volume="1.0" src="${audio_path.replace(/\\/g, "/")}"></audio>`
    : "";

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  *, *::before, *::after { margin:0; padding:0; box-sizing:border-box }
  html, body { width:${width}px; height:${height}px; overflow:hidden; background:#000 }
  #stage    { position:relative; width:${width}px; height:${height}px; overflow:hidden }
</style>
</head>
<body>
<div id="stage"
     data-composition-id="episode"
     data-width="${width}"
     data-height="${height}">
${beatClips}
${subtitleClips}${audioEl}
</div>
</body>
</html>`;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
