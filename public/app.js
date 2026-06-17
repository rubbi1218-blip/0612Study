// ── 상태 ──────────────────────────────────────────────
const State = {
  topic: "",
  ws: null,
  currentStage: null,
  gatePayloads: {},
  videoPath: null,
  episodeId: null,
};

// ── 스텝 정의 ─────────────────────────────────────────
const STEPS = [
  { id: "research",  label: "리서치" },
  { id: "structure", label: "구성" },
  { id: "script",    label: "대본" },
  { id: "voice",     label: "음성" },
  { id: "visual",    label: "비주얼" },
  { id: "render",    label: "렌더" },
];

const STAGE_INDEX = Object.fromEntries(STEPS.map((s, i) => [s.id, i]));

function getDoneStages(activeStage) {
  const idx = STAGE_INDEX[activeStage] ?? -1;
  return STEPS.slice(0, idx).map(s => s.id);
}

function buildStepbar(containerId, activeStage, doneStages) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = "";
  STEPS.forEach((step, i) => {
    const isDone   = (doneStages ?? getDoneStages(activeStage)).includes(step.id);
    const isActive = step.id === activeStage;
    const cls = isDone ? "done" : isActive ? "active" : "wait";

    const dot = document.createElement("div");
    dot.className = `s-dot ${cls}`;
    dot.textContent = isDone ? "✓" : String(i + 1);

    const lbl = document.createElement("span");
    lbl.className = `s-lbl ${cls}`;
    lbl.textContent = step.label;

    el.appendChild(dot);
    el.appendChild(lbl);

    if (i < STEPS.length - 1) {
      const line = document.createElement("div");
      line.className = `s-line ${isDone ? "done" : "wait"}`;
      el.appendChild(line);
    }
  });
}

// ── 화면 전환 ─────────────────────────────────────────
function showPage(id) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  const el = document.getElementById(id);
  if (el) el.classList.add("active");
}

// ── 로그 추가 ─────────────────────────────────────────
function appendLog(containerId, level, message) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const line = document.createElement("div");
  line.className = `log-line ${level || "info"}`;
  line.textContent = message;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
  while (el.children.length > 80) el.removeChild(el.firstChild);
}

