/**
 * lib/tts/qwen3-tts.js — Qwen3-TTS 어댑터
 *
 * 공통 인터페이스: synthesize(text, outputPath)
 * → { audio_path, timestamps }
 *
 * Python subprocess로 qwen3-tts/run_tts.py 를 호출한다.
 * 출력 포맷: WAV (24kHz). outputPath 확장자는 .wav 로 강제 변환.
 *
 * 환경변수:
 *   QWEN3_VENV_PYTHON  — venv Python 실행 파일 경로
 *   QWEN3_MODEL_DIR    — 모델 디렉터리 경로
 *   QWEN3_REF_AUDIO    — 레퍼런스 오디오 경로 (목소리 클로닝용, 선택)
 *   QWEN3_REF_TEXT     — 레퍼런스 텍스트 전사본 (선택)
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(__dirname, "../../qwen3-tts/run_tts.py");

const PYTHON     = process.env.QWEN3_VENV_PYTHON;
const MODEL_DIR  = process.env.QWEN3_MODEL_DIR;
const REF_AUDIO  = process.env.QWEN3_REF_AUDIO  ?? "";
const REF_TEXT   = process.env.QWEN3_REF_TEXT   ?? "";

export async function synthesize(text, outputPath) {
  if (!PYTHON)    throw new Error("[qwen3-tts] QWEN3_VENV_PYTHON 환경변수 없음");
  if (!MODEL_DIR) throw new Error("[qwen3-tts] QWEN3_MODEL_DIR 환경변수 없음");

  // Qwen3-TTS는 WAV 출력 → 확장자 .wav 로 교체
  const wavPath = outputPath.replace(/\.[^.]+$/, ".wav");

  const result = await runPython([SCRIPT_PATH, MODEL_DIR, text, wavPath, REF_AUDIO, REF_TEXT]);

  if (result.error) throw new Error(`[qwen3-tts] Python 오류: ${result.error}`);

  return { audio_path: wavPath, timestamps: result.timestamps ?? [] };
}

function runPython(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      // stderr는 경고·모델 로딩 로그 — info로만 출력
      if (stderr.trim()) {
        for (const line of stderr.trim().split("\n")) {
          console.log(`[qwen3-tts] ${line}`);
        }
      }

      // stdout 마지막 JSON 줄 파싱
      const lines = stdout.trim().split("\n").filter(Boolean);
      const lastLine = lines[lines.length - 1] ?? "";
      try {
        resolve(JSON.parse(lastLine));
      } catch {
        reject(new Error(`[qwen3-tts] 출력 파싱 실패 (code=${code}): ${lastLine}`));
      }
    });

    proc.on("error", reject);
  });
}
