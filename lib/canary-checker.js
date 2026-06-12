/**
 * canary-checker.js — 업로드 후 지표 감시 (Canary)
 *
 * 업로드 직후 유튜브 지표(조회수·이탈률·좋아요율)를 모니터링한다.
 * 이상 지표 감지 시 자동 비공개 제안.
 *
 * 현재 상태: STUB (YouTube Data API v3 키 미설정)
 * YouTube Data API 설정 후 아래 TODO를 구현한다.
 *
 * 활성화 방법:
 *   1. Google Cloud Console에서 YouTube Data API v3 활성화
 *   2. .env에 YOUTUBE_API_KEY 또는 OAuth2 토큰 추가
 *   3. runCanary() 본문 구현
 */

import { CONFIG } from "../config.js";

/**
 * 업로드된 영상의 초기 지표를 감시한다.
 *
 * @param {string} videoId 유튜브 영상 ID (업로드 후 획득)
 * @param {number} [watchMinutes] 감시 시간 (분)
 * @returns {Promise<{ ok: boolean, warnings: string[] }>}
 */
export async function runCanary(videoId, watchMinutes = 30) {
  const warnings = [];

  if (!process.env.YOUTUBE_API_KEY) {
    console.warn("[Canary] YouTube Data API 키 없음 — 지표 감시 건너뜀 (stub 모드)");
    return { ok: true, warnings: ["[Canary] stub 모드: YouTube API 미설정"] };
  }

  // TODO: YouTube Data API v3 구현
  // 1. GET /youtube/v3/videos?id={videoId}&part=statistics
  // 2. 30분 단위로 polling (watchMinutes)
  // 3. 이탈률 > 70% 또는 싫어요율 > 15% → warning
  // 4. 조회수 1시간 내 0 → 메타데이터 문제 의심

  console.warn("[Canary] YouTube Data API stub — 실제 지표 감시 미구현");
  warnings.push("Canary stub: YouTube Data API 설정 후 활성화 필요");

  return { ok: true, warnings };
}

/**
 * 지표 이상 시 자동 비공개 제안 메시지를 출력한다.
 * @param {string[]} warnings
 */
export function presentCanaryWarning(warnings) {
  if (!warnings.length) return;
  console.log("\n⚠️  [Canary] 지표 이상 감지 — 아래 사항을 확인하십시오:");
  warnings.forEach((w, i) => console.log(`   ${i + 1}. ${w}`));
  console.log("   → 유튜브 스튜디오에서 비공개로 전환을 고려하십시오.\n");
}