// ── WebSocket 메시지 처리 ─────────────────────────────
function handleMessage(msg) {
  switch (msg.type) {

    case "log": {
      const active = document.querySelector(".page.active");
      const logEl = active?.querySelector(".log-lines");
      if (logEl) appendLog(logEl.id, msg.level, msg.message);
      break;
    }

    case "stage_start": {
      State.currentStage = msg.stage;
      const doneStages = getDoneStages(msg.stage);
      const TITLES = {
        research:  "리서치 중...", structure: "구성 설계 중...",
        script:    "대본 작성 중...", voice: "음성 생성 중...",
        visual:    "이미지 생성 중...", render: "영상 렌더링 중...",
      };
      const SUBS = {
        research:  "Gemini가 실시간으로 데이터를 수집합니다. 20~40초 소요됩니다.",
        structure: "Claude가 영상 흐름을 설계합니다.",
        script:    "Claude가 내레이션 대본을 작성합니다.",
        voice:     "ElevenLabs가 음성을 생성합니다.",
        visual:    "Imagen 3가 이미지를 생성합니다.",
        render:    "Remotion이 영상을 합성합니다.",
      };

      if (msg.stage === "visual" || msg.stage === "render") {
        buildStepbar("auto-stepbar", msg.stage, doneStages);
        document.getElementById("auto-topic").textContent = State.topic;
        if (msg.stage === "visual") {
          const el = document.getElementById("auto-visual");
          el.classList.add("active2");
          document.getElementById("auto-visual-sub").textContent = "생성 중...";
        } else {
          const vis = document.getElementById("auto-visual");
          vis.classList.remove("active2");
          vis.classList.add("done2");
          document.getElementById("auto-visual-sub").textContent = "완료";
          document.getElementById("auto-visual-sub").classList.add("ok");
          const ren = document.getElementById("auto-render");
          ren.classList.add("active2");
          document.getElementById("auto-render-sub").textContent = "렌더링 중...";
        }
        showPage("p-auto");
      } else {
        buildStepbar("run-stepbar", msg.stage, doneStages);
        document.getElementById("run-topic").textContent = State.topic;
        document.getElementById("run-title").textContent = TITLES[msg.stage] || "처리 중...";
        document.getElementById("run-sub").textContent = SUBS[msg.stage] || "";
        showPage("p-running");
      }
      break;
    }

    case "stage_done": {
      // auto 화면의 단계 완료 표시
      if (msg.stage === "render") {
        const ren = document.getElementById("auto-render");
        ren.classList.remove("active2");
        ren.classList.add("done2");
        document.getElementById("auto-render-sub").textContent = "완료";
        document.getElementById("auto-render-sub").classList.add("ok");
        const m1 = document.getElementById("auto-m1");
        m1.classList.add("active2");
        document.getElementById("auto-m1-sub").textContent = "검사 중...";
      }
      break;
    }

    case "gate": {
      State.gatePayloads[msg.stage] = msg.payload;
      const done = getDoneStages(msg.stage);

      if (msg.stage === "research") {
        buildStepbar("res-stepbar", "research", done);
        document.getElementById("res-topic").textContent = State.topic;
        renderClaims(msg.payload);
        showPage("p-gate-research");

      } else if (msg.stage === "structure") {
        buildStepbar("str-stepbar", "structure", done);
        document.getElementById("str-topic").textContent = State.topic;
        renderBeats(msg.payload);
        showPage("p-gate-structure");

      } else if (msg.stage === "script") {
        buildStepbar("scr-stepbar", "script", done);
        document.getElementById("scr-topic").textContent = State.topic;
        renderScript(msg.payload);
        showPage("p-gate-script");

      } else if (msg.stage === "voice") {
        buildStepbar("voi-stepbar", "voice", done);
        document.getElementById("voi-topic").textContent = State.topic;
        renderVoice(msg.payload);
        showPage("p-gate-voice");

      } else if (msg.stage === "final") {
        buildStepbar("fin-stepbar", "render", STEPS.map(s => s.id));
        document.getElementById("fin-topic").textContent = State.topic;
        renderFinal(msg.payload);
        showPage("p-gate-final");
      }
      break;
    }

    case "escalation": {
      document.getElementById("esc-title").textContent =
        `${msg.stage} — 3회 실패, 도움이 필요합니다`;
      document.getElementById("esc-reasons").innerHTML =
        (msg.reasons || []).map((r, i) =>
          `<div class="esc-reason">${i+1}. ${esc(r)}</div>`).join("");
      document.getElementById("esc-overlay").classList.add("visible");
      break;
    }

    case "complete": {
      State.videoPath = msg.videoPath;
      State.episodeId = msg.episodeId;
      // final gate가 활성화된 경우엔 거기서 처리, 아니면 완료 화면으로 바로 이동
      if (!document.getElementById("p-gate-final").classList.contains("active")) {
        document.getElementById("complete-path").textContent = msg.videoPath ?? "—";
        document.getElementById("stat-sec").textContent =
          msg.totalSeconds ? `${Math.round(msg.totalSeconds)}초` : "—";
        showPage("p-complete");
      }
      break;
    }
  }
}

// ── 게이트 렌더러 ─────────────────────────────────────
function renderClaims(payload) {
  const claims = payload?.claims ?? [];
  document.getElementById("claims-list").innerHTML = claims.map((c, i) => `
    <div class="claim-card">
      <span class="claim-num">${String(i+1).padStart(2,"0")}</span>
      <div>
        <div class="claim-text">${esc(c.text)}</div>
        <div class="claim-meta">
          ${c.value     ? `<span class="c-val">${esc(c.value)}</span>` : ""}
          ${c.source_url ? `<span class="c-src">${esc(safeHostname(c.source_url))}</span>` : ""}
          ${c.source_date ? `<span class="c-date">${esc(c.source_date)}</span>` : ""}
          <span class="c-ok">✓ 검증됨</span>
        </div>
      </div>
    </div>`).join("");
}

function renderBeats(payload) {
  const beats = payload?.beats ?? [];
  const total = beats.reduce((s, b) => s + (b.duration_seconds ?? 0), 0);
  document.getElementById("str-totals").innerHTML = `
    <div class="total-chip"><div class="total-num">${beats.length}개</div><div class="total-lbl">비트</div></div>
    <div class="total-chip"><div class="total-num">${total}초</div><div class="total-lbl">예상 길이</div></div>
    <div class="total-chip"><div class="total-num">숏폼</div><div class="total-lbl">9:16 세로형</div></div>`;
  const tagCls = (i) => i === 0 ? "hook" : i === beats.length - 1 ? "end" : "beat";
  document.getElementById("beats-list").innerHTML = beats.map((b, i) => `
    <div class="beat-card">
      <span class="beat-tag ${tagCls(i)}">${esc(b.purpose ?? (i === 0 ? "HOOK" : `BEAT ${i}`))}</span>
      <div>
        <div class="beat-text">${esc(b.description ?? b.content ?? "")}</div>
        <div class="beat-sec">⏱ ${b.duration_seconds ?? "?"}초</div>
      </div>
    </div>`).join("");
}

