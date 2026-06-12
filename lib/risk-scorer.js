/**
 * risk-scorer.js — 에피소드 위험점수 계산
 *
 * 산출물의 위험 요소를 수치화한다. 점수가 낮으면 사람 승인 없이
 * Confidence Gate가 자동으로 통과시킬 수 있다. (§4 참고)
 *
 * 점수 기준 (0~100):
 *   0~29  LOW    — 자동 승인 후보
 *   30~59 MEDIUM — 기본 동작 (사람 확인)
 *   60~   HIGH   — 반드시 사람 확인
 *
 * 위험 요소:
 *   - 수치 claims 수 (많을수록 오류 가능성 ↑)
 *   - 회사·종목명 직접 언급
 *   - 단기 예측 표현 ("~될 것", "~오른다")
 *   - 부정적 단어 밀도 (위기, 폭락, 붕괴)
 */

export function computeRiskScore(state) {
  const claims   = state.getPayload("research")?.claims  ?? [];
  const lines    = state.getPayload("script")?.lines     ?? [];
  const fullText = lines.join(" ");

  let score = 0;

  // 1. 수치 claims 수 (claim당 3점, 최대 30점)
  const numericClaims = claims.filter((c) => /[\d.]+/.test(String(c.value ?? "")));
  score += Math.min(numericClaims.length * 3, 30);

  // 2. 회사/종목 직접 언급 (각 20점)
  const tickerPattern = /\b[A-Z]{2,5}\b/g;          // 영어 대문자 연속 (티커 패턴)
  const korCorpPattern = /(?:삼성|SK|현대|LG|카카오|네이버|하이브|크래프톤|엔씨)/g;
  const tickers   = fullText.match(tickerPattern) ?? [];
  const korCorps  = fullText.match(korCorpPattern) ?? [];
  score += Math.min((tickers.length + korCorps.length) * 20, 40);

  // 3. 단기 예측 표현 (각 10점)
  const forecastPatterns = [
    /오를\s*것/, /내릴\s*것/, /상승할\s*전망/, /하락할\s*전망/,
    /될\s*것이다/, /반드시/, /확실히/,
  ];
  for (const p of forecastPatterns) {
    if (p.test(fullText)) score += 10;
  }
  score = Math.min(score, 100);

  const level = score < 30 ? "LOW" : score < 60 ? "MEDIUM" : "HIGH";
  return { score, level };
}
