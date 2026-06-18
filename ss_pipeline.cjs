/**
 * 전체 파이프라인 E2E 테스트 (mock-voice/visual/render)
 * 게이트 순서: research → structure → script → voice → dashboard → visual-edit
 *
 * ElevenLabs 유료 플랜 없이 visual-edit 화면까지 검증하기 위해
 * voice/visual/render 단계를 FFmpeg mock으로 대체한다.
 */
const { chromium } = require("playwright");
const { WebSocket: NodeWS } = require("ws");

const TOPIC = "한국 금리 인하 전망 2026";
const MAX_ITER = 200;  // 200 × 3s = 600s (10분)

const GATE_PAGES = new Set([
  "p-gate-research", "p-gate-structure", "p-gate-script",
  "p-gate-voice",    "p-gate-dashboard", "p-gate-final",
]);

async function shot(pg, name) {
  const file = `ss_pipe_${name}.png`;
  await pg.screenshot({ path: file, fullPage: false });
  console.log(`  📸 ${file}`);
}

async function curPageId(pg) {
  return pg.evaluate(() => {
    const active = document.querySelector(".page.active");
    if (active) return active.id;
    for (const p of document.querySelectorAll(".page")) {
      if (getComputedStyle(p).display !== "none") return p.id;
    }
    return null;
  }).catch(() => null);
}

// ── fresh 에피소드 시작 (WS 직접 연결) ─────────────────────
async function startFreshPipeline(pg, topic) {
  return new Promise((resolve, reject) => {
    const ws = new NodeWS("ws://localhost:3000");
    let opened = false;
    ws.on("open", () => {
      opened = true;
      // fresh 에피소드 + mock-voice/visual/render
      ws.send(JSON.stringify({
        type:        "start",
        topic,
        intent:      "지금 어떻게 투자해야 할지 궁금하게 만들기",
        fresh:       true,
        mockVoice:   true,
        mockVisual:  true,
        mockRender:  true,
      }));
      ws.close();
      resolve();
    });
    ws.on("error", (e) => reject(e));
    setTimeout(() => { if (!opened) reject(new Error("WS 연결 타임아웃")); }, 5000);
  });
}