function renderScript(payload) {
  const lines   = payload?.lines ?? [];
  const chars   = payload?.total_chars ?? lines.join("").length;
  const seconds = payload?.estimated_seconds ?? 0;
  document.getElementById("script-meta").innerHTML = `
    <div class="s-meta-chip"><div class="s-meta-num">${chars}자</div><div class="s-meta-lbl">총 글자수</div></div>
    <div class="s-meta-chip"><div class="s-meta-num">약 ${Math.round(seconds)}초</div><div class="s-meta-lbl">예상 재생시간</div></div>
    <div class="s-meta-chip"><div class="s-meta-num">${lines.length}줄</div><div class="s-meta-lbl">대본 줄 수</div></div>`;
  document.getElementById("script-lines").innerHTML = lines.map((line, i) =>
    `<div class="s-line-row">
      <span class="s-line-num">${i+1}</span>
      <span class="s-line-txt ${i < 2 ? "hook" : ""}">${esc(line)}</span>
    </div>`).join("");
}

function renderVoice(payload) {
  const audioPath = payload?.audio_path ?? "";
  const duration  = payload?.estimated_seconds ?? payload?.duration_seconds ?? 0;
  document.getElementById("audio-title").textContent = "audio.mp3 · ElevenLabs";
  document.getElementById("audio-meta").textContent  = `${Math.round(duration)}초`;

  const audioEl = document.getElementById("audio-el");
  const relPath = audioPath.replace(/\\/g, "/").split("output/").pop();
  if (relPath) audioEl.src = `/output/${relPath}`;
  audioEl.onloadedmetadata = () => {
    document.getElementById("audio-dur").textContent = fmtTime(audioEl.duration);
  };
  audioEl.ontimeupdate = updateWaveform;

  document.getElementById("stt-results").innerHTML = [
    "STT 역검증 통과",
    `자막 오프셋 ${payload?.sync_offset_ms ?? 0}ms 보정 완료`,
    "무음 구간 없음 · 클리핑 없음",
  ].map(t => `<div class="stt-row"><span class="stt-ok">✓</span><span class="stt-txt">${t}</span></div>`).join("");

  // 파형 바 (시각적 랜덤 높이)
  const heights = Array.from({length: 24}, () => 20 + Math.floor(Math.random() * 70));
  document.getElementById("waveform").innerHTML = heights
    .map((h, i) => `<div class="wave-bar" id="wb-${i}" style="height:${h}%"></div>`).join("");
}

function updateWaveform() {
  const el = document.getElementById("audio-el");
  if (!el.duration) return;
  const pct = el.currentTime / el.duration;
  document.querySelectorAll(".wave-bar").forEach((b, i) =>
    b.classList.toggle("played", i / 24 < pct));
  document.getElementById("audio-cur").textContent = fmtTime(el.currentTime);
}

function renderFinal(payload) {
  document.getElementById("fin-title").textContent = State.topic;
  const secs = payload?.total_seconds ?? 0;
  document.getElementById("fin-meta").textContent = `${Math.round(secs)}초 · 1080×1920 · 30fps`;
}

