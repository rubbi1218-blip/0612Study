/**
 * lib/tts/elevenlabs-tts.js — ElevenLabs TTS 어댑터
 *
 * 공통 인터페이스: synthesize(text, outputPath)
 * → { audio_path, timestamps }
 */

import { callElevenLabs } from "../elevenlabs-runner.js";

export async function synthesize(text, outputPath) {
  return await callElevenLabs(text, outputPath);
}
