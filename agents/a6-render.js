/**
 * A6 — 렌더 에이전트 (Remotion 기반)
 *
 * 입력: { voice: { audio_path, timestamps, sync_offset_ms, estimated_seconds },
 *         structure: { beats },
 *         visual: { assets } }
 * 출력: { video_path, total_frames, total_seconds, decision_log }
 *
 * Remotion이 headless Chrome으로 각 프레임을 렌더링하고 video.mp4를 생성한다.
 */

import path from "path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { processTimestamps } from "../lib/timestamp-processor.js";
import { CONFIG } from "../config.js";

const FPS = CONFIG.targets.fps;
const ENTRY_POINT = new URL("../remotion/index.jsx", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/**
 * @param {{ voice: object, structure: object, visual: object }} input
 * @param {string} _canon
 * @param {string[]} _feedback
 * @param {string} episodeDir
 */
export async function runA6(input, _canon, _feedback, episodeDir) {
  const { voice = {}, structure = {}, visual = {} } = input;
  const { audio_path, timestamps = [], sync_offset_ms = 0, estimated_seconds = 60 } = voice;
  const { beats = [] } = structure;
  const { assets = [] } = visual;

  // ── 1. 자막 큐 생성 ──────────────────────────────────────
  const subtitleCues = processTimestamps(timestamps, sync_offset_ms);

  // ── 2. 단어 큐 생성 (WordHighlight용) ───────────────────
  const wordCues = timestamps.map((t) => ({
    word: t.word,
    startFrame: Math.round(Math.max(0, (t.start ?? 0)) * FPS),
    endFrame:   Math.round(Math.max(0, (t.end   ?? 0)) * FPS),
  }));

  // ── 3. 비트별 프레임 범위 계산 ──────────────────────────
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
    const endFrame = Math.round((cumSecs / totalSecs) * totalFrames);
    return { ...beat, startFrame, endFrame };
  });

  const outputPath = path.join(episodeDir, "video.mp4");

  const inputProps = {
    beats: beatsWithFrames,
    assets,
    subtitleCues,
    wordCues,
    audioPath: audio_path ?? "",
    totalFrames,
  };

  // ── 4. Remotion 번들 ────────────────────────────────────
  console.log("[A6] Remotion 번들 중...");
  const bundleLocation = await bundle({ entryPoint: ENTRY_POINT });

  // ── 5. 컴포지션 선택 ────────────────────────────────────
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "Episode",
    inputProps,
  });

  // ── 6. 렌더 ────────────────────────────────────────────
  console.log(`[A6] 렌더 시작: ${totalFrames}프레임 / ${totalSecs.toFixed(1)}초`);
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: outputPath,
    inputProps,
    onProgress: ({ progress }) => {
      if (Math.round(progress * 100) % 20 === 0) {
        process.stdout.write(`\r[A6] 렌더: ${Math.round(progress * 100)}%`);
      }
    },
  });
  console.log("\n[A6] 렌더 완료");

  const decision_log =
    `렌더 완료: ${totalFrames}프레임 / ${totalSecs.toFixed(1)}초 / ` +
    `자막 ${subtitleCues.length}개 / 비트 ${beatsWithFrames.length}개`;

  return { video_path: outputPath, total_frames: totalFrames, total_seconds: totalSecs, decision_log };
}
