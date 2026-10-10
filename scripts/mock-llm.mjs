// A tiny OpenAI-compatible model for local runs and tests: no tokens, deterministic. node scripts/mock-llm.mjs   (PORT, default 3011)
// Point the app at it with DEEPSEEK_BASE_URL=http://localhost:3011 (npm run dev:mock does). It answers POST /chat/completions
// (also under /v1), whole or as SSE when the request says stream:true. The app asks for JSON matching a schema that is printed
// in the system prompt, so the kind of request is read off that schema's fields and answered with a minimal valid object.
import http from "node:http";
import { pathToFileURL } from "node:url";

const MARK = "matching this JSON Schema:\n";

const schemaOf = (messages) => {
  const sys = String(messages?.find((m) => m.role === "system")?.content ?? "");
  const at = sys.lastIndexOf(MARK);
  if (at < 0) return null;
  try { return JSON.parse(sys.slice(at + MARK.length).split("\n")[0]); } catch { return null; }
};

// The emptiest value the schema allows: first enum, "", 0, false, [], and every property of an object.
const fill = (s) => {
  if (!s || typeof s !== "object") return "";
  if (s.enum) return s.enum[0];
  switch (s.type) {
    case "object": return Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, fill(v)]));
    case "array": return [];
    case "boolean": return false;
    case "integer": case "number": return 0;
    default: return "";
  }
};

const MOCK = "MOCK: the station hums.";
const draft = (o) => ({ ...o, title: "Mock Scenario", pitch: "A deterministic test scenario.", stationName: "MOCK STATION", lore: "MOCK lore.", computer: { name: "MOCK OS", persona: "You are a mock computer. Answer briefly." }, broadcastPersona: "A flat mock announcer.", voices: [{ id: "intercom", name: "INTERCOM", preset: "intercom", color: "", persona: "The mock intercom.", systems: ["ALL"] }], cast: [{ name: "Mock Person", sex: "f", voice: "af_sky", room: "", notes: "A mock cast member." }], documents: [{ title: "MOCK MEMO", text: "Nothing to see." }] });

export function answer(schema) {
  const p = schema?.properties;
  if (!p) return { reply: MOCK, lines: [{ voice: "narrator", character: "", system: "", text: MOCK, reveal: "" }] };
  const o = fill(schema);
  if (p.lines) {
    const v = p.lines.items?.properties?.voice?.enum;
    return { ...o, lines: [{ ...fill(p.lines.items), voice: v?.includes("narrator") ? "narrator" : v?.[0] ?? "narrator", text: MOCK }] };
  }
  if (p.needed) return o;
  if (p.ready) return { reply: MOCK, ready: true };
  if (p.stationName) return draft(o);
  if (p.lore && p.computer) return { ...draft(o), station: [{ path: "access_level", value: "GUEST" }] };
  if (p.pitches) return { pitches: [1, 2, 3, 4].map((n) => ({ title: `Mock Pitch ${n}`, hook: "A mock hook. Something feels wrong.", tags: "mock · test · quiet" })) };
  if (p.beats) return { ...o, beats: [{ line: "The crew took the job.", who: "" }, { line: "Nothing went wrong, much.", who: "" }, { line: "They flew on.", who: "" }], hook: "A new contract waits." };
  if (p.sections) return { ...o, verdict: "MOCK verdict.", sections: [{ heading: "What happened", audience: "players", text: "- Mock events." }, { heading: "Next goals", audience: "players", text: "- Mock goal." }].map((x) => (p.sections.items?.properties?.audience ? x : { heading: x.heading, text: x.text })) };
  if (p.title && p.text) return { title: "MOCK DOCUMENT", text: "# MOCK DOCUMENT\nNothing to see here." };
  if (p.rows) return { rows: ["##########", "#T..#...L#", "#...D....#", "#B..#...C#", "####DD####"] };
  return o;
}

export function mockServer() {
  return http.createServer((req, res) => {
    if (req.method !== "POST" || !/^\/(v1\/)?chat\/completions$/.test(req.url.split("?")[0])) { res.writeHead(404).end(JSON.stringify({ error: { message: "mock-llm: POST /chat/completions only" } })); return; }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body = {};
      try { body = JSON.parse(raw); } catch { /* answered as an empty request */ }
      const content = JSON.stringify(answer(schemaOf(body.messages)));
      const base = { id: "mock-1", created: 0, model: body.model || "mock" };
      if (body.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
        res.end();
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ...base, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }));
      }
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.env.PORT) || 3011;
  mockServer().listen(port, () => console.log(`mock-llm: listening on http://localhost:${port} (no real model, no tokens)`));
}
