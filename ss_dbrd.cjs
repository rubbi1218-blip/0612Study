const { chromium } = require("playwright");
(async () => {
  const br = await chromium.launch({ headless: false, slowMo: 60 });
  const pg = await br.newPage();
  await pg.setViewportSize({ width: 1280, height: 800 });
  await pg.goto("http://localhost:3000");
  await pg.waitForSelector("#inp-topic", { timeout: 5000 });

  await pg.evaluate(() => {
    State.episodeId = "ep-test-dbrd";
    State.topic = "한국 금리 인하 전망 2026";
    State.gatePayloads.structure = {
      beats: [
        { id: 1, purpose: "Hook — 충격적 수치", content: "2026년 금리 동결 충격", duration_seconds: 10 },
        { id: 2, purpose: "원인 분석", content: "물가와 가계부채", duration_seconds: 18 },
        { id: 3, purpose: "데이터 차트", content: "기준금리 추이", duration_seconds: 15 },
        { id: 4, purpose: "전망", content: "하반기 인하 가능성", duration_seconds: 20 },
      ]
    };
    State.gatePayloads.script = {
      lines: [
        "2026년, 한국은행이 시장의 예상을 완전히 깨버렸습니다.",
        "물가는 잡혔지만 가계부채가 발목을 잡고 있습니다.",
        "기준금리 3.5%, 동결 행진이 계속되고 있습니다.",
        "전문가들은 하반기 1회 인하 가능성을 높게 점칩니다.",
      ]
    };
    State.gatePayloads.research = { claims: [] };

    // 대본+B롤 게이트 직접 표시
    const structPl = State.gatePayloads.structure;
    const scriptPl = State.gatePayloads.script;
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
  });

  await pg.waitForTimeout(600);
  await pg.screenshot({ path: "ss_dbrd_1.png", fullPage: false });
  console.log("dashboard top captured");

  // 스크롤 다운해서 하단 확인
  await pg.evaluate(() => document.getElementById("dbrd-vrew-body").scrollTop = 300);
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: "ss_dbrd_2.png", fullPage: false });
  console.log("dashboard bottom captured");

  await br.close();
})().catch(e => { console.error(e); process.exit(1); });
