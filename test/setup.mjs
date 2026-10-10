// Loaded before every unit test file (node --test --import): no real key, and no request to anything but this machine.
import http from "node:http";
import https from "node:https";

for (const k of ["DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "DISCORD_BOT_TOKEN"]) delete process.env[k];

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const check = (host) => { if (!LOCAL.has(String(host || "localhost").toLowerCase())) throw new Error(`unit tests must not call the network: ${host}`); };
const hostOf = ([a, b]) => (typeof a === "string" ? new URL(a).hostname : a instanceof URL ? a.hostname : a?.hostname || a?.host?.split(":")[0] || b?.hostname || "localhost");

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  check(new URL(typeof input === "string" || input instanceof URL ? input : input.url).hostname);
  return realFetch(input, init);
};
for (const mod of [http, https]) {
  for (const fn of ["request", "get"]) {
    const real = mod[fn];
    mod[fn] = (...args) => { check(hostOf(args)); return real.apply(mod, args); };
  }
}
