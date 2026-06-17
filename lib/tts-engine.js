/**
 * lib/tts-engine.js — TTS 엔진 팩토리
 *
 * TTS_ENGINE 환경변수 또는 engineOverride 인자로 엔진 선택.
 * 지원: "elevenlabs" (기본) | "qwen3"
 *
 * 모든 엔진은 동일한 인터페이스를 구현한다:
 *   synthesize(text: string, outputPath: string)
 *   → Promise<{ audio_path: string, timestamps: Array<{word,start,end}> }>
 *
 * conductor.js 에서 --tts 플래그로 런타임 오버라이드 가능:
 *   node conductor.js "주제" --tts qwen3
 */

const SUPPORTED = ["elevenlabs", "qwen3"];

export async function getTTSEngine(engineOverride) {
  const engine = (engineOverride ?? process.env.TTS_ENGINE ?? "elevenlabs").toLowerCase();

  if (!SUPPORTED.includes(engine)) {
    throw new Error(`[tts-engine] 알 수 없는 엔진: "${engine}". 지원: ${SUPPORTED.join(", ")}`);
  }

  console.log(`[tts-engine] 엔진: ${engine}`);

  if (engine === "qwen3") return await import("./tts/qwen3-tts.js");
  return await import("./tts/elevenlabs-tts.js");
}
