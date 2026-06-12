/**
 * confidence-gate.js — 사람 승인 자동화 판단
 *
 * Verifier 확신도 + Risk Score + 캘리브레이션 이력을 종합하여
 * 특정 스테이지의 사람 승인을 건너뛸 수 있는지 판단한다.
 *
 * 초기 정책 (§4):
 *   - structure 스테이지: 30~50편 전엔 절대 자동화 금지
 *   - 나머지 스테이지: risk LOW + calibration 기록 10건 이상 → 자동 통과 허용
 *
 * canAutoApprove(stageName, riskScore, calibrationCount) → boolean
 */

import path from "path";
import fs from "fs";

const CALIBRATION_LOG = path.resolve("output", "calibration-log.jsonl");

// 스테이지별 최소 calibration 건수 (이 이상 쌓여야 자동 승인 허용)
const MIN_CALIBRATION = {
  research:  10,
  structure: Infinity,  // 절대 자동화 금지 (§4)
  script:    10,
  voice:     5,
  visual:    10,
  render:    5,
  final:     Infinity,  // 최종 승인은 항상 사람
};

const RISK_AUTO_THRESHOLD = 30; // LOW 범위

/**
 * @param {string} stageName
 * @param {{ score: number, level: string }} riskInfo
 * @returns {boolean} true면 사람 승인 생략 가능
 */
export function canAutoApprove(stageName, riskInfo) {
  // 자동화 금지 스테이지
  const minCal = MIN_CALIBRATION[stageName] ?? Infinity;
  if (minCal === Infinity) return false;

  // 위험점수가 LOW가 아니면 반드시 사람 확인
  if (riskInfo.score >= RISK_AUTO_THRESHOLD) return false;

  // 캘리브레이션 이력 확인
  const calCount = getCalibrationCount(stageName);
  if (calCount < minCal) return false;

  // 해당 스테이지의 최근 10건 자동승인 정확도 확인
  const accuracy = getRecentAccuracy(stageName, 10);
  return accuracy >= 0.85; // 85% 이상 정확해야 자동화
}

function getCalibrationCount(stageName) {
  if (!fs.existsSync(CALIBRATION_LOG)) return 0;
  const lines = fs.readFileSync(CALIBRATION_LOG, "utf8").trim().split("\n").filter(Boolean);
  return lines
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && e.stage === stageName)
    .length;
}

function getRecentAccuracy(stageName, n) {
  if (!fs.existsSync(CALIBRATION_LOG)) return 0;
  const lines = fs.readFileSync(CALIBRATION_LOG, "utf8").trim().split("\n").filter(Boolean);
  const entries = lines
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && e.stage === stageName)
    .slice(-n);

  if (entries.length === 0) return 0;
  const correct = entries.filter((e) => e.human_approved === e.verifier_passed).length;
  return correct / entries.length;
}
