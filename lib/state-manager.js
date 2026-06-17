import fs from "fs";
import path from "path";
import { CONFIG } from "../config.js";

const STAGES = ["research", "structure", "script", "voice", "visual", "render"];

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

function findLatestByTopic(topic, outputBase, stateFile) {
  if (!fs.existsSync(outputBase)) return null;
  const dirs = fs.readdirSync(outputBase, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()
    .reverse(); // 최신 에피소드 먼저 (날짜 포함 이름 기준)
  for (const dir of dirs) {
    const sp = path.join(outputBase, dir, stateFile);
    if (!fs.existsSync(sp)) continue;
    try {
      const state = JSON.parse(fs.readFileSync(sp, "utf8"));
      if (state.topic === topic) return { state, statePath: sp };
    } catch {}
  }
  return null;
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

  // 특정 단계부터 이후를 모두 pending으로 리셋
  resetFromStage(stageName) {
    const idx = STAGES.indexOf(stageName);
    if (idx === -1) throw new Error(`알 수 없는 단계: ${stageName}`);
    for (let i = idx; i < STAGES.length; i++) {
      this._state.stages[STAGES[i]] = {
        ...freshStage(),
        attempts: this._state.stages[STAGES[i]]?.attempts ?? 0,
      };
    }
    this._state.final_approved = false;
    this._state.updated_at = new Date().toISOString();
    this.save();
  }

  // ── 팩토리 ────────────────────────────────────────────

  // episodeId로 직접 로드
  static loadById(episodeId) {
    const statePath = path.join(CONFIG.paths.outputBase, episodeId, CONFIG.paths.stateFile);
    if (!fs.existsSync(statePath)) throw new Error(`에피소드 없음: ${episodeId}`);
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return new StateManager(state, statePath);
  }

  static loadOrInit(topic, intent, fresh = false) {
    const episodeId = generateEpisodeId(topic);
    const dir = path.join(CONFIG.paths.outputBase, episodeId);
    const statePath = path.join(dir, CONFIG.paths.stateFile);

    if (!fresh) {
      // 1순위: 오늘 날짜 기반 에피소드 ID
      if (fs.existsSync(statePath)) {
        const existing = JSON.parse(fs.readFileSync(statePath, "utf8"));
        console.log(`[state] 재개: ${episodeId} (${existing.updated_at})`);
        return new StateManager(existing, statePath);
      }
      // 2순위: 다른 날짜에 시작한 같은 주제 에피소드 (최신순)
      const found = findLatestByTopic(topic, CONFIG.paths.outputBase, CONFIG.paths.stateFile);
      if (found) {
        console.log(`[state] 이전 에피소드 재개: ${found.state.episode_id} (${found.state.updated_at})`);
        return new StateManager(found.state, found.statePath);
      }
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
