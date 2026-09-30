import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";

const port = 4317;
const lan = Object.values(os.networkInterfaces())
  .flat()
  .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
  .map((entry) => entry.address);
console.log(`電腦本機： http://127.0.0.1:${port}`);
if (lan.length === 0) {
  console.log(`手機請跟電腦同一 Wi-Fi，用電腦局域网 IP 開 http://<局域网IP>:${port}`);
} else {
  for (const address of lan) console.log(`手機同一 Wi-Fi： http://${address}:${port}`);
}

const hasApi = existsSync(".venv/bin/python");
if (!hasApi) {
  console.warn("找不到 .venv，求解 API 不會啟動。編崗畫面仍可用。要連求解請先 npm run setup。");
}

const api = hasApi
  ? spawn(
      ".venv/bin/python",
      ["-m", "uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "4318"],
      { stdio: "inherit" },
    )
  : null;
const web = spawn("./node_modules/.bin/vite", ["--host", "0.0.0.0", "--port", "4317"], {
  stdio: "inherit",
});

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  api?.kill("SIGTERM");
  web.kill("SIGTERM");
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
api?.on("exit", (code) => {
  if (!shuttingDown) shutdown(code ?? 1);
});
web.on("exit", (code) => {
  if (!shuttingDown) shutdown(code ?? 1);
});