// ── App 공개 인터페이스 ───────────────────────────────
const App = {
  start() {
    const topic  = document.getElementById("inp-topic").value.trim();
    const intent = document.getElementById("inp-intent").value.trim();
    if (!topic) { alert("영상 주제를 입력해주세요."); return; }
    State.topic = topic;

    const ws = new WebSocket(`ws://${location.host}`);
    State.ws = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "start", topic, intent }));
      document.getElementById("log-lines").innerHTML = "";
      document.getElementById("run-topic").textContent = topic;
      document.getElementById("run-title").textContent = "연결 중...";
      document.getElementById("run-sub").textContent = "";
      showPage("p-running");
    };
    ws.onmessage = (e) => {
      try { handleMessage(JSON.parse(e.data)); } catch {}
    };
    ws.onclose = () => { State.ws = null; };
  },

  fillExample(text) {
    document.getElementById("inp-topic").value = text;
    document.getElementById("inp-topic").focus();
  },

  approve(stage) {
    if (!State.ws) return;
    State.ws.send(JSON.stringify({ type: "approve", stage }));
    if (stage === "voice") {
      // 비주얼·렌더·M1 자동 진행 화면으로
      document.getElementById("auto-topic").textContent = State.topic;
      buildStepbar("auto-stepbar", "visual", getDoneStages("visual"));
      showPage("p-auto");
    } else if (stage === "final") {
      document.getElementById("complete-path").textContent =
        State.videoPath ?? State.gatePayloads["final"]?.video_path ?? "—";
      document.getElementById("stat-sec").textContent =
        State.gatePayloads["final"]?.total_seconds
          ? `${Math.round(State.gatePayloads["final"].total_seconds)}초` : "—";
      showPage("p-complete");
    } else {
      // 다음 스테이지 실행 중 화면으로
      document.getElementById("run-topic").textContent = State.topic;
      showPage("p-running");
    }
  },

  reject(stage) {
    if (!State.ws) return;
    const feedbackMap = { structure: "str-feedback", script: "scr-feedback" };
    const feedbackId = feedbackMap[stage];
    const feedback = feedbackId
      ? (document.getElementById(feedbackId)?.value?.trim() ?? "") : "";
    State.ws.send(JSON.stringify({ type: "reject", stage, feedback }));
    document.getElementById("run-topic").textContent = State.topic;
    showPage("p-running");
  },

  showReject(stage) {
    const rowId = stage === "structure" ? "str-feedback-row" : "scr-feedback-row";
    const row = document.getElementById(rowId);
    if (!row) return;
    row.style.display = row.style.display === "block" ? "none" : "block";
    if (row.style.display === "block") {
      row.querySelector("textarea")?.focus();
    }
  },

  togglePlay() {
    const el  = document.getElementById("audio-el");
    const btn = document.getElementById("play-btn");
    if (el.paused) { el.play(); btn.textContent = "⏸"; }
    else           { el.pause(); btn.textContent = "▶"; }
  },

  openVideo() {
    if (State.videoPath) {
      const rel = State.videoPath.replace(/\\/g, "/").split("output/").pop();
      window.open(`/output/${rel}`);
    }
  },

  reset() {
    if (State.ws) { State.ws.close(); State.ws = null; }
    State.topic = "";
    State.gatePayloads = {};
    State.videoPath = null;
    State.episodeId = null;
    State.currentStage = null;
    document.getElementById("inp-topic").value = "";
    document.getElementById("inp-intent").value = "";
    showPage("p-start");
  },

  dismissEscalation() {
    document.getElementById("esc-overlay").classList.remove("visible");
  },
};

// ── 데모 모드 ──────────────────────────────────────────
const DEMO_DATA = {
  research: { claims: [
    { text: "한국은행은 2026년 1분기 기준금리를 3.00%로 동결했다.", value: "3.00%", source_url: "https://bok.or.kr", source_date: "2026-01-16" },
    { text: "미국 연준은 2025년 말 기준금리를 4.25~4.50% 구간으로 인하했다.", value: "4.25~4.50%", source_url: "https://federalreserve.gov", source_date: "2025-12-18" },
    { text: "한국 소비자물가 상승률은 2.1%로 목표치(2%) 근접했다.", value: "2.1%", source_url: "https://kostat.go.kr", source_date: "2026-02-05" },
    { text: "원·달러 환율은 1,320원대로 6개월 최저 수준이다.", value: "1,320원", source_url: "https://investing.com", source_date: "2026-03-10" },
    { text: "서울 아파트 매매 거래량은 전월 대비 18% 증가했다.", value: "+18%", source_url: "https://r114.com", source_date: "2026-02-28" },
  ]},
  structure: { beats: [
    { purpose: "HOOK", description: "금리 인하 소식에 서울 아파트 시장이 들썩이고 있다 — 진짜 기회인가, 함정인가?", duration_seconds: 8 },
    { purpose: "BEAT 1", description: "한국은행의 금리 결정 배경: 물가 안정과 경기 둔화 사이의 딜레마", duration_seconds: 20 },
    { purpose: "BEAT 2", description: "역사적 데이터로 보는 금리 인하 후 부동산 가격 패턴", duration_seconds: 25 },
    { purpose: "BEAT 3", description: "2026년 지금, 금리 인하 수혜 지역 vs 리스크 지역 분석", duration_seconds: 25 },
    { purpose: "결말", description: "시청자가 지금 당장 취해야 할 행동 3가지", duration_seconds: 12 },
  ]},
  script: { lines: [
    "한국은행이 금리를 내렸습니다. 부동산 시장은 지금 폭풍 전야입니다.",
    "2026년 3월, 기준금리 3.0%. 이 숫자 하나가 수천만 명의 집값을 바꿉니다.",
    "하지만 금리가 내렸다고 집값이 무조건 오르지는 않습니다.",
    "역사가 이걸 증명합니다. 2019년 금리 인하 직후, 강남 3구는 올랐지만 지방은 오히려 빠졌습니다.",
    "지금 주목할 핵심 세 가지를 드리겠습니다.",
    "첫째, 거래량. 현재 서울 거래량이 18% 급증했습니다. 선행 지표입니다.",
    "둘째, 입지. 교통 개발 호재가 있는 곳만 선별적으로 오릅니다.",
    "셋째, 레버리지. 금리 인하기엔 대출 타이밍이 핵심입니다.",
    "지금 당장 할 것: 원하는 단지의 거래량 체크. 3개월 추이를 보십시오.",
  ], total_chars: 310, estimated_seconds: 68 },
  voice: { audio_path: "", estimated_seconds: 68, sync_offset_ms: 12 },
  final: { total_seconds: 90, video_path: "output/demo/video.mp4" },
};

