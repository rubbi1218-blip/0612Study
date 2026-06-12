import "dotenv/config";

export const CONFIG = {
  MAX_RETRIES: 3,
  PHASE: 0,

  paths: {
    canon: "CANON.md",
    outputBase: "output",
    stateFile: "state.json",
  },

  apis: {
    gemini: {
      key: process.env.GEMINI_API_KEY,
      model: "gemini-2.5-pro",
      endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
    },
    anthropic: {
      key: process.env.ANTHROPIC_API_KEY,
      model: "claude-opus-4-8",
    },
    elevenlabs: {
      key: process.env.ELEVENLABS_API_KEY,
      voiceId: process.env.ELEVENLABS_VOICE_ID,
      endpoint: "https://api.elevenlabs.io/v1/text-to-speech",
      model: "eleven_turbo_v2_5",
    },
    assemblyai: {
      key: process.env.ASSEMBLYAI_API_KEY,
    },
  },

  targets: {
    // 숏폼 기본값 (롱폼은 conductor.js 실행 시 오버라이드)
    format: "short",
    durationSeconds: { min: 50, max: 90 },
    charsPerSecond: 4.7,       // 한국어 TTS: ~280자/분
    maxLineChars: 20,          // 자막 한 줄 최대 글자수
    scriptLineMaxChars: 60,    // 대본 한 줄 최대 글자수 (TTS 호흡)
    claimsMin: 3,
    claimsMax: 12,
    fps: 30,                   // Remotion 렌더 프레임레이트
  },

  verification: {
    sourceMaxAgeDays: 30,      // 시장 데이터 신선도 기준
    voiceLengthTolerance: 0.2, // audio 길이 허용 오차 ±20%
    scriptCharTolerance: 0.1,  // 대본 글자수 허용 오차 ±10%
  },
};

// 필수 키 누락 시 즉시 오류 출력 (묵시적 실패 방지)
const REQUIRED_KEYS = [
  ["GEMINI_API_KEY",     CONFIG.apis.gemini.key],
  ["ANTHROPIC_API_KEY",  CONFIG.apis.anthropic.key],
  ["ELEVENLABS_API_KEY", CONFIG.apis.elevenlabs.key],
  ["ELEVENLABS_VOICE_ID",CONFIG.apis.elevenlabs.voiceId],
  ["ASSEMBLYAI_API_KEY", CONFIG.apis.assemblyai.key],
];

for (const [name, value] of REQUIRED_KEYS) {
  if (!value) {
    console.error(`[config] 필수 환경변수 누락: ${name} (.env 확인)`);
    process.exit(1);
  }
}
