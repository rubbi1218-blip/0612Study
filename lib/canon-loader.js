import fs from "fs";
import { CONFIG } from "../config.js";

export function loadCanon(canonPath = CONFIG.paths.canon) {
  if (!fs.existsSync(canonPath)) {
    throw new Error(`[canon] CANON.md 없음: ${canonPath} — 파일을 먼저 작성하세요.`);
  }
  return fs.readFileSync(canonPath, "utf8");
}
