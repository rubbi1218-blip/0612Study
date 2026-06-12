/**
 * check-audio.js — FFmpeg 기반 오디오 파일 검증 유틸
 *
 * 사용법:
 *   import { probeAudio, checkAudioLength, checkSilence } from "../verify-tools/check-audio.js";
 *
 *   const probe = await probeAudio("output/ep-.../audio.mp3");
 *   const errors = [
 *     ...checkAudioLength(probe.duration, expectedSeconds, 0.2),
 *     ...checkSilence(probe),
 *   ];
 */

import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";

const execFileAsync = promisify(execFile);

/**
 * ffprobe로 오디오 파일 메타데이터를 가져온다.
 * @param {string} filePath
 * @returns {Promise<{ duration: number, bitrate: number, codec: string, channels: number }>}
 */
export async function probeAudio(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`오디오 파일 없음: ${filePath}`);
  }

  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);

  const data = JSON.parse(stdout);
  const fmt = data.format ?? {};
  const stream = (data.streams ?? []).find((s) => s.codec_type === "audio");

  if (!stream) throw new Error(`오디오 스트림 없음: ${filePath}`);

  return {
    duration:  parseFloat(fmt.duration ?? stream.duration ?? "0"),
    bitrate:   parseInt(fmt.bit_rate ?? "0", 10),
    codec:     stream.codec_name ?? "unknown",
    channels:  stream.channels ?? 0,
    sampleRate: parseInt(stream.sample_rate ?? "0", 10),
  };
}

/**
 * 오디오 길이가 예상치의 ±toleranceFraction 범위 안인지 검사.
 * @param {number} actualSeconds 실제 길이 (ffprobe 결과)
 * @param {number} expectedSeconds 예상 길이
 * @param {number} toleranceFraction 허용 오차 비율 (기본 0.2 = ±20%)
 * @returns {string[]} 오류 메시지 목록
 */
export function checkAudioLength(actualSeconds, expectedSeconds, toleranceFraction = 0.2) {
  const errors = [];
  if (!actualSeconds || actualSeconds <= 0) {
    return ["오디오 길이가 0 이하이거나 측정 불가"];
  }
  const lo = expectedSeconds * (1 - toleranceFraction);
  const hi = expectedSeconds * (1 + toleranceFraction);
  if (actualSeconds < lo || actualSeconds > hi) {
    errors.push(
      `오디오 길이 범위 초과: ${actualSeconds.toFixed(1)}초 (허용: ${lo.toFixed(1)}~${hi.toFixed(1)}초)`
    );
  }
  return errors;
}

/**
 * FFmpeg silencedetect로 전체 무음 여부를 검사한다.
 * (파일 전체가 무음이면 오류 — 부분 무음은 허용)
 * @param {string} filePath
 * @returns {Promise<string[]>} 오류 메시지 목록
 */
export async function checkSilence(filePath) {
  const errors = [];
  try {
    // silencedetect: -50dB 이하가 전체 길이의 95% 이상이면 무음으로 판단
    const { stderr } = await execFileAsync("ffmpeg", [
      "-i", filePath,
      "-af", "silencedetect=noise=-50dB:d=0.5",
      "-f", "null",
      "-",
    ]);

    const silenceEndMatches = stderr.match(/silence_end:\s*([\d.]+)/g) ?? [];
    const silenceStartMatches = stderr.match(/silence_start:\s*([\d.]+)/g) ?? [];

    // 무음 구간만 있고 비무음 구간이 없으면 전체 무음
    if (silenceStartMatches.length > 0 && silenceEndMatches.length === 0) {
      errors.push("오디오 전체가 무음");
    }
  } catch (err) {
    // ffmpeg 오류는 오디오 이상으로 처리
    errors.push(`ffmpeg 무음 검사 실패: ${err.message}`);
  }
  return errors;
}

/**
 * 파일 존재 여부 + probeAudio + checkAudioLength + checkSilence 를 한번에 실행.
 * @param {string} filePath
 * @param {number} expectedSeconds
 * @param {number} [toleranceFraction]
 * @returns {Promise<{ passed: boolean, errors: string[], probe: object|null }>}
 */
export async function runAudioChecks(filePath, expectedSeconds, toleranceFraction = 0.2) {
  const errors = [];
  let probe = null;

  if (!fs.existsSync(filePath)) {
    return { passed: false, errors: [`파일 없음: ${filePath}`], probe: null };
  }

  try {
    probe = await probeAudio(filePath);
  } catch (err) {
    return { passed: false, errors: [`ffprobe 실패: ${err.message}`], probe: null };
  }

  errors.push(...checkAudioLength(probe.duration, expectedSeconds, toleranceFraction));
  errors.push(...(await checkSilence(filePath)));

  return { passed: errors.length === 0, errors, probe };
}
