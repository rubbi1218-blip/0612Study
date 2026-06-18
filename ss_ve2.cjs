const { chromium } = require("playwright");
(async () => {
  const br = await chromium.launch({ headless: false, slowMo: 50 });
  const pg = await br.newPage();
  await pg.setViewportSize({ width: 1440, height: 860 });
  await pg.goto("http://localhost:3000");
  await pg.waitForSelector("#inp-topic", { timeout: 5000 });

  await pg.evaluate(() => {
    State.episodeId = "ep-ve2-test";
    State.topic     = "한국 금리 인하 전망 2026";
    State.gatePayloads.structure = {
      beats: [
        { id:1, purpose:"Hook — 충격적 수치",  content:"금리 동결 충격", estimated_sec:10 },
        { id:2, purpose:"원인 분석",            content:"물가와 가계부채", estimated_sec:18 },
        { id:3, purpose:"데이터 차트",          content:"기준금리 추이",  estimated_sec:15 },
        { id:4, purpose:"전망",                 content:"하반기 전망",   estimated_sec:20 },
        { id:5, purpose:"CTA",                  content:"행동 촉구",     estimated_sec:8  },
      ],
    };
    State.gatePayloads.script = {
      lines: [
        "2026년, 한국은행이 시장의 예상을 완전히 깨버렸습니다.",
        "물가는 잡혔지만 가계부채가 발목을 잡고 있습니다.",
        "기준금리 3.5%, 동결 행진이 계속되고 있습니다.",
        "전문가들은 하반기 1회 인하 가능성을 높게 점칩니다.",
        "지금 당장 단기 채권 ETF를 확인해보세요.",
      ],
    };
    State.gatePayloads.research = { claims: [] };
    State.gatePayloads.visual   = { assets: [] };
  });

  await pg.evaluate(() => {
    renderVisualEdit({ beats: State.gatePayloads.structure.beats, lines: State.gatePayloads.script.lines, claims:[] });
    showPage("p-visual-edit");
  });
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: "ss_ve2_1_main.png" });
  console.log("1. 메인 화면 → ss_ve2_1_main.png");

  // 텍스트 탭 열기
  await pg.evaluate(() => App.veSwitchTabName("text"));
  await pg.waitForTimeout(200);
  await pg.screenshot({ path: "ss_ve2_2_text.png" });
  console.log("2. 텍스트 탭 → ss_ve2_2_text.png");

  // 전환 탭
  await pg.evaluate(() => App.veSwitchTabName("trans"));
  await pg.waitForTimeout(200);
  await pg.screenshot({ path: "ss_ve2_3_trans.png" });
  console.log("3. 전환 탭 → ss_ve2_3_trans.png");

  // 씬 탭
  await pg.evaluate(() => App.veSwitchTabName("scene"));
  await pg.waitForTimeout(200);
  await pg.screenshot({ path: "ss_ve2_4_scene.png" });
  console.log("4. 씬 탭 → ss_ve2_4_scene.png");

  // 씬 2 선택 (타임라인 블록 클릭)
  await pg.evaluate(() => App.veSelectBeat(1));
  await pg.waitForTimeout(200);
  await pg.screenshot({ path: "ss_ve2_5_beat2.png" });
  console.log("5. 씬2 선택 → ss_ve2_5_beat2.png");

  await br.close();
  console.log("done");
})().catch(e => { console.error(e); process.exit(1); });