(async () => {
  const br = await chromium.launch({ headless: false, slowMo: 30 });
  const pg = await br.newPage();
  await pg.setViewportSize({ width: 1400, height: 860 });
  await pg.goto("http://localhost:3000");
  await pg.waitForSelector("#inp-topic", { timeout: 8000 });

  console.log("\n[1] 시작 화면 확인");
  await shot(pg, "01_start");

  // fresh + mock 플래그로 새 에피소드 시작
  console.log("  ▶ 새 에피소드 시작 (fresh + mock-voice/visual/render)");
  await pg.fill("#inp-topic", TOPIC);
  await pg.waitForTimeout(200);

  // 브라우저의 App.start()를 직접 호출하되, WS 메시지에 mock 플래그 추가
  await pg.evaluate((topic) => {
    // App.start를 임시 교체해서 mock 플래그 포함한 start 메시지 전송
    const _orig = App.start;
    App.start = function() {
      const intent = document.getElementById("inp-intent")?.value?.trim() ?? "";
      State.topic  = topic;
      State.intent = intent;
      const ws = new WebSocket(`ws://${location.host}`);
      State.ws = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: "start", topic, intent, fresh: true,
          mockVoice:  true,
          mockVisual: true,
          mockRender: true,
          renderer: State.models.renderer,
          tts:      State.models.tts,
        }));
        document.getElementById("log-lines").innerHTML = "";
        document.getElementById("run-topic").textContent = topic;
        document.getElementById("run-title").textContent = "연결 중 (mock 모드)...";
        document.getElementById("run-sub").textContent   = "AI가 리서치를 시작합니다.";
        showPage("p-running");
      };
      ws.onmessage = (e) => { try { handleMessage(JSON.parse(e.data)); } catch {} };
      ws.onclose   = () => { State.ws = null; };
      ws.onerror   = () => { State.ws = null; };
      // 원본 복원 (한 번만 교체)
      App.start = _orig;
    };
    App.start();
  }, TOPIC);

  // p-running 전환 대기
  let firstPage = null;
  for (let i = 0; i < 20; i++) {
    await pg.waitForTimeout(1000);
    firstPage = await curPageId(pg);
    if (firstPage && firstPage !== "p-start") break;
  }
  console.log(`  첫 페이지: ${firstPage}`);
  await shot(pg, "03_after_start");

  if (firstPage === "p-start") {
    console.error("❌ 파이프라인 시작 실패 — p-start에서 전환 안 됨");
    // 스크린샷 찍고 종료
    await shot(pg, "ERR_no_start");
    await br.close();
    process.exit(1);
  }

  let finalState = "timeout";
  let lastPage   = null;
  let lastGateAt = -5;

  for (let t = 0; t < MAX_ITER; t++) {
    await pg.waitForTimeout(3000);
    const elapsed = t * 3;
    const page = await curPageId(pg);

    const lastLog = await pg.evaluate(() => {
      const lines = document.querySelectorAll(".log-line");
      return lines.length ? lines[lines.length - 1]?.textContent?.trim() : "";
    }).catch(() => "");

    if (page !== lastPage || t % 10 === 0) {
      console.log(`  [t=${elapsed}s] page: ${page}${lastLog ? " | " + lastLog.slice(0, 80) : ""}`);
      lastPage = page;
    }

    if (t % 3 === 0) await shot(pg, `04_t${elapsed}s`);

    // ── 에스컬레이션 ─────────────────────────────────────────
    const escVisible = await pg.evaluate(() => {
      const el = document.getElementById("esc-overlay");
      return el && (el.classList.contains("visible") || getComputedStyle(el).display !== "none");
    }).catch(() => false);
    if (escVisible) {
      console.log("\n[⚠️ 에스컬레이션]");
      await shot(pg, "08_escalation");
      const reason = await pg.evaluate(() => {
        for (const sel of [".esc-reason", "#esc-reason", "#esc-message", ".esc-body", ".esc-title"]) {
          const el = document.querySelector(sel);
          if (el?.textContent?.trim()) return el.textContent.trim();
        }
        return document.getElementById("esc-overlay")?.textContent?.slice(0, 300) ?? "";
      }).catch(() => "");
      console.log(`  이유: ${reason.slice(0, 300)}`);
      finalState = "escalation";
      break;
    }

    if (page === "p-complete") {
      console.log("\n[🎉 완료]");
      await shot(pg, "09_complete");
      finalState = "complete";
      break;
    }

    if (page === "p-visual-edit") {
      console.log("\n[편집비주얼] 도달 ✅");
      await shot(pg, "07_visual_edit");
      finalState = "visual-edit";
      break;
    }

    if (page === "p-gate-final") {
      console.log("\n[최종 게이트]");
      await shot(pg, "06_gate_final");
      await pg.evaluate(() => App.approve("final")).catch(() => {});
      await pg.waitForTimeout(1500);
      continue;
    }

    if (GATE_PAGES.has(page) && t - lastGateAt > 1) {
      lastGateAt = t;
      const stage = page.replace("p-gate-", "");
      console.log(`\n[게이트] ${page} (stage: ${stage})`);
      await shot(pg, `05_gate_${stage}`);

      const result = await pg.evaluate((s) => {
        try { App.approve(s); return "ok:" + s; }
        catch (e) { return "err:" + e.message; }
      }, stage);
      console.log(`  ✅ 승인: ${result}`);
      await pg.waitForTimeout(1500);
    }
  }

  console.log(`\n[최종 상태] ${finalState}`);
  await shot(pg, "99_final");
  console.log("\n✅ 테스트 종료");
  await br.close();
})().catch(e => { console.error("❌", e.message); process.exit(1); });
