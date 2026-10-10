// npm run dev:mock: the app on the mock model (scripts/mock-llm.mjs), so playing locally costs no tokens. Ctrl+C stops both.
// A node launcher because PowerShell cannot set an empty env var (the blank Discord token keeps the real bot off). PORT is the app's port (default 3000).
import { spawn } from "node:child_process";

const MOCK_PORT = process.env.MOCK_PORT || "3011";
const env = {
  ...process.env,
  DEEPSEEK_BASE_URL: `http://localhost:${MOCK_PORT}`,
  DEEPSEEK_API_KEY: "sk-mock",
  DISCORD_BOT_TOKEN: "",
  DATA_DIR: process.env.DATA_DIR || "./.tmp-mock",
  TELEMETRY: "0",
};
const kids = [
  spawn(process.execPath, ["scripts/mock-llm.mjs"], { env: { ...env, PORT: MOCK_PORT }, stdio: "inherit" }),
  spawn(process.execPath, ["server.js"], { env, stdio: "inherit" }),
];
const stop = () => { for (const k of kids) k.kill(); };
for (const k of kids) k.on("exit", stop);
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
