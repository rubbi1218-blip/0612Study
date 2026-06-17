import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import { fork } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// visual·render 게이트는 자동 승인 (사람 개입 불필요)
const AUTO_APPROVE = new Set(["visual", "render"]);

const app = express();
app.use(express.static(join(__dirname, "public")));
app.use("/output", express.static(join(__dirname, "output")));

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
      if (msg.fresh) args.push("--fresh");

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
          if (!line.trim()) continue;
          const level = line.includes("✅") ? "ok"
            : line.includes("❌") || line.includes("오류") ? "error"
            : line.includes("⚠️") || line.includes("⏸") ? "warn"
            : "info";
          safeSend(ws, { type: "log", level, message: line.trim() });
        }
      });

      child.stderr.on("data", (chunk) => {
        for (const line of chunk.toString().split("\n")) {
          if (line.trim()) safeSend(ws, { type: "log", level: "error", message: line.trim() });
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
