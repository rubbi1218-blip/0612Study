/**
 * V6 — 렌더 검사
 *
 * 코드 검사: 유효 MP4 / 비디오+오디오 스트림 / 해상도 / 길이 / FPS / 샘플 프레임
 * LLM 비전 검사: 샘플 프레임 글리치 점검 (통과/실패 수준의 심각한 결함만)
 *
 * 입력: { video_path, total_frames, total_seconds }
 * 출력: { passed, reasons[] }
 */

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { callClaudeVision } from "../lib/claude-runner.js";
import { CONFIG } from "../config.js";

const execFileAsync = promisify(execFile);
const EXPECTED_WIDTH  = 1080;
const EXPECTED_HEIGHT = 1920;
const FPS_TOLERANCE   = 1;
const DUR_TOLERANCE   = 0.15; // ±15%

/**
 * @param {{ video_path: string, total_frames: number, total_seconds: number }} payload
 * @returns {Promise<{ passed: boolean, reasons: string[] }>}
 */
export async function runV6(payload) {
  const errors = [];
  const { video_path, total_seconds } = payload;

  // ── 파일 존재 ────────────────────────────────────────────
  if (!video_path || !fs.existsSync(video_path)) {
    return { passed: false, reasons: [`video.mp4 없음: ${video_path ?? "(경로 없음)"}`] };
  }

  // ── ffprobe 스트림 분석 ──────────────────────────────────
  let probe;
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet",
      "-print_format", "json",
      "-show_streams",
      "-show_format",
      video_path,
    ]);
    probe = JSON.parse(stdout);
  } catch (err) {
    return { passed: false, reasons: [`ffprobe 실패: ${err.message}`] };
  }

  const videoStream = probe.streams?.find((s) => s.codec_type === "video");
  const audioStream = probe.streams?.find((s) => s.codec_type === "audio");

  if (!videoStream) errors.push("비디오 스트림 없음");
  if (!audioStream) errors.push("오디오 스트림 없음");

  if (videoStream) {
    // 해상도
    if (videoStream.width !== EXPECTED_WIDTH || videoStream.height !== EXPECTED_HEIGHT) {
      errors.push(
        `해상도 오류: ${videoStream.width}x${videoStream.height} (예상: ${EXPECTED_WIDTH}x${EXPECTED_HEIGHT})`
      );
    }

    // FPS
    const [num, den] = (videoStream.r_frame_rate ?? "30/1").split("/").map(Number);
    const fps = den ? num / den : 30;
    if (Math.abs(fps - CONFIG.targets.fps) > FPS_TOLERANCE) {
      errors.push(`FPS 오류: ${fps.toFixed(1)} (예상: ${CONFIG.targets.fps})`);
    }

    // 길이
    const duration = parseFloat(probe.format?.duration ?? videoStream.duration ?? "0");
    if (total_seconds && duration > 0) {
      const lo = total_seconds * (1 - DUR_TOLERANCE);
      const hi = total_seconds * (1 + DUR_TOLERANCE);
      if (duration < lo || duration > hi) {
        errors.push(
          `영상 길이 범위 초과: ${duration.toFixed(1)}초 (허용: ${lo.toFixed(1)}~${hi.toFixed(1)}초)`
        );
      }
    }
  }

  if (errors.length) return { passed: false, reasons: errors };

  // ── 샘플 프레임 추출 (50% 지점) ──────────────────────────
  const samplePath = video_path.replace(/\.mp4$/, "_v6sample.png");
  let sampleExtracted = false;
  try {
    const sampleSec = (total_seconds ?? 30) * 0.5;
    await execFileAsync("ffmpeg", [
      "-y", "-ss", String(sampleSec),
      "-i", video_path,
      "-vframes", "1", "-q:v", "2",
      samplePath,
    ]);
    sampleExtracted = fs.existsSync(samplePath);
  } catch (err) {
    errors.push(`샘플 프레임 추출 실패: ${err.message}`);
  }

  // ── LLM 비전 검사 (심각한 글리치만) ─────────────────────
  if (sampleExtracted && fs.statSync(samplePath).size > 10_000) {
    try {
      const { parsed } = await callClaudeVision(samplePath,
        `이 영상 프레임에서 심각한 결함을 찾아라.
검사 항목:
1. 화면 전체 블랙아웃 또는 녹색/핑크 화면 (렌더 실패)
2. 자막 텍스트가 잘리거나 겹치는가?
3. 심각한 픽셀 깨짐·아티팩트가 있는가?
화면이 정상적으로 내용을 보여주면 issues는 빈 배열이다.
JSON만 반환: { "issues": [{ "check": "항목", "reason": "설명" }] }`,
        { systemPrompt: "비디오 품질 검사자. 확실한 렌더 오류만 보고하라.", maxTokens: 256 }
      );
      const visionIssues = parsed?.issues ?? [];
      errors.push(...visionIssues.map((i) => `[비전] ${i.check}: ${i.reason}`));
    } catch (err) {
      // 비전 검사 실패는 경고로만 처리 (코드 검사 통과 시)
      console.warn(`[V6] 비전 검사 오류 (무시): ${err.message}`);
    }
  }

  // 샘플 파일 정리
  if (sampleExtracted && fs.existsSync(samplePath)) {
    try { fs.unlinkSync(samplePath); } catch {}
  }

  return { passed: errors.length === 0, reasons: errors };
}
