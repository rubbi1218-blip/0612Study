/**
 * calibration-logger.js — Verifier 판단 vs 사람 판단 기록
 *
 * 사람 승인/거부 결정과 그 시점의 Verifier 통과 여부를 JSONL에 기록한다.
 * 이 데이터가 쌓이면 Confidence Gate가 어떤 스테이지를 자동화해도
 * 안전한지 판별하는 근거가 된다.
 *
 * 저장 경로: output/calibration-log.jsonl
 * 한 줄 = 하나의 판단 기록 (JSON)
 */

import fs from "fs";
import path from "path";

const LOG_PATH = path.resolve("output", "calibration-log.jsonl");

/**
 * 사람 판단 1건을 기록한다.
 *
 * @param {object} opts
 * @param {string} opts.episodeId
 * @param {string} opts.stage          스테이지 이름
 * @param {boolean} opts.verifierPassed Verifier가 통과시켰는가
 * @param {boolean} opts.humanApproved 사람이 승인했는가
 * @param {string} [opts.humanFeedback] 사람 거부 시 피드백
 * @param {number} [opts.riskScore]
 * @param {string} [opts.riskLevel]
 */
export function logCalibration({ episodeId, stage, verifierPassed, humanApproved, humanFeedback = "", riskScore, riskLevel }) {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });

  const entry = {
    ts: new Date().toISOString(),
    episode_id: episodeId,
    stage,
    verifier_passed: verifierPassed,
    human_approved: humanApproved,
    human_feedback: humanFeedback,
    risk_score: riskScore,
    risk_level: riskLevel,
    // 판단 일치 여부 (true = 사람이 Verifier 판단에 동의)
    aligned: verifierPassed === humanApproved,
  };

  fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n", "utf8");
}

/**
 * 캘리브레이션 로그 요약 (스테이지별 정확도).
 * @returns {Record<string, { count: number, accuracy: number }>}
 */
export function summarizeCalibration() {
  if (!fs.existsSync(LOG_PATH)) return {};

  const lines = fs.readFileSync(LOG_PATH, "utf8").trim().split("\n").filter(Boolean);
  const byStage = {};

  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (!byStage[entry.stage]) byStage[entry.stage] = { count: 0, aligned: 0 };
    byStage[entry.stage].count++;
    if (entry.aligned) byStage[entry.stage].aligned++;
  }

  return Object.fromEntries(
    Object.entries(byStage).map(([s, d]) => [
      s,
      { count: d.count, accuracy: d.count ? d.aligned / d.count : 0 },
    ])
  );
}
