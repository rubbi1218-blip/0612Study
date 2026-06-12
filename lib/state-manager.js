import fs from "fs";
import path from "path";
import { CONFIG } from "../config.js";

const STAGES = ["research", "structure", "script", "voice"];

function generateEpisodeId(topic) {
  const hash = [...topic].reduce((acc, c) => (acc + c.charCodeAt(0)) % 10000, 0);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `ep-${date}-${String(hash).padStart(4, "0")}`;
}

function freshStage() {
  return {
    status: "pending",
    attempts: 0,
    started_at: null,
    completed_at: null,
    human_approved: false,
    decision_log: "",
    payload: null,
    verifier_output: null,
  };
}

export class StateManager {
  constructor(state, statePath) {
    this._state = state;
    this._statePath = statePath;
  }

  get episodeId() { return this._state.episode_id; }
  get statePath()  { return this._statePath; }
  get escalations() { return this._state.escalations; }

  // ── 재개 판단 ──────────────────────────────────────────
  isStageComplete(stageName) {
    const s = this._state.stages[stageName];
    return !!s && s.status === "verified" && s.human_approved === true;
  }

  // ── 단계 상태 전이 ─────────────────────────────────────
  markStageStart(stageName) {
    const s = this._state.stages[stageName];
    s.status = "in_progress";
    s.started_at = new Date().toISOString();
    s.attempts += 1;
    this.save();
  }

  saveStageResult(stageName, payload, decisionLog) {
    const s = this._state.stages[stageName];
    s.status = "produced";
    s.payload = payload;
    s.decision_log = decisionLog ?? "";
    s.completed_at = new Date().toISOString();
    this._state.updated_at = new Date().toISOString();
    this.save();
  }

  markStageVerified(stageName, verifierOutput) {
    const s = this._state.stages[stageName];
    s.status = "verified";
    s.verifier_output = verifierOutput;
    this.save();
  }

  markStageHumanApproved(stageName) {
    this._state.stages[stageName].human_approved = true;
    this.save();
  }

  // 사람 거부 시 해당 스테이지를 처음부터 재시도
  resetStage(stageName) {
    this._state.stages[stageName] = {
      ...freshStage(),
      attempts: this._state.stages[stageName].attempts, // 시도 횟수는 누적
    };
    this.save();
  }

  addEscalation(stageName, reasons) {
    this._state.escalations.push({
      stage: stageName,
      reasons,
      escalated_at: new Date().toISOString(),
    });
    this.save();
  }

  // ── 페이로드 조회 ──────────────────────────────────────
  getPayload(stageName) {
    return this._state.stages[stageName]?.payload ?? null;
  }

  // 파이프라인에서 "이전 단계" 페이로드를 가져올 때 사용
  getLastPayload(fromStageName) {
    if (!fromStageName) return { topic: this._state.topic, intent: this._state.intent };
    return this.getPayload(fromStageName);
  }

  // ── 원자적 저장 (tmp → rename) ────────────────────────
  save() {
    const tmp = this._statePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this._state, null, 2), "utf8");
    fs.renameSync(tmp, this._statePath); // NTFS 원자적 교체
  }

  // ── 팩토리 ────────────────────────────────────────────
  static loadOrInit(topic, intent, fresh = false) {
    const episodeId = generateEpisodeId(topic);
    const dir = path.join(CONFIG.paths.outputBase, episodeId);
    const statePath = path.join(dir, CONFIG.paths.stateFile);

    // --fresh 또는 state.json 없으면 새로 생성
    if (!fresh && fs.existsSync(statePath)) {
      const existing = JSON.parse(fs.readFileSync(statePath, "utf8"));
      console.log(`[state] 재개: ${episodeId} (${existing.updated_at})`);
      return new StateManager(existing, statePath);
    }

    fs.mkdirSync(dir, { recursive: true });

    const stages = {};
    for (const name of STAGES) stages[name] = freshStage();

    const initial = {
      episode_id: episodeId,
      topic,
      intent: intent ?? "",
      phase: CONFIG.PHASE,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      stages,
      escalations: [],
      final_approved: false,
    };

    const mgr = new StateManager(initial, statePath);
    mgr.save();
    console.log(`[state] 새 에피소드: ${episodeId}`);
    return mgr;
  }
}
