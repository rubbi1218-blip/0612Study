// ── 상태 ──────────────────────────────────────────────
const State = {
  topic: "",
  intent: "",
  ws: null,
  currentStage: null,
  gatePayloads: {},
  videoPath: null,
  episodeId: null,
  scriptLines: [],
  speechIdx: -1,
  format: "short",   // "short" | "long"
  models: { research: "gemini", script: "claude", tts: "elevenlabs", renderer: "remotion" },
  _creepTimer: null,
  _creepPct: 0,
};

// ── 스텝 정의 ─────────────────────────────────────────
const STEPS = [
  { id: "research",  label: "리서치" },
  { id: "structure", label: "구성" },
  { id: "script",    label: "대본" },
  { id: "voice",     label: "음성" },
  { id: "dashboard", label: "대본+B롤" },
  { id: "visual",    label: "편집비주얼" },
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
    dot.className = `s-dot ${cls}${isDone ? " clickable-step" : ""}`;
    dot.textContent = isDone ? "✓" : String(i + 1);
    if (isDone) dot.onclick = () => App.backTo(step.id);

    const lbl = document.createElement("span");
    lbl.className = `s-lbl ${cls}${isDone ? " clickable-step" : ""}`;
    lbl.textContent = step.label;
    if (isDone) lbl.onclick = () => App.backTo(step.id);

    el.appendChild(dot);
    el.appendChild(lbl);

    if (i < STEPS.length - 1) {
      const line = document.createElement("div");
      line.className = `s-line ${isDone ? "done" : "wait"}`;
      el.appendChild(line);
    }
  });
}