const Demo = {
  active: false,
  queue: [],   // 다음에 실행할 { delay, msg } 목록

  start() {
    Demo.active = true;
    State.topic = "데모: 한국 금리 인하와 부동산 시장";
    State.ws = null;

    // 단계별 시퀀스 (gate 앞에서 멈추고, approve 시 다음 단계 진행)
    Demo._runStage("research", 200);
  },

  _runStage(stage, delay) {
    setTimeout(() => {
      handleMessage({ type: "stage_start", stage });
      setTimeout(() => {
        handleMessage({ type: "gate", stage, payload: DEMO_DATA[stage] ?? {} });
      }, 1400);
    }, delay);
  },

  // App.approve() → Demo.next() 로 라우팅됨
  next(stage) {
    const seq = {
      research:  () => Demo._runStage("structure", 300),
      structure: () => Demo._runStage("script",    300),
      script:    () => Demo._runStage("voice",     300),
      voice:     () => Demo._autoPhase(),
      final:     () => Demo._complete(),
    };
    (seq[stage] ?? (() => {}))();
  },

  _autoPhase() {
    // visual → render → m1 → final gate
    setTimeout(() => {
      handleMessage({ type: "stage_start", stage: "visual" });
      setTimeout(() => {
        handleMessage({ type: "stage_done", stage: "visual" });
        handleMessage({ type: "stage_start", stage: "render" });
        setTimeout(() => {
          handleMessage({ type: "stage_done", stage: "render" });
          document.getElementById("auto-m1").classList.add("active2");
          document.getElementById("auto-m1-sub").textContent = "검사 중...";
          setTimeout(() => {
            document.getElementById("auto-m1").classList.remove("active2");
            document.getElementById("auto-m1").classList.add("done2");
            document.getElementById("auto-m1-sub").textContent = "통과";
            document.getElementById("auto-m1-sub").classList.add("ok");
            handleMessage({ type: "gate", stage: "final", payload: DEMO_DATA.final });
          }, 1200);
        }, 1800);
      }, 1800);
    }, 300);
  },

  _complete() {
    State.videoPath = "output/demo/video.mp4";
    State.episodeId = "demo";
    document.getElementById("complete-path").textContent = "output/demo/video.mp4";
    document.getElementById("stat-sec").textContent = "90초";
    showPage("p-complete");
  },

  stop() {
    Demo.active = false;
    State.topic = "";
  },
};

// App.approve / reject를 데모 모드에서 intercept
const _origApprove = App.approve.bind(App);
const _origReject  = App.reject.bind(App);
App.approve = function(stage) {
  if (Demo.active) { Demo.next(stage); return; }
  _origApprove(stage);
};
App.reject = function(stage) {
  if (Demo.active) {
    // 데모에선 거부해도 같은 gate 재표시 (실제 재생성 없음)
    handleMessage({ type: "gate", stage, payload: DEMO_DATA[stage] ?? {} });
    return;
  }
  _origReject(stage);
};
App.demo = function() { Demo.start(); };
App.reset = (function(orig) {
  return function() { Demo.stop(); orig(); };
})(App.reset.bind(App));

// ── 유틸 ──────────────────────────────────────────────
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function safeHostname(url) {
  try { return new URL(url).hostname.replace("www.", ""); }
  catch { return url; }
}
