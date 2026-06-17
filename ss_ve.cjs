const { chromium } = require("playwright");
(async () => {
  const br = await chromium.launch({ headless: false, slowMo: 50 });
  const pg = await br.newPage();
  await pg.setViewportSize({ width: 1400, height: 820 });
  await pg.goto("http://localhost:3000");
  await pg.waitForSelector("#inp-topic", { timeout: 5000 });

  await pg.evaluate(() => {
    State.episodeId = "ep-ve-test";
    State.topic     = "한국 금리 인하 전망 2026";
    State.gatePayloads.structure = {
      beats: [
        { id: 1, purpose: "Hook — 충격적 수치",  content: "2026년 금리 동결 충격",  estimated_sec: 10 },
        { id: 2, purpose: "원인 분석",            content: "물가와 가계부채",        estimated_sec: 18 },
        { id: 3, purpose: "데이터 차트",          content: "기준금리 추이",          estimated_sec: 15 },
        { id: 4, purpose: "전망",                 content: "하반기 인하 가능성",     estimated_sec: 20 },
      ],
    };
    State.gatePayloads.script = {
      lines: [
        "2026년, 한국은행이 시장의 예상을 완전히 깨버렸습니다.",
        "물가는 잡혔지만 가계부채가 발목을 잡고 있습니다.",
        "기준금리 3.5%, 동결 행진이 계속되고 있습니다.",
        "전문가들은 하반기 1회 인하 가능성을 높게 점칩니다.",
      ],
    };
    State.gatePayloads.research = { claims: [] };
    State.gatePayloads.visual   = { assets: [] };
  });

  // 편집비주얼 페이지를 직접 열기
  await pg.evaluate(() => {
    const beats = State.gatePayloads.structure.beats;
    const lines = State.gatePayloads.script.lines;
    renderVisualEdit({ beats, lines, claims: [] });
    showPage("p-visual-edit");
  });

  await pg.waitForTimeout(600);
  await pg.screenshot({ path: "ss_ve_1_main.png" });
  console.log("1. 편집비주얼 메인 → ss_ve_1_main.png");

  // 씬 2 선택
  await pg.evaluate(() => App.veSelectBeat(1));
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: "ss_ve_2_beat1.png" });
  console.log("2. 씬 2 선택 → ss_ve_2_beat1.png");

  // 편집 패널 열기
  await pg.evaluate(() => App.veEditBeat(1));
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: "ss_ve_3_edit.png" });
  console.log("3. 편집 패널 → ss_ve_3_edit.png");

  await br.close();
  console.log("done");
})().catch(e => { console.error(e); process.exit(1); });