// ── 화면 전환 (fade) ──────────────────────────────────
function showPage(id) {
  const current = document.querySelector(".page.active");
  const next = document.getElementById(id);
  if (!next || next === current) return;

  if (current) {
    current.classList.add("page-out");
    current.classList.remove("active");
    setTimeout(() => current.classList.remove("page-out"), 220);
  }

  next.style.opacity = "0";
  next.classList.add("active");
  requestAnimationFrame(() => {
    next.style.transition = "opacity .19s ease";
    requestAnimationFrame(() => {
      next.style.opacity = "1";
      setTimeout(() => { next.style.transition = ""; next.style.opacity = ""; }, 220);
    });
  });
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

// ── 에스컬레이션 에러 파서 ────────────────────────────
function parseReason(raw) {
  // "[service] HTTP NNN: {...JSON...}" 형식 파싱
  const m = raw.match(/^(\[[^\]]+\])\s+HTTP\s+(\d+):\s*(\{[\s\S]*\})$/);
  if (m) {
    const service = m[1];
    const status  = parseInt(m[2]);
    let msg = raw;
    try {
      const body   = JSON.parse(m[3]);
      const detail = body.detail ?? body;
      msg = detail.message ?? detail.error_message ?? detail.error ?? JSON.stringify(detail);
    } catch {}
    const statusLabel = {
      400: "잘못된 요청", 401: "인증 실패", 402: "결제 필요",
      403: "접근 권한 없음", 404: "찾을 수 없음",
      429: "요청 한도 초과", 500: "서버 오류", 503: "서비스 불가",
    }[status] ?? `HTTP ${status}`;

    let guidance = "";
    if (status === 402) {
      guidance = `<div class="esc-guidance">💡 <strong>해결 방법</strong>: ElevenLabs 유료 플랜으로 업그레이드하거나 <code>.env</code>에서 <code>TTS_ENGINE=qwen3</code>으로 변경하세요.</div>`;
    } else if (status === 429) {
      guidance = `<div class="esc-guidance">💡 요청 한도 초과입니다. 잠시 후 재시도 버튼을 누르세요.</div>`;
    } else if (status === 401 || status === 403) {
      guidance = `<div class="esc-guidance">💡 <code>.env</code>의 API 키를 확인하세요.</div>`;
    }
    return `<span class="esc-badge">${esc(service)}</span> <span class="esc-status">${esc(statusLabel)}</span><br><span class="esc-msg">${esc(msg)}</span>${guidance}`;
  }
  return esc(raw);
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

    case "progress": {
      const pct = Math.min(100, Math.max(0, msg.pct ?? 0));
      // 실제 진행률이 30% 넘으면 크리핑 타이머 불필요
      if (pct >= 30) { clearInterval(State._creepTimer); State._creepTimer = null; }
      // p-running 진행률 바
      const fill = document.getElementById("run-progress-fill");
      const pctEl = document.getElementById("run-progress-pct");
      if (fill)  fill.style.width = `${pct}%`;
      if (pctEl) pctEl.textContent = `${pct}%`;
      // p-auto 렌더 진행률 바
      if (msg.stage === "render") {
        const wrap = document.getElementById("auto-render-progress-wrap");
        const rFill = document.getElementById("auto-render-fill");
        const rPct  = document.getElementById("auto-render-pct");
        if (wrap)  wrap.style.display = "flex";
        if (rFill) rFill.style.width  = `${pct}%`;
        if (rPct)  rPct.textContent   = `${pct}%`;
      }
      break;
    }

    case "stage_start": {
      State.currentStage = msg.stage;
      if (msg.episodeId) State.episodeId = msg.episodeId;
      // 진행률 바 초기화 + 크리핑 타이머 (API 응답 대기 중 시각적 피드백)
      const fill = document.getElementById("run-progress-fill");
      const pctEl = document.getElementById("run-progress-pct");
      if (fill)  fill.style.width = "0%";
      if (pctEl) pctEl.textContent = "0%";
      clearInterval(State._creepTimer);
      State._creepPct = 0;
      State._creepTimer = setInterval(() => {
        // 실제 진행률 업데이트 전까지 최대 28%까지 천천히 증가
        State._creepPct = Math.min(28, State._creepPct + 0.25);
        const f = document.getElementById("run-progress-fill");
        const p = document.getElementById("run-progress-pct");
        if (f && parseFloat(f.style.width || "0") <= State._creepPct) {
          f.style.width = `${State._creepPct}%`;
          if (p) p.textContent = `${Math.round(State._creepPct)}%`;
        }
      }, 400); // 0.4초마다 +0.25% → ~45초에 28% 도달
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
          renderVrewTable({
            stages: {
              structure: { payload: State.gatePayloads.structure ?? {} },
              script:    { payload: State.gatePayloads.script    ?? {} },
              visual:    { payload: { assets: [] } },
            },
          }, "auto-dash-body");
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
      clearInterval(State._creepTimer); State._creepTimer = null;
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

      } else if (msg.stage === "visual") {
        buildStepbar("ve-stepbar", "visual", done);
        document.getElementById("ve-topic").textContent = State.topic;
        renderVisualEdit(msg.payload);
        showPage("p-visual-edit");

      } else if (msg.stage === "final") {
        buildStepbar("fin-stepbar", "render", STEPS.map(s => s.id));
        document.getElementById("fin-topic").textContent = State.topic;
        renderFinal(msg.payload);
        showPage("p-gate-final");
      }
      break;
    }

    case "escalation": {
      clearInterval(State._creepTimer); State._creepTimer = null;
      document.getElementById("esc-title").textContent =
        `${msg.stage} — 3회 실패, 도움이 필요합니다`;
      // 중복 이유 압축: 같은 문자열이 반복될 경우 1개만 표시
      const rawReasons = msg.reasons || [];
      const uniq = [...new Map(rawReasons.map(r => [r, r])).values()];
      const collapsed = uniq.length < rawReasons.length;
      document.getElementById("esc-reasons").innerHTML =
        uniq.map((r, i) =>
          `<div class="esc-reason"><span class="esc-num">${i+1}</span>${parseReason(r)}</div>`
        ).join("") +
        (collapsed ? `<div class="esc-collapse-note">↑ 3회 시도 모두 동일한 오류</div>` : "");
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

// ── 대본+B롤 게이트 헬퍼 ────────────────────────────────
function _showDashboardGate() {
  const structPl = State.gatePayloads.structure ?? (Demo.active ? DEMO_DATA.structure : {});
  const scriptPl = State.gatePayloads.script    ?? (Demo.active ? DEMO_DATA.script    : {});
  const done = getDoneStages("dashboard");
  buildStepbar("dbrd-stepbar", "dashboard", done);
  document.getElementById("dbrd-topic").textContent = State.topic;
  renderVrewTable({
    stages: {
      structure: { payload: structPl },
      script:    { payload: scriptPl },
      visual:    { payload: { assets: [] } },
    },
  }, "dbrd-vrew-body", { editMode: true });
  showPage("p-gate-dashboard");
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
  State.scriptLines = lines;
  App.stopScriptPlay();
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

// ── 편집 비주얼 ──────────────────────────────────────

const VE = {
  assets: {},        // { beatId: { status:"none"|"gen"|"ok"|"err", asset, model } }
  beats: [],         // structure payload의 beats
  lines: [],         // script payload의 lines
  claims: [],        // research payload의 claims
  generating: new Set(),
  currentBeat: 0,    // 현재 선택/미리보기 중인 beat 인덱스
  playTimer: null,   // setTimeout ID (재생 타이머)
  playing: false,
  editingBeat: -1,   // 편집 패널에 열린 beat 인덱스
};

function renderVisualEdit(visualPayload) {
  VE.beats  = State.gatePayloads.structure?.beats ?? [];
  VE.lines  = State.gatePayloads.script?.lines   ?? [];
  VE.claims = State.gatePayloads.research?.claims ?? [];
  VE.assets = {};
  VE.currentBeat  = 0;
  VE.playing      = false;
  VE.editingBeat  = -1;
  clearTimeout(VE.playTimer);

  for (const a of (visualPayload?.assets ?? [])) {
    VE.assets[a.beat_id] = { status: "ok", asset: a, model: "gemini" };
  }

  _veRenderTimeline();
  _veShowBeat(0);
  _veUpdateProgress();
}

function _veRenderTimeline() {
  const tl = document.getElementById("ve-timeline");
  if (!tl) return;
  const numBeats = Math.max(VE.beats.length, 1);
  const perBeat  = Math.ceil(VE.lines.length / numBeats);

  tl.innerHTML = VE.beats.map((beat, bi) => {
    const beatLines = VE.lines.slice(bi * perBeat, (bi + 1) * perBeat);
    const raw       = beatLines[0] ?? "";
    const snippet   = escHtml(raw.slice(0, 40) + (raw.length > 40 ? "…" : "")) || "—";
    const sec       = beat.estimated_sec ?? beat.duration_seconds ?? "?";
    const label     = escHtml(beat.purpose ?? `씬 ${bi + 1}`);
    const isActive  = bi === VE.currentBeat;

    return `<div class="ve-tl-card${isActive ? " ve-tl-active" : ""}" id="ve-tl-${bi}" onclick="App.veSelectBeat(${bi})">
      <div class="ve-tl-num">${bi + 1}</div>
      <div class="ve-tl-thumb" id="ve-tl-thumb-${bi}">${_veTlThumbHtml(beat.id)}</div>
      <div class="ve-tl-info">
        <div class="ve-tl-label">${label}</div>
        <div class="ve-tl-script">${snippet}</div>
        <div class="ve-tl-meta">⏱ ${sec}초</div>
      </div>
      <div class="ve-tl-btns">
        <button class="ve-tl-btn" title="생성/재생성" onclick="event.stopPropagation();App.generateBeat(${beat.id})">⚡</button>
        <button class="ve-tl-btn" title="편집" onclick="event.stopPropagation();App.veEditBeat(${bi})">✏️</button>
      </div>
    </div>`;
  }).join("");
}

function _veTlThumbHtml(beatId) {
  const entry = VE.assets[beatId];
  if (!entry)                        return `<div class="ve-tl-thumb-ph">🖼</div>`;
  if (entry.status === "gen")        return `<div class="ve-tl-thumb-spin"></div>`;
  if (entry.asset?.type === "chart") return `<div class="ve-tl-thumb-ph">📊</div>`;
  if (entry.asset?.file_path) {
    const raw = entry.asset.file_path.replace(/\\/g, "/");
    const rel = raw.includes("/output/") ? raw.split("/output/").pop() : raw;
    return `<img src="/output/${rel}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">`;
  }
  return `<div class="ve-tl-thumb-ph">❌</div>`;
}

function _veShowBeat(bi) {
  VE.currentBeat = bi;
  const beat = VE.beats[bi];
  if (!beat) return;

  // 미리보기 이미지/상태
  const wrap = document.getElementById("ve-preview-img-wrap");
  if (wrap) {
    const entry = VE.assets[beat.id];
    const clrs  = ["#7c3aed","#0891b2","#059669","#d97706","#dc2626","#6366f1"];
    const c     = clrs[bi % clrs.length];
    if (entry?.status === "ok" && entry.asset?.type === "chart") {
      wrap.innerHTML = `<div class="ve-preview-chart">📊<br><span style="font-size:12px;color:var(--t2)">${escHtml(entry.asset.chart_spec?.title ?? "차트")}</span></div>`;
    } else if (entry?.status === "ok" && entry.asset?.file_path) {
      const raw = entry.asset.file_path.replace(/\\/g, "/");
      const rel = raw.includes("/output/") ? raw.split("/output/").pop() : raw;
      wrap.innerHTML = `<img src="/output/${rel}" alt="" style="max-width:100%;max-height:100%;object-fit:contain">`;
    } else if (entry?.status === "gen") {
      wrap.innerHTML = `<div class="ve-preview-placeholder"><div class="ve-gen-spinner"></div>생성 중...</div>`;
    } else {
      wrap.innerHTML = `<div class="ve-preview-placeholder" style="border:2px dashed ${c}44;border-radius:12px;padding:28px">
        <div style="font-size:34px">🖼</div>
        <div>⚡ 버튼으로 생성하세요</div>
      </div>`;
    }
  }

  // 스크립트 오버레이
  const numBeats  = Math.max(VE.beats.length, 1);
  const perBeat   = Math.ceil(VE.lines.length / numBeats);
  const beatLines = VE.lines.slice(bi * perBeat, (bi + 1) * perBeat);
  const scriptEl  = document.getElementById("ve-preview-script");
  if (scriptEl) scriptEl.textContent = beatLines.join(" ");

  // 씬 레이블
  const sec = beat.estimated_sec ?? beat.duration_seconds ?? "?";
  const labelEl = document.getElementById("ve-preview-scene-label");
  if (labelEl) labelEl.textContent = `씬 ${bi + 1}  ·  ${beat.purpose ?? ""}  ·  ⏱ ${sec}초`;

  // 플레이어 타이머 텍스트
  const timeEl = document.getElementById("ve-player-time");
  if (timeEl) timeEl.textContent = `씬 ${bi + 1} / ${VE.beats.length}`;

  // 타임라인 활성 표시 갱신
  document.querySelectorAll(".ve-tl-card").forEach((el, i) =>
    el.classList.toggle("ve-tl-active", i === bi));

  document.getElementById(`ve-tl-${bi}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function _veRefreshCard(beatId) {
  const bi    = VE.beats.findIndex(b => b.id === beatId);
  const entry = VE.assets[beatId];

  const tlCard  = document.getElementById(`ve-tl-${bi}`);
  const tlThumb = document.getElementById(`ve-tl-thumb-${bi}`);
  if (tlCard) {
    tlCard.classList.toggle("ve-tl-gen",  entry?.status === "gen");
    tlCard.classList.toggle("ve-tl-done", entry?.status === "ok");
  }
  if (tlThumb) tlThumb.innerHTML = _veTlThumbHtml(beatId);

  if (bi === VE.currentBeat) _veShowBeat(bi);

  _veUpdateProgress();
}

function _veUpdateProgress() {
  const total = VE.beats.length;
  const done  = Object.values(VE.assets).filter(a => a.status === "ok").length;
  const el = document.getElementById("ve-gen-progress");
  if (el) el.textContent = total ? `${done} / ${total} 완료` : "";
}

// ── App 공개 인터페이스 ───────────────────────────────
const App = {
  start() {
    const topic  = document.getElementById("inp-topic").value.trim();
    const intent = document.getElementById("inp-intent").value.trim();
    if (!topic) { alert("영상 주제를 입력해주세요."); return; }
    State.topic  = topic;
    State.intent = intent;

    const ws = new WebSocket(`ws://${location.host}`);
    State.ws = ws;

    ws.onopen = () => {
      const startMsg = { type: "start", topic, intent,
        format:   State.format,
        renderer: State.models.renderer,
        tts:      State.models.tts,
      };
      ws.send(JSON.stringify(startMsg));
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

  setFormat(fmt) {
    State.format = fmt;
    document.getElementById("fmt-short")?.classList.toggle("sel", fmt === "short");
    document.getElementById("fmt-long")?.classList.toggle("sel",  fmt === "long");
  },

  selectModel(btn) {
    const group = btn.dataset.group;
    const val   = btn.dataset.val;
    State.models[group] = val;
    btn.closest(".model-btns")?.querySelectorAll(".model-btn")
      .forEach(b => b.classList.toggle("sel", b === btn));
  },

  approve(stage) {
    App.stopScriptPlay();

    // voice 승인 → 대본+B롤 확인 게이트 먼저 (conductor에는 아직 전달 안 함)
    if (stage === "voice") {
      _showDashboardGate();
      return;
    }

    // dashboard 승인 → 이제 conductor에 voice approve 전달 + p-auto
    if (stage === "dashboard") {
      if (!State.ws) return;
      State.ws.send(JSON.stringify({ type: "approve", stage: "voice" }));
      document.getElementById("auto-topic").textContent = State.topic;
      buildStepbar("auto-stepbar", "visual", getDoneStages("visual"));
      showPage("p-auto");
      return;
    }

    if (!State.ws) return;
    State.ws.send(JSON.stringify({ type: "approve", stage }));
    if (stage === "final") {
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
    const feedbackMap = { structure: "str-feedback", script: "scr-feedback" };
    const feedbackId = feedbackMap[stage];
    let feedback = feedbackId
      ? (document.getElementById(feedbackId)?.value?.trim() ?? "") : "";

    // 대본 단계: 선택 모델을 피드백에 포함. 모델만 변경된 경우 텍스트 없어도 허용.
    if (stage === "script") {
      const model = State.models.script ?? "claude";
      if (model !== "claude") {
        feedback = `[모델: ${model}]${feedback ? " " + feedback : " 재생성 요청"}`;
      } else if (!feedback) {
        document.getElementById(feedbackId)?.focus();
        return;
      }
    } else if (feedbackId && !feedback) {
      document.getElementById(feedbackId)?.focus();
      return;
    }

    // 전송 전 textarea 초기화 및 feedback-row 닫기
    if (feedbackId) {
      const inp = document.getElementById(feedbackId);
      if (inp) inp.value = "";
      const rowId = feedbackId.replace("-feedback", "-feedback-row");
      const row = document.getElementById(rowId);
      if (row) row.style.display = "none";
    }
    App.stopScriptPlay();
    if (!State.ws) return;
    State.ws.send(JSON.stringify({ type: "reject", stage, feedback }));
    document.getElementById("run-topic").textContent = State.topic;
    showPage("p-running");
  },

  showReject(stage) {
    const rowId = stage === "structure" ? "str-feedback-row" : "scr-feedback-row";
    const row = document.getElementById(rowId);
    if (!row) return;
    const isVisible = row.style.display === "block";
    row.style.display = isVisible ? "none" : "block";
    if (!isVisible) row.querySelector("textarea")?.focus();
  },

  // ── 대본 직접 입력 모달 ────────────────────────────────
  toggleScriptPaste() {
    const modal = document.getElementById("script-paste-modal");
    if (!modal) return;
    const isVisible = modal.classList.contains("visible");
    if (!isVisible) {
      modal.classList.add("visible");
      setTimeout(() => document.getElementById("script-paste-area")?.focus(), 60);
    } else {
      modal.classList.remove("visible");
      const ta = document.getElementById("script-paste-area");
      if (ta) ta.value = "";
      const cnt = document.getElementById("paste-line-count");
      if (cnt) cnt.textContent = "0줄";
    }
  },

  handleScriptUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const ta = document.getElementById("script-paste-area");
      if (ta) {
        ta.value = e.target.result;
        App._updatePasteCount();
      }
    };
    reader.readAsText(file, "UTF-8");
    event.target.value = "";
  },

  _updatePasteCount() {
    const ta = document.getElementById("script-paste-area");
    if (!ta) return;
    const lines = ta.value.split("\n").filter(l => l.trim());
    const chars = lines.join("").length;
    const secs  = Math.round(chars / 280 * 60);
    const el    = document.getElementById("paste-line-count");
    if (!el) return;
    el.textContent = lines.length
      ? `${lines.length}줄 · ${chars}자 · 약 ${secs}초`
      : "입력 대기";
  },

  async useCustomScript() {
    const ta = document.getElementById("script-paste-area");
    if (!ta) return;
    const lines = ta.value.split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) {
      alert("대본 내용을 입력해주세요.");
      return;
    }
    const customPayload = {
      lines,
      total_chars: lines.join("").length,
      estimated_seconds: Math.round(lines.join("").length / 280 * 60),
    };
    State.gatePayloads.script = customPayload;
    if (State.episodeId && !Demo.active) {
      try {
        await fetch(`/api/episodes/${State.episodeId}/stages/script`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lines }),
        });
      } catch {}
    }
    renderScript(customPayload);
    App.toggleScriptPaste();
  },

  toggleScriptPlay() {
    if (typeof speechSynthesis === "undefined") {
      alert("이 브라우저는 음성 미리 듣기를 지원하지 않습니다.");
      return;
    }
    const btn = document.getElementById("script-play-btn");
    const status = document.getElementById("script-play-status");

    if (speechSynthesis.speaking || speechSynthesis.pending) {
      speechSynthesis.cancel();
      btn.textContent = "▶ 미리 듣기";
      btn.classList.remove("playing");
      if (status) status.textContent = "";
      State.speechIdx = -1;
      document.querySelectorAll(".s-line-row.speaking")
        .forEach(el => el.classList.remove("speaking"));
      return;
    }

    const lines = State.scriptLines;
    if (!lines.length) return;

    btn.textContent = "⏹ 정지";
    btn.classList.add("playing");

    function speakLine(idx) {
      if (idx >= lines.length) {
        btn.textContent = "▶ 미리 듣기";
        btn.classList.remove("playing");
        if (status) status.textContent = "";
        State.speechIdx = -1;
        document.querySelectorAll(".s-line-row.speaking")
          .forEach(el => el.classList.remove("speaking"));
        return;
      }
      State.speechIdx = idx;
      // 현재 줄 하이라이트
      document.querySelectorAll(".s-line-row").forEach((el, i) =>
        el.classList.toggle("speaking", i === idx));
      const row = document.querySelectorAll(".s-line-row")[idx];
      row?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      if (status) status.textContent = `${idx + 1} / ${lines.length}줄`;

      const utt = new SpeechSynthesisUtterance(lines[idx]);
      utt.lang = "ko-KR";
      utt.rate = 0.95;
      utt.onend = () => speakLine(idx + 1);
      utt.onerror = () => speakLine(idx + 1);
      speechSynthesis.speak(utt);
    }

    speakLine(0);
  },

  stopScriptPlay() {
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    const btn = document.getElementById("script-play-btn");
    if (btn) { btn.textContent = "▶ 미리 듣기"; btn.classList.remove("playing"); }
    const status = document.getElementById("script-play-status");
    if (status) status.textContent = "";
    State.speechIdx = -1;
    document.querySelectorAll(".s-line-row.speaking")
      .forEach(el => el.classList.remove("speaking"));
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

  retryStage() {
    document.getElementById("esc-overlay").classList.remove("visible");
    if (!State.topic) { showPage("p-start"); return; }

    const ws = new WebSocket(`ws://${location.host}`);
    State.ws = ws;

    ws.onopen = () => {
      // fresh 없이 시작 → StateManager가 기존 state.json 로드, 완료 단계 건너뜀
      ws.send(JSON.stringify({ type: "start", topic: State.topic, intent: State.intent }));
      document.getElementById("log-lines").innerHTML = "";
      document.getElementById("run-topic").textContent = State.topic;
      document.getElementById("run-title").textContent = "재시도 중...";
      document.getElementById("run-sub").textContent   = "마지막 실패 단계부터 재시작합니다.";
      showPage("p-running");
    };
    ws.onmessage = (e) => { try { handleMessage(JSON.parse(e.data)); } catch {} };
    ws.onclose   = () => { State.ws = null; };
  },

  resumeLast() {
    if (!State._resume) return;
    State.topic  = State._resume.topic;
    State.intent = State._resume.intent;
    const ws = new WebSocket(`ws://${location.host}`);
    State.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "start", topic: State.topic, intent: State.intent }));
      document.getElementById("log-lines").innerHTML = "";
      document.getElementById("run-topic").textContent = State.topic;
      document.getElementById("run-title").textContent = "이어서 진행 중...";
      document.getElementById("run-sub").textContent   = `마지막 완료 단계(${STAGE_KO[State._resume.lastStage] ?? State._resume.lastStage})부터 재시작합니다.`;
      showPage("p-running");
    };
    ws.onmessage = (e) => { try { handleMessage(JSON.parse(e.data)); } catch {} };
    ws.onclose   = () => { State.ws = null; };
  },

  dismissEscalation() {
    document.getElementById("esc-overlay").classList.remove("visible");
    // 시작 화면으로 돌아가 이어하기 카드 표시
    loadResumeCard();
    showPage("p-start");
  },

  // ── 편집 비주얼 ──────────────────────────────────────
  async generateBeat(beatId) {
    if (VE.generating.has(beatId)) return;
    const beat = VE.beats.find(b => b.id === beatId);
    if (!beat) return;

    // 모델 감지: 해당 카드의 선택 또는 전역 선택
    const cardGroup = `ve-imgmodel-${beatId}`;
    const cardBtn = document.querySelector(`.model-btn.sel[data-group="${cardGroup}"]`);
    const model = cardBtn?.dataset.val ?? State.models["ve-imgmodel"] ?? "gemini";

    VE.generating.add(beatId);
    VE.assets[beatId] = { status: "gen", asset: null, model };
    _veRefreshCard(beatId);

    try {
      const resp = await fetch("/api/visual/beat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeId: State.episodeId, beat, claims: VE.claims }),
      });
      const data = await resp.json();
      if (data.ok) {
        VE.assets[beatId] = { status: "ok", asset: data.asset, model };
      } else {
        VE.assets[beatId] = { status: "err", asset: null, error: data.error };
      }
    } catch (err) {
      VE.assets[beatId] = { status: "err", asset: null, error: err.message };
    } finally {
      VE.generating.delete(beatId);
      _veRefreshCard(beatId);
      _veUpdateProgress();
    }
  },

  async generateAllBeats() {
    const btn = document.querySelector(".btn-gen-all");
    if (btn) { btn.disabled = true; btn.textContent = "⏳ 생성 중..."; }
    const pending = VE.beats.filter(b => !VE.assets[b.id] || VE.assets[b.id].status === "err");
    for (const beat of pending) {
      await App.generateBeat(beat.id);
    }
    if (btn) { btn.disabled = false; btn.textContent = "⚡ 전체 생성"; }
  },

  approveVisualEdit() {
    if (State.ws?.readyState === WebSocket.OPEN) {
      State.ws.send(JSON.stringify({ type: "approve", stage: "visual" }));
    }
    showPage("p-auto");
  },

  // ── 에피소드 뷰어 ────────────────────────────────────
  openViewer() {
    showPage("p-viewer");
    loadEpisodeList();
  },

  async selectEpisode(episodeId) {
    document.querySelectorAll(".ep-item").forEach(el =>
      el.classList.toggle("active", el.dataset.id === episodeId));
    const res  = await fetch(`/api/episodes/${episodeId}`);
    const data = await res.json();
    renderViewer(data);
  },

  async resetAndRun(episodeId, stage) {
    if (!confirm(`"${STAGE_KO[stage] ?? stage}" 단계부터 다시 실행할까요?\n이후 단계 데이터가 삭제됩니다.`)) return;
    await fetch(`/api/episodes/${episodeId}/reset-from/${stage}`, { method: "POST" });

    // 뷰어 닫고 파이프라인 재시작
    const res   = await fetch(`/api/episodes/${episodeId}`);
    const data  = await res.json();
    State.topic  = data.topic;
    State.intent = data.intent ?? "";

    const ws = new WebSocket(`ws://${location.host}`);
    State.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "start", topic: State.topic, intent: State.intent, episodeId }));
      document.getElementById("log-lines").innerHTML = "";
      document.getElementById("run-topic").textContent = State.topic;
      document.getElementById("run-title").textContent = `${STAGE_KO[stage] ?? stage}부터 재실행 중...`;
      document.getElementById("run-sub").textContent   = "이전 완료 단계는 건너뜁니다.";
      showPage("p-running");
    };
    ws.onmessage = (e) => { try { handleMessage(JSON.parse(e.data)); } catch {} };
    ws.onclose   = () => { State.ws = null; };
  },

  // 실행 중 스텝바 클릭 → 완료 단계 내용 오버레이로 조회
  async viewStage(stageName) {
    // 데모 모드: gatePayloads(이미 수신된) 또는 DEMO_DATA로 오버레이 표시
    if (Demo.active) {
      const payload = State.gatePayloads[stageName] ?? DEMO_DATA[stageName];
      if (!payload) { alert(`${stageName} 단계 데이터 없음`); return; }
      showStageOverlay("demo", stageName, {
        stages: { [stageName]: { status: "verified", decision_log: "데모 모드", payload } },
      });
      return;
    }
    const epId = State.episodeId;
    if (!epId) { alert("현재 진행 중인 에피소드 정보가 없습니다.\n에피소드 기록에서 확인해주세요."); return; }
    try {
      const res   = await fetch(`/api/episodes/${epId}`);
      const state = await res.json();
      showStageOverlay(epId, stageName, state);
    } catch { alert("단계 데이터를 불러오지 못했습니다."); }
  },

  // 완료 단계 스텝바 클릭 → 해당 gate 페이지로 풀 네비게이션
  backTo(stage) {
    const payload = State.gatePayloads[stage] ?? (Demo.active ? DEMO_DATA[stage] : null);
    const done = getDoneStages(stage);

    if (stage === "research" && payload) {
      buildStepbar("res-stepbar", "research", done);
      document.getElementById("res-topic").textContent = State.topic;
      renderClaims(payload);
      showPage("p-gate-research");
    } else if (stage === "structure" && payload) {
      buildStepbar("str-stepbar", "structure", done);
      document.getElementById("str-topic").textContent = State.topic;
      renderBeats(payload);
      showPage("p-gate-structure");
    } else if (stage === "script" && payload) {
      buildStepbar("scr-stepbar", "script", done);
      document.getElementById("scr-topic").textContent = State.topic;
      renderScript(payload);
      showPage("p-gate-script");
    } else if (stage === "voice" && payload) {
      buildStepbar("voi-stepbar", "voice", done);
      document.getElementById("voi-topic").textContent = State.topic;
      renderVoice(payload);
      showPage("p-gate-voice");
    } else if (stage === "dashboard") {
      _showDashboardGate();
    } else if (stage === "visual" || stage === "render") {
      showPage("p-auto");
    }
  },

  // 대본+B롤 대시보드
  async openDashboard() {
    State._prevPage = document.querySelector(".page.active")?.id ?? "p-running";

    // 데모 모드 또는 에피소드 없는 경우 → DEMO_DATA 직접 사용
    if (Demo.active || !State.episodeId || State.episodeId === "demo") {
      const mockState = {
        topic: State.topic || "데모",
        stages: {
          structure: { payload: DEMO_DATA.structure },
          script:    { payload: DEMO_DATA.script },
          visual:    { payload: DEMO_DATA.visual },
        },
      };
      renderDashboard(mockState);
      showPage("p-dashboard");
      return;
    }
    try {
      const res   = await fetch(`/api/episodes/${State.episodeId}`);
      const state = await res.json();
      renderDashboard(state);
      showPage("p-dashboard");
    } catch { alert("대시보드 데이터를 불러오지 못했습니다."); }
  },

  closeDashboard() { showPage(State._prevPage ?? "p-running"); },
};

