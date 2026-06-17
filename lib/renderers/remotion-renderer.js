/**
 * remotion-renderer.js — Remotion 기반 렌더 구현체
 *
 * D-RENDER-1: Remotion 선택 이유 — React 컴포넌트로 자막·비트 레이아웃을
 * 선언적으로 기술 가능. 탈출구: RENDER_ENGINE=hyperframes 로 즉시 교체.
 *
 * 인터페이스: render(input, episodeDir) → { video_path, total_frames, total_seconds, decision_log }
 */

import path from "path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { processTimestamps } from "../timestamp-processor.js";
import { CONFIG } from "../../config.js";

const FPS = CONFIG.targets.fps;
const ENTRY_POINT = new URL("../../remotion/index.jsx", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/**
 * @param {{ voice: object, structure: object, visual: object }} input
 * @param {string} episodeDir
 * @returns {Promise<{ video_path: string, total_frames: number, total_seconds: number, decision_log: string }>}
 */
export async function render(input, episodeDir, onProgress) {
  const { voice = {}, structure = {}, visual = {} } = input;
  const { audio_path, timestamps = [], sync_offset_ms = 0, estimated_seconds = 60 } = voice;
  const { beats = [] } = structure;
  const { assets = [] } = visual;

  const subtitleCues = processTimestamps(timestamps, sync_offset_ms);
  const wordCues = timestamps.map((t) => ({
    word:       t.word,
    startFrame: Math.round(Math.max(0, t.start ?? 0) * FPS),
    endFrame:   Math.round(Math.max(0, t.end   ?? 0) * FPS),
  }));

  const totalSecs = Math.max(
    beats.reduce((s, b) => s + (b.duration_seconds ?? 0), 0),
    estimated_seconds,
    1
  );
  const totalFrames = Math.round(totalSecs * FPS);

  let cumSecs = 0;
  const beatsWithFrames = beats.map((beat) => {
    const startFrame = Math.round((cumSecs / totalSecs) * totalFrames);
    cumSecs += beat.duration_seconds ?? 0;
    return { ...beat, startFrame, endFrame: Math.round((cumSecs / totalSecs) * totalFrames) };
  });

  const outputPath  = path.join(episodeDir, "video.mp4");
  const inputProps  = { beats: beatsWithFrames, assets, subtitleCues, wordCues, audioPath: audio_path ?? "", totalFrames };

  console.log("[A6/remotion] 번들 중...");
  const bundleLocation = await bundle({ entryPoint: ENTRY_POINT });

  const composition = await selectComposition({ serveUrl: bundleLocation, id: "Episode", inputProps });

  console.log(`[A6/remotion] 렌더 시작: ${totalFrames}프레임 / ${totalSecs.toFixed(1)}초`);
  await renderMedia({
    composition,
    serveUrl:       bundleLocation,
    codec:          "h264",
    outputLocation: outputPath,
    inputProps,
    onProgress: ({ progress }) => {
      const pct = Math.round(progress * 100);
      process.stdout.write(`\r[A6/remotion] ${pct}%`);
      onProgress?.(pct);
    },
  });
  console.log("\n[A6/remotion] 렌더 완료");

  return {
    video_path:    outputPath,
    total_frames:  totalFrames,
    total_seconds: totalSecs,
    decision_log:  `[remotion] ${totalFrames}프레임 / ${totalSecs.toFixed(1)}초 / 자막 ${subtitleCues.length}개`,
  };
}
