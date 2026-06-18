import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import { fork } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";
import { runA5Beat } from "./agents/a5-visual.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// render 게이트는 자동 승인; visual은 편집 비주얼 편집기에서 사람이 검토
const AUTO_APPROVE = new Set(["render"]);

const app = express();
app.use(express.static(join(__dirname, "public")));
app.use("/output", express.static(join(__dirname, "output")));

// 에피소드 목록 — p-viewer 화면용
app.get("/api/episodes", (_req, res) => {
  const outputDir = join(__dirname, "output");
  if (!fs.existsSync(outputDir)) return res.json([]);

  const episodes = [];
  const dirs = fs.readdirSync(outputDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()
    .reverse();

  for (const dir of dirs) {
    const statePath = join(outputDir, dir, "state.json");
    if (!fs.existsSync(statePath)) continue;
    try {
      const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
      const stages = state.stages ?? {};
      const stageList = ["research","structure","script","voice","visual","render"];
      const stageStatuses = stageList.map(s => ({
        name: s,
        status: stages[s]?.status ?? "pending",
        human_approved: stages[s]?.human_approved ?? false,
      }));
      const doneCount = stageStatuses.filter(s => s.status === "verified" && s.human_approved).length;
      episodes.push({
        episodeId:    state.episode_id,
        topic:        state.topic,
        intent:       state.intent ?? "",
        createdAt:    state.created_at,
        updatedAt:    state.updated_at,
        finalApproved:state.final_approved ?? false,
        doneCount,
        totalStages:  stageList.length,
        stages:       stageStatuses,
      });
    } catch { continue; }
  }
  res.json(episodes);
});

// 에피소드 상세(state.json 전체) — 단계별 payload 뷰어용
app.get("/api/episodes/:episodeId", (req, res) => {
  const statePath = join(__dirname, "output", req.params.episodeId, "state.json");
  if (!fs.existsSync(statePath)) return res.status(404).json({ error: "없음" });
  try {
    res.json(JSON.parse(fs.readFileSync(statePath, "utf8")));
  } catch { res.status(500).json({ error: "파일 읽기 실패" }); }
});

// 특정 단계부터 리셋 — 뷰어에서 "이 단계부터 재실행" 시 호출
app.post("/api/episodes/:episodeId/reset-from/:stage", (req, res) => {
  const { episodeId, stage } = req.params;
  const statePath = join(__dirname, "output", episodeId, "state.json");
  if (!fs.existsSync(statePath)) return res.status(404).json({ error: "없음" });

  const STAGES = ["research","structure","script","voice","visual","render"];
  const idx = STAGES.indexOf(stage);
  if (idx === -1) return res.status(400).json({ error: `알 수 없는 단계: ${stage}` });

  try {
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const freshStage = () => ({
      status:"pending", attempts: 0, started_at: null, completed_at: null,
      human_approved: false, decision_log: "", payload: null, verifier_output: null,
    });
    for (let i = idx; i < STAGES.length; i++) {
      state.stages[STAGES[i]] = {
        ...freshStage(),
        attempts: state.stages[STAGES[i]]?.attempts ?? 0,
      };
    }
    state.final_approved = false;
    state.updated_at = new Date().toISOString();
    const tmp = statePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, statePath);
    res.json({ ok: true, episodeId, resetFrom: stage });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 단계 payload 인라인 편집 — 오버레이 "저장" 버튼 호출
app.patch("/api/episodes/:episodeId/stages/:stage", express.json(), (req, res) => {
  const { episodeId, stage } = req.params;
  const statePath = join(__dirname, "output", episodeId, "state.json");
  if (!fs.existsSync(statePath)) return res.status(404).json({ error: "없음" });

  const STAGES = ["research","structure","script","voice","visual","render"];
  if (!STAGES.includes(stage)) return res.status(400).json({ error: `알 수 없는 단계: ${stage}` });

  try {
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const payload = state.stages?.[stage]?.payload;
    if (!payload) return res.status(409).json({ error: "payload 없음" });

    const { lines, beat_descriptions, claim_texts } = req.body;

    if (stage === "script" && Array.isArray(lines)) {
      payload.lines = lines;
      payload.total_chars = lines.join("").length;
    } else if (stage === "structure" && Array.isArray(beat_descriptions)) {
      beat_descriptions.forEach((desc, i) => { if (payload.beats[i]) { payload.beats[i].content = desc; payload.beats[i].description = desc; } });
    } else if (stage === "research" && Array.isArray(claim_texts)) {
      claim_texts.forEach((text, i) => { if (payload.claims[i]) payload.claims[i].text = text; });
    } else {
      return res.status(400).json({ error: "수정할 필드가 없습니다" });
    }

    state.updated_at = new Date().toISOString();
    const tmp = statePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, statePath);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 편집 비주얼: 단일 비트 이미지 재생성
app.post("/api/visual/beat", express.json(), async (req, res) => {
  const { episodeId, beat, claims = [] } = req.body;
  if (!episodeId || !beat) return res.status(400).json({ ok: false, error: "episodeId와 beat 필수" });
  const episodeDir = join(__dirname, "output", episodeId);
  if (!fs.existsSync(episodeDir)) return res.status(404).json({ ok: false, error: "에피소드 없음" });
  try {
    const asset = await runA5Beat({ beat, claims }, episodeDir);
    res.json({ ok: true, asset });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 마지막 미완료 에피소드 조회 — 시작 화면 "이어하기" 카드용
app.get("/api/resume", (_req, res) => {
  const outputDir = join(__dirname, "output");
  if (!fs.existsSync(outputDir)) return res.json(null);

  const dirs = fs.readdirSync(outputDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()
    .reverse(); // 최신 에피소드 먼저

  for (const dir of dirs) {
    const statePath = join(outputDir, dir, "state.json");
    if (!fs.existsSync(statePath)) continue;
    try {
      const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
      if (state.final_approved) continue; // 이미 완료된 에피소드는 건너뜀

      // 최소 1개 단계가 진행된 에피소드만
      const stages = state.stages ?? {};
      const activeStages = Object.entries(stages)
        .filter(([, s]) => s.status !== "pending")
        .map(([name]) => name);
      if (activeStages.length === 0) continue;

      const lastStage = activeStages[activeStages.length - 1];
      return res.json({
        topic:     state.topic,
        intent:    state.intent ?? "",
        episodeId: state.episode_id,
        lastStage,
        updatedAt: state.updated_at,
      });
    } catch { continue; }
  }
  res.json(null);
});

const server = createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("[server] 브라우저 연결됨");
  let child = null;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // 파이프라인 시작
    if (msg.type === "start") {
      if (child) { child.kill(); child = null; }

      const args = [msg.topic, msg.intent ?? "", "--ws"];
      if (msg.fresh)       args.push("--fresh");
      if (msg.episodeId)   args.push("--episode-id", msg.episodeId);
      if (msg.renderer)    args.push("--renderer", msg.renderer);
      if (msg.tts)         args.push("--tts", msg.tts);
      if (msg.mockVoice)   args.push("--mock-voice");
      if (msg.mockVisual)  args.push("--mock-visual");
      if (msg.mockRender)  args.push("--mock-render");

      child = fork(join(__dirname, "conductor.js"), args, {
        silent: true,
        env: { ...process.env },
      });

      // stdout 한 줄씩 → log 메시지로 브라우저에 전달
      let buf = "";
      child.stdout.on("data", (chunk) => {
        buf += chunk.toString();
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          // 구분선(=====, ----) 필터링 — 개발자용 장식선은 UI 로그에 불필요
          if (/^[=\-]{8,}\s*$/.test(t)) continue;
          const level = t.includes("✅") ? "ok"
            : t.includes("❌") || t.includes("오류") ? "error"
            : t.includes("⚠️") || t.includes("⏸") ? "warn"
            : "info";
          safeSend(ws, { type: "log", level, message: t });
        }
      });

      child.stderr.on("data", (chunk) => {
        for (const line of chunk.toString().split("\n")) {
          const t = line.trim();
          if (!t) continue;
          // stderr는 대부분 경고·디버그. 실제 에러만 error 레벨로
          const level = /error|Error|exception|FATAL/i.test(t) ? "error" : "warn";
          safeSend(ws, { type: "log", level, message: t });
        }
      });

      // IPC 메시지 처리
      child.on("message", (ipc) => {
        if (ipc.type === "gate") {
          if (AUTO_APPROVE.has(ipc.stage)) {
            child.send({ type: "gate_response", stage: ipc.stage, approved: true, feedback: null });
          } else {
            safeSend(ws, ipc);
          }
        } else {
          safeSend(ws, ipc);
        }
      });

      child.on("exit", (code) => {
        console.log(`[server] conductor 종료 (code=${code})`);
        child = null;
      });

      return;
    }

    // 게이트 응답 → conductor IPC로 전달
    if ((msg.type === "approve" || msg.type === "reject") && child) {
      child.send({
        type: "gate_response",
        stage: msg.stage,
        approved: msg.type === "approve",
        feedback: msg.feedback ?? null,
      });
    }
  });

  ws.on("close", () => {
    console.log("[server] 브라우저 연결 종료");
    if (child) { child.kill(); child = null; }
  });
});

function safeSend(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

server.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}`);
});