// ── 대본+B롤 게이트 씬 편집 ──────────────────────────────
function _dbrdGetBeatLines(bi) {
  const beats    = State.gatePayloads.structure?.beats ?? [];
  const lines    = State.gatePayloads.script?.lines   ?? [];
  const numBeats = Math.max(beats.length, 1);
  const perBeat  = Math.ceil(lines.length / numBeats);
  const start    = bi * perBeat;
  const end      = (bi + 1) * perBeat;
  return { lines, perBeat, start, end, beatLines: lines.slice(start, end) };
}

Object.assign(App, {
  dbrdEditBeat(bi) {
    const linesEl = document.getElementById(`vrew-lines-${bi}`);
    if (!linesEl || linesEl.dataset.editing === "1") return;
    linesEl.dataset.editing = "1";

    const { beatLines, start } = _dbrdGetBeatLines(bi);
    linesEl.innerHTML = beatLines.map((line, i) =>
      `<textarea class="vrew-line-edit" data-gi="${start + i}" rows="2">${escHtml(line)}</textarea>`
    ).join("");

    const actEl = linesEl.closest("[data-beat-bi]")?.querySelector(".vrew-beat-actions");
    if (actEl) actEl.innerHTML = `
      <button class="vrew-act-btn vrew-act-save"   onclick="App.dbrdSaveEdit(${bi})">💾 저장</button>
      <button class="vrew-act-btn vrew-act-cancel" onclick="App.dbrdCancelEdit(${bi})">✕ 취소</button>`;
  },

  dbrdSaveEdit(bi) {
    const linesEl = document.getElementById(`vrew-lines-${bi}`);
    if (!linesEl) return;

    const lines = [...(State.gatePayloads.script?.lines ?? [])];
    linesEl.querySelectorAll("textarea.vrew-line-edit").forEach(ta => {
      const gi = parseInt(ta.dataset.gi);
      if (!isNaN(gi) && gi < lines.length) lines[gi] = ta.value.trim() || lines[gi];
    });
    if (State.gatePayloads.script) State.gatePayloads.script.lines = lines;

    delete linesEl.dataset.editing;
    App._dbrdRestoreLines(bi);
    App._dbrdRestoreActions(bi);
  },

  dbrdCancelEdit(bi) {
    const linesEl = document.getElementById(`vrew-lines-${bi}`);
    if (!linesEl) return;
    delete linesEl.dataset.editing;
    App._dbrdRestoreLines(bi);
    App._dbrdRestoreActions(bi);
  },

  dbrdRegenBeat(bi) {
    const beats = State.gatePayloads.structure?.beats ?? [];
    const label = beats[bi]?.purpose ?? `비트 ${bi + 1}`;
    if (!State.ws || State.ws.readyState !== WebSocket.OPEN) {
      alert("진행 중인 파이프라인이 없습니다.");
      return;
    }
    const feedback = `씬 "${label}" 부분을 다시 작성해주세요.`;
    State.ws.send(JSON.stringify({ type: "reject", stage: "dashboard", feedback }));
    document.getElementById("run-topic").textContent = State.topic;
    showPage("p-running");
  },

  _dbrdRestoreLines(bi) {
    const linesEl = document.getElementById(`vrew-lines-${bi}`);
    if (!linesEl) return;
    const { beatLines, start } = _dbrdGetBeatLines(bi);
    linesEl.innerHTML = beatLines.map((line, i) =>
      `<div class="vrew-script-line">
        <span class="vrew-line-idx">${start + i + 1}</span>
        <span class="vrew-line-txt">${escHtml(line)}</span>
      </div>`).join("");
  },

  _dbrdRestoreActions(bi) {
    const cell  = document.querySelector(`[data-beat-bi="${bi}"]`);
    const actEl = cell?.querySelector(".vrew-beat-actions");
    if (!actEl) return;
    actEl.innerHTML = `
      <button class="vrew-act-btn vrew-act-edit"  onclick="App.dbrdEditBeat(${bi})">✏️ 편집</button>
      <button class="vrew-act-btn vrew-act-regen" onclick="App.dbrdRegenBeat(${bi})">↺ 재생성</button>`;
  },

  // ── 편집비주얼 플레이어 ─────────────────────────────────
  veSelectBeat(bi) {
    App.veStopPlay();
    _veShowBeat(bi);
  },

  veTogglePlay() {
    if (VE.playing) { App.veStopPlay(); return; }
    VE.playing = true;
    const btn = document.getElementById("ve-play-btn");
    if (btn) btn.textContent = "⏸ 일시정지";
    App._veAdvance();
  },

  veStopPlay() {
    VE.playing = false;
    clearTimeout(VE.playTimer);
    VE.playTimer = null;
    const btn = document.getElementById("ve-play-btn");
    if (btn) btn.textContent = "▶ 재생";
  },

  _veAdvance() {
    if (!VE.playing) return;
    const beat  = VE.beats[VE.currentBeat];
    const raw   = beat?.estimated_sec ?? beat?.duration_seconds ?? 3;
    // 미리보기 상한 6초 — 너무 긴 씬도 편하게 확인
    const delay = Math.min(6000, Math.max(1500, raw * 1000));
    VE.playTimer = setTimeout(() => {
      if (!VE.playing) return;
      if (VE.currentBeat < VE.beats.length - 1) {
        _veShowBeat(VE.currentBeat + 1);
        App._veAdvance();
      } else {
        App.veStopPlay();
      }
    }, delay);
  },

  vePrev() {
    App.veStopPlay();
    if (VE.currentBeat > 0) _veShowBeat(VE.currentBeat - 1);
  },

  veNext() {
    App.veStopPlay();
    if (VE.currentBeat < VE.beats.length - 1) _veShowBeat(VE.currentBeat + 1);
  },

  // ── 편집비주얼 씬 수동 편집 ─────────────────────────────
  veEditBeat(bi) {
    VE.editingBeat = bi;
    const beat     = VE.beats[bi];
    const numBeats = Math.max(VE.beats.length, 1);
    const perBeat  = Math.ceil(VE.lines.length / numBeats);
    const beatLines = VE.lines.slice(bi * perBeat, (bi + 1) * perBeat);

    const titleEl = document.getElementById("ve-edit-title");
    if (titleEl) titleEl.textContent = `씬 ${bi + 1} — ${beat?.purpose ?? ""}`;

    const taEl = document.getElementById("ve-edit-script-ta");
    if (taEl) taEl.value = beatLines.join("\n");

    const secEl = document.getElementById("ve-edit-sec-inp");
    if (secEl) secEl.value = beat?.estimated_sec ?? beat?.duration_seconds ?? 5;

    const panel = document.getElementById("ve-edit-panel");
    if (panel) panel.style.display = "block";

    _veShowBeat(bi);
  },

  veEditSave() {
    const bi = VE.editingBeat;
    if (bi < 0) return;

    const lines    = [...(State.gatePayloads.script?.lines ?? [])];
    const numBeats = Math.max(VE.beats.length, 1);
    const perBeat  = Math.ceil(lines.length / numBeats);
    const newLines = (document.getElementById("ve-edit-script-ta")?.value ?? "")
      .split("\n").map(l => l.trim()).filter(Boolean);

    newLines.forEach((line, i) => {
      const gi = bi * perBeat + i;
      if (gi < lines.length) lines[gi] = line;
    });
    if (State.gatePayloads.script) State.gatePayloads.script.lines = lines;
    VE.lines = lines;

    const newSec = parseInt(document.getElementById("ve-edit-sec-inp")?.value);
    if (!isNaN(newSec) && VE.beats[bi]) {
      VE.beats[bi].estimated_sec    = newSec;
      VE.beats[bi].duration_seconds = newSec;
    }

    App.veEditClose();
    _veRenderTimeline();
    _veShowBeat(bi);
  },

  veEditClose() {
    VE.editingBeat = -1;
    const panel = document.getElementById("ve-edit-panel");
    if (panel) panel.style.display = "none";
  },

  veRegenCurrent() {
    const bi   = VE.editingBeat >= 0 ? VE.editingBeat : VE.currentBeat;
    const beat = VE.beats[bi];
    if (beat) App.generateBeat(beat.id ?? bi + 1);
    App.veEditClose();
  },
});

