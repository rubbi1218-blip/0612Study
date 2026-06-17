/**
 * render-engine.js — 렌더러 팩토리
 *
 * RENDER_ENGINE 환경변수(또는 --renderer 플래그로 오버라이드)를 읽어
 * 올바른 렌더러 모듈을 동적으로 반환한다.
 *
 * 지원 렌더러: remotion | hyperframes
 * 기본값: remotion
 */

const SUPPORTED = ["remotion", "hyperframes"];

/**
 * @param {string} [engineOverride] conductor.js --renderer 플래그로 전달된 값
 * @returns {Promise<{ render: Function }>}
 */
export async function getRenderEngine(engineOverride) {
  const engine = (engineOverride ?? process.env.RENDER_ENGINE ?? "remotion").toLowerCase();

  if (!SUPPORTED.includes(engine)) {
    throw new Error(
      `[render-engine] 알 수 없는 렌더러: "${engine}". ` +
      `지원: ${SUPPORTED.join(" | ")}`
    );
  }

  console.log(`[render-engine] 렌더러: ${engine}`);

  if (engine === "hyperframes") {
    return await import("./renderers/hyperframes-renderer.js");
  }
  return await import("./renderers/remotion-renderer.js");
}
