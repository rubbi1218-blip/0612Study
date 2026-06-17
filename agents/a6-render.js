/**
 * A6 — 렌더 에이전트
 *
 * render-engine.js 팩토리를 통해 RENDER_ENGINE 환경변수에 따라
 * remotion 또는 hyperframes 렌더러를 동적으로 선택한다.
 *
 * 입력: { voice, structure, visual } + episodeDir
 * 출력: { video_path, total_frames, total_seconds, decision_log }
 */

import { getRenderEngine } from "../lib/render-engine.js";

/**
 * @param {{ voice: object, structure: object, visual: object }} input
 * @param {string} _canon
 * @param {string[]} _feedback
 * @param {string} episodeDir
 * @param {object} [_state]
 * @param {string} [rendererOverride] conductor.js --renderer 플래그
 */
export async function runA6(input, _canon, _feedback, episodeDir, _state, rendererOverride, onProgress) {
  const engine = await getRenderEngine(rendererOverride);
  return await engine.render(input, episodeDir, onProgress);
}