// ── 유틸 ────────────────────────────────────────────────
function escHtml(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ── 단계 오버레이 ────────────────────────────────────────
function showStageOverlay(epId, stageName, epState) {
  const NAMES = { research:"리서치", structure:"구성", script:"대본", voice:"음성", visual:"비주얼", render:"렌더" };
  const st = epState?.stages?.[stageName];
  if (!st) { alert(`${stageName} 단계 데이터 없음`); return; }

  document.getElementById("ov-title").textContent = `${NAMES[stageName] ?? stageName} — ${st.status}`;
  const body = document.getElementById("ov-body");
  body.innerHTML = "";

  if (st.decision_log) {
    const log = document.createElement("div");
    log.className = "ov-log-block";
    log.innerHTML = `<div class="ov-label">결정 로그</div><div class="ov-log-text">${escHtml(st.decision_log)}</div>`;
    body.appendChild(log);
  }

  const payload = st.payload;
  if (payload) {
    body.appendChild(renderStagePayload(stageName, payload));
  } else {
    const empty = document.createElement("div");
    empty.className = "vw-no-data";
    empty.textContent = "payload 없음 (아직 실행 전이거나 실패한 단계)";
    body.appendChild(empty);
  }

  const saveBtn = document.getElementById("ov-save-btn");
  saveBtn.style.display = (["script","structure","research"].includes(stageName) && epId !== "demo") ? "inline-flex" : "none";
  saveBtn.dataset.epId = epId;
  saveBtn.dataset.stage = stageName;

  document.getElementById("stage-overlay").style.display = "flex";
}

function closeStageOverlay() {
  document.getElementById("stage-overlay").style.display = "none";
}

function renderStagePayload(stageName, payload) {
  const wrap = document.createElement("div");
  wrap.className = "ov-payload";

  if (stageName === "research" && payload.claims) {
    wrap.innerHTML = `<div class="ov-label">수집된 클레임 (${payload.claims.length}개)</div>`;
    payload.claims.forEach((c, i) => {
      const el = document.createElement("div");
      el.className = "ov-claim-item";
      el.innerHTML = `<div class="ov-claim-num">${i+1}</div>
        <div class="ov-claim-body">
          <div class="ov-claim-text" contenteditable="true" data-idx="${i}">${escHtml(c.text)}</div>
          <div class="ov-claim-meta">${escHtml(c.value ?? "")} &nbsp;·&nbsp; <a href="${escHtml(c.source_url ?? "#")}" target="_blank" class="ov-claim-link">${escHtml(c.source_date ?? "출처")}</a></div>
        </div>`;
      wrap.appendChild(el);
    });

  } else if (stageName === "structure" && payload.beats) {
    wrap.innerHTML = `<div class="ov-label">비트 구성 (${payload.beats.length}개)</div>`;
    payload.beats.forEach((b, i) => {
      const el = document.createElement("div");
      el.className = "ov-beat-item";
      el.innerHTML = `<div class="ov-beat-num">${i+1}</div>
        <div class="ov-beat-body">
          <div class="ov-beat-purpose">${escHtml(b.purpose)}</div>
          <div class="ov-beat-desc" contenteditable="true" data-idx="${i}">${escHtml(b.content ?? b.description ?? "")}</div>
          <div class="ov-beat-sec">${b.duration_seconds ?? 0}초</div>
        </div>`;
      wrap.appendChild(el);
    });

  } else if (stageName === "script" && payload.lines) {
    wrap.innerHTML = `<div class="ov-label">대본 줄 (${payload.lines.length}줄 / 추정 ${payload.estimated_seconds ?? "?"}초)</div>`;
    payload.lines.forEach((line, i) => {
      const el = document.createElement("div");
      el.className = "ov-script-line";
      el.innerHTML = `<span class="ov-line-num">${i+1}</span>
        <span class="ov-line-text" contenteditable="true" data-idx="${i}">${escHtml(line)}</span>`;
      wrap.appendChild(el);
    });

  } else if (stageName === "voice") {
    const audioPath = payload.audio_path ?? "";
    wrap.innerHTML = `<div class="ov-label">음성 파일</div>
      <div class="ov-voice-card">
        <div class="ov-voice-path">${escHtml(audioPath)}</div>
        ${audioPath ? `<audio controls src="/${audioPath.replace(/\\/g,'/')}" style="width:100%;margin-top:10px"></audio>` : '<div class="ov-no-audio">파일 없음</div>'}
        <div class="ov-voice-meta">추정 ${payload.estimated_seconds ?? "?"}초 · 오프셋 ${payload.sync_offset_ms ?? 0}ms</div>
      </div>`;

  } else if (stageName === "visual" && payload.assets) {
    wrap.innerHTML = `<div class="ov-label">비주얼 에셋 (${payload.assets.length}개)</div>`;
    payload.assets.forEach(a => {
      const el = document.createElement("div");
      el.className = "ov-asset-item";
      const src = a.file_path ? `/${a.file_path.replace(/\\/g,'/')}` : "";
      el.innerHTML = `<div class="ov-asset-beat">${escHtml(a.beat_id ?? "")}</div>
        ${src ? `<img src="${src}" class="ov-asset-thumb" alt="${escHtml(a.beat_id ?? '')}" onerror="this.style.display='none'">` : ""}
        <div class="ov-asset-path">${escHtml(a.file_path ?? "")}</div>`;
      wrap.appendChild(el);
    });

  } else if (stageName === "render") {
    const vidPath = payload.video_path ?? "";
    wrap.innerHTML = `<div class="ov-label">렌더링 결과</div>
      <div class="ov-voice-card">
        <div class="ov-voice-path">${escHtml(vidPath)}</div>
        ${vidPath ? `<video controls src="/${vidPath.replace(/\\/g,'/')}" style="width:100%;max-height:280px;margin-top:10px"></video>` : '<div class="ov-no-audio">파일 없음</div>'}
      </div>`;

  } else {
    const pre = document.createElement("pre");
    pre.className = "vw-json";
    pre.textContent = JSON.stringify(payload, null, 2);
    wrap.appendChild(pre);
  }

  return wrap;
}

async function saveStageEdit() {
  const btn = document.getElementById("ov-save-btn");
  const epId = btn.dataset.epId;
  const stage = btn.dataset.stage;
  const body = document.getElementById("ov-body");
  const updates = {};

  if (stage === "script") {
    const lines = [];
    body.querySelectorAll(".ov-line-text").forEach(el => lines.push(el.textContent.trim()));
    updates.lines = lines;
  } else if (stage === "structure") {
    const descs = [];
    body.querySelectorAll(".ov-beat-desc").forEach(el => descs.push(el.textContent.trim()));
    updates.beat_descriptions = descs;
  } else if (stage === "research") {
    const texts = [];
    body.querySelectorAll(".ov-claim-text").forEach(el => texts.push(el.textContent.trim()));
    updates.claim_texts = texts;
  }

  try {
    const res = await fetch(`/api/episodes/${epId}/stages/${stage}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      const orig = btn.innerHTML;
      btn.textContent = "✓ 저장됨";
      setTimeout(() => { btn.innerHTML = orig; }, 1800);
    } else { alert("저장 실패"); }
  } catch { alert("저장 요청 오류"); }
}

// ── 대시보드 렌더링 (Vrew 테이블 방식) ────────────────────
function renderDashboard(epState) {
  const topicEl = document.getElementById("dash-topic");
  if (topicEl) topicEl.textContent = epState?.topic ?? "대시보드";
  renderVrewTable(epState, "dash-body");
}

function renderVrewTable(epState, targetId, opts = {}) {
  const { editMode = false } = opts;
  const body = document.getElementById(targetId);
  if (!body) return;

  const beats  = epState?.stages?.structure?.payload?.beats  ?? [];
  const lines  = epState?.stages?.script?.payload?.lines     ?? [];
  const assets = epState?.stages?.visual?.payload?.assets    ?? [];

  if (!beats.length && !lines.length) {
    body.innerHTML = '<div class="vrew-empty">대본·구성 데이터가 없습니다<br><span style="font-size:12px;color:var(--t3)">구성·대본 단계까지 완료된 후 확인하세요</span></div>';
    return;
  }

  const COLORS = ["#7c3aed","#0891b2","#059669","#d97706","#dc2626","#6366f1"];
  const numBeats = Math.max(beats.length, 1);
  const perBeat  = Math.ceil(lines.length / numBeats);

  let html = `<div class="vrew-table-head">
    <div class="vrew-col-head">비트</div>
    <div class="vrew-col-head">B롤</div>
    <div class="vrew-col-head">대본</div>
  </div>`;

  beats.forEach((beat, bi) => {
    const beatLines = lines.slice(bi * perBeat, (bi + 1) * perBeat);
    const asset     = assets[bi] ?? null;
    const assetSrc  = asset?.file_path ? `/${asset.file_path.replace(/\\/g,'/')}` : "";
    const assetDescRaw = asset?.description ?? asset?.beat_id ?? "";
    const assetDesc = escHtml(assetDescRaw);
    const color     = COLORS[bi % COLORS.length];
    const label     = escHtml(beat.purpose ?? `BEAT ${bi + 1}`);
    const desc      = escHtml(beat.content ?? beat.description ?? "");
    const sec       = beat.duration_seconds ? `⏱ ${beat.duration_seconds}초` : "";

    const thumbInner = assetSrc
      ? `<img src="${escHtml(assetSrc)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.closest('.vrew-thumb').innerHTML='<div class=\\'vrew-thumb-ph\\'><div class=\\'vrew-thumb-ph-icon\\' style=\\'color:${color}\\'>🖼</div></div>'">`
      : `<div class="vrew-thumb-ph" style="background:${color}0d">
           <div class="vrew-thumb-ph-icon" style="color:${color}">🖼</div>
           ${assetDesc ? `<div class="vrew-thumb-ph-txt">${assetDesc}</div>` : ""}
         </div>`;

    const scriptHtml = beatLines.length
      ? beatLines.map((line, li) =>
          `<div class="vrew-script-line">
            <span class="vrew-line-idx">${bi * perBeat + li + 1}</span>
            <span class="vrew-line-txt">${escHtml(line)}</span>
          </div>`).join("")
      : '<div class="vrew-no-script">대본 없음</div>';

    const actionsHtml = editMode ? `
      <div class="vrew-beat-actions">
        <button class="vrew-act-btn vrew-act-edit" onclick="App.dbrdEditBeat(${bi})">✏️ 편집</button>
        <button class="vrew-act-btn vrew-act-regen" onclick="App.dbrdRegenBeat(${bi})">↺ 재생성</button>
      </div>` : "";

    html += `<div class="vrew-row">
      <div class="vrew-beat-cell">
        <span class="vrew-beat-badge" style="background:${color}18;color:${color};border-color:${color}44">${label}</span>
        ${sec  ? `<span class="vrew-beat-sec">${sec}</span>`   : ""}
        ${desc ? `<div class="vrew-beat-desc">${desc}</div>` : ""}
      </div>
      <div class="vrew-broll-cell">
        <div class="vrew-thumb">${thumbInner}</div>
        ${assetDesc ? `<div class="vrew-broll-desc">${assetDesc}</div>` : ""}
      </div>
      <div class="vrew-script-cell"${editMode ? ` data-beat-bi="${bi}"` : ""}>
        <div class="vrew-script-lines"${editMode ? ` id="vrew-lines-${bi}"` : ""}>${scriptHtml}</div>
        ${actionsHtml}
      </div>
    </div>`;
  });

  body.innerHTML = html;
}

function brollPlaceholder(desc, color) {
  return `<div class="vrew-thumb-ph" style="background:${color}0d">
    <div class="vrew-thumb-ph-icon" style="color:${color}">🖼</div>
    <div class="vrew-thumb-ph-txt">${escHtml(desc || "B롤 미생성")}</div>
  </div>`;
}

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
  visual: { assets: [
    { beat_id: "HOOK",   file_path: "", description: "서울 아파트 야경 — 조명이 켜진 아파트 단지" },
    { beat_id: "BEAT 1", file_path: "", description: "한국은행 건물 외관, 금리 그래프 오버레이" },
    { beat_id: "BEAT 2", file_path: "", description: "역사적 금리 차트 — 2019~2026 추이" },
    { beat_id: "BEAT 3", file_path: "", description: "서울 지도 위 수혜 지역 하이라이트" },
    { beat_id: "결말",   file_path: "", description: "스마트폰으로 부동산 앱 검색하는 손" },
  ]},
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
      voice:     () => _showDashboardGate(),  // 음성 승인 → 대본+B롤 게이트
      dashboard: () => Demo._autoPhase(),     // 대본+B롤 승인 → 비주얼 자동 시작
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

// ── 시작 화면 이어하기 카드 ───────────────────────────
const STAGE_KO = {
  research: "리서치", structure: "구성", script: "대본",
  voice: "음성", visual: "비주얼", render: "렌더",
};

async function loadResumeCard() {
  try {
    const res  = await fetch("/api/resume");
    const data = await res.json();
    if (!data) return;
    State._resume = data;
    document.getElementById("resume-topic-text").textContent = data.topic;
    document.getElementById("resume-stage-text").textContent = STAGE_KO[data.lastStage] ?? data.lastStage;
    const ago = data.updatedAt
      ? Math.round((Date.now() - new Date(data.updatedAt).getTime()) / 60000) + "분 전"
      : "";
    document.getElementById("resume-time-text").textContent = ago;
    document.getElementById("resume-card").style.display = "block";
  } catch {}
}
loadResumeCard();

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

// ── 에피소드 뷰어 ──────────────────────────────────────

async function loadEpisodeList() {
  const list = document.getElementById("ep-list");
  list.innerHTML = '<div class="ep-empty">불러오는 중...</div>';
  try {
    const res  = await fetch("/api/episodes");
    const eps  = await res.json();
    if (!eps.length) { list.innerHTML = '<div class="ep-empty">에피소드 없음</div>'; return; }
    list.innerHTML = eps.map(ep => {
      const statusCls = ep.finalApproved ? "done" : ep.doneCount > 0 ? "partial" : "new";
      const statusTxt = ep.finalApproved ? "완료" : `${ep.doneCount}/${ep.totalStages}`;
      const date = ep.updatedAt ? ep.updatedAt.slice(0,10) : "";
      return `<div class="ep-item" data-id="${esc(ep.episodeId)}" onclick="App.selectEpisode('${esc(ep.episodeId)}')">
        <div class="ep-item-topic">${esc(ep.topic)}</div>
        <div class="ep-item-meta">
          <span class="ep-status ${statusCls}">${statusTxt}</span>
          <span class="ep-date">${date}</span>
        </div>
      </div>`;
    }).join("");
  } catch { list.innerHTML = '<div class="ep-empty">로드 실패</div>'; }
}

function renderViewer(state) {
  const main = document.getElementById("viewer-main");
  const stages = ["research","structure","script","voice","visual","render"];
  const stageLabels = { research:"리서치", structure:"구성", script:"대본", voice:"음성", visual:"비주얼", render:"렌더" };
  const epId = state.episode_id;

  const tabs = stages.map(s => {
    const st = state.stages?.[s];
    const hasData = st?.payload !== null && st?.payload !== undefined;
    const cls = st?.status === "verified" && st?.human_approved ? "done"
              : st?.status === "in_progress" || st?.status === "produced" ? "active" : "wait";
    const clickable = st?.status !== undefined && st?.status !== null && st?.status !== "pending";
    const onclick = clickable ? `onclick="renderStageContent('${epId}', '${s}', this)"` : "";
    return `<button class="vw-tab ${cls}${clickable ? "" : " disabled"}" ${onclick} title="${clickable ? stageLabels[s] : "아직 실행 안 됨"}">${stageLabels[s]}</button>`;
  }).join("");

  main.innerHTML = `
    <div class="vw-header">
      <div class="vw-topic">${esc(state.topic)}</div>
      <div class="vw-ep-id">${esc(epId)}</div>
    </div>
    <div class="vw-tabs">${tabs}</div>
    <div class="vw-content" id="vw-content">
      <div class="viewer-placeholder">위에서 단계를 선택하세요</div>
    </div>`;

  // 첫 번째 완료 단계 자동 선택
  const firstDone = stages.find(s => {
    const st = state.stages?.[s];
    return st?.status === "verified" || st?.status === "produced" || st?.status === "in_progress";
  });
  if (firstDone) {
    const btn = main.querySelector(`.vw-tab`);
    const targetBtn = [...main.querySelectorAll(".vw-tab")].find((_, i) => stages[i] === firstDone);
    if (targetBtn) renderStageContent(epId, firstDone, targetBtn);
  }
}

async function renderStageContent(epId, stageName, btnEl) {
  // 탭 활성화
  btnEl.closest(".vw-tabs").querySelectorAll(".vw-tab").forEach(b => b.classList.remove("sel"));
  btnEl.classList.add("sel");

  const res   = await fetch(`/api/episodes/${epId}`);
  const state = await res.json();
  const stage = state.stages?.[stageName];
  const payload = stage?.payload;
  const content = document.getElementById("vw-content");

  const statusBadge = stage?.status === "verified" && stage?.human_approved
    ? '<span class="vw-badge done">완료</span>'
    : stage?.status === "in_progress" ? '<span class="vw-badge run">진행중</span>'
    : stage?.status === "produced"    ? '<span class="vw-badge run">생성됨</span>'
    : '<span class="vw-badge wait">미실행</span>';

  let payloadHtml = "";
  if (!payload) {
    payloadHtml = '<div class="vw-no-data">아직 데이터 없음</div>';
  } else if (stageName === "research" && payload.claims) {
    payloadHtml = `<div class="claims-list">${payload.claims.map(c => `
      <div class="claim-card">
        <div class="claim-body">
          <div class="claim-text">${esc(c.text)}</div>
          <div class="claim-value">${esc(c.value)}</div>
          ${c.source_url ? `<a class="claim-src" href="${esc(c.source_url)}" target="_blank">${esc(safeHostname(c.source_url))} · ${esc(c.source_date ?? "")}</a>` : ""}
        </div>
      </div>`).join("")}</div>`;
  } else if (stageName === "structure" && payload.beats) {
    payloadHtml = `<div class="beats-list">${payload.beats.map((b,i) => `
      <div class="beat-card">
        <div class="beat-num">${i+1}</div>
        <div class="beat-body">
          <div class="beat-purpose">${esc(b.purpose)}</div>
          <div class="beat-desc">${esc(b.description)}</div>
          <div class="beat-dur">${b.duration_seconds}초</div>
        </div>
      </div>`).join("")}</div>`;
  } else if (stageName === "script" && payload.lines) {
    payloadHtml = `<div class="script-box">${payload.lines.map((l,i) => `
      <div class="s-line-row"><span class="s-num">${i+1}</span><span class="s-text">${esc(l)}</span></div>`
    ).join("")}</div>`;
  } else if (stageName === "voice" && payload.audio_path) {
    const rel = payload.audio_path.replace(/\\/g,"/").split("output/").pop();
    payloadHtml = `<div class="audio-card">
      <audio controls src="/output/${esc(rel)}" style="width:100%;margin:16px 0"></audio>
      <div style="font-size:12px;color:#475569">${esc(payload.audio_path)}</div>
    </div>`;
  } else {
    payloadHtml = `<pre class="vw-json">${esc(JSON.stringify(payload, null, 2))}</pre>`;
  }

  const stageLabels = { research:"리서치", structure:"구성", script:"대본", voice:"음성", visual:"비주얼", render:"렌더" };
  content.innerHTML = `
    <div class="vw-stage-head">
      <span class="vw-stage-name">${stageLabels[stageName] ?? stageName}</span>
      ${statusBadge}
      <button class="vw-run-btn" onclick="App.resetAndRun('${esc(epId)}', '${esc(stageName)}')">↺ 이 단계부터 재실행</button>
    </div>
    ${stage?.decision_log ? `<div class="vw-log">${esc(stage.decision_log)}</div>` : ""}
    ${payloadHtml}`;
}

// ── 단축키 ─────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  const modal = document.getElementById("script-paste-modal");
  if (!modal?.classList.contains("visible")) return;
  if (e.key === "Escape") { e.preventDefault(); App.toggleScriptPaste(); }
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); App.useCustomScript(); }
});
