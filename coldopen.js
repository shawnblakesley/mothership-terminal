import { shownName, PICTURE_LINK } from "./voices.js";
import { crewWithFate } from "./crew.js";
import { PORTRAIT_FILE } from "./cast.js";

// The "Previously on..." cold open. A finished story leaves a snapshot on its campaign entry (what the players saw, who they met);
// building the next story writes 4-6 beats from it. Nothing the players never saw goes into either.
const KEY_LINES = 40;
const LINE_CHARS = 200;
const BEATS = 6;
const PICTURE_FILE = /^[a-f0-9]{12}\.(png|jpg|webp|gif)$/;

const clip = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const picOk = (p) => PORTRAIT_FILE.test(p) || PICTURE_FILE.test(p) || PICTURE_LINK.test(p);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Names the players haven't learned: replaced with ??? wherever they turn up.
export function scrub(text, hidden = []) {
  let t = String(text ?? "");
  for (const n of hidden) if (n) t = t.replace(new RegExp(escRe(n), "gi"), "???");
  return t;
}

const spoken = new Set(["terminal", "system", "entity", "player", "heard"]);

// state: the session state at Finish story. Public lines only: no Warden commands, notes or private replies.
export function snapshotStory(state) {
  const voices = state.config.voices || [];
  const hidden = voices.filter((v) => v.adversary && !v.adversary.revealed).map((v) => v.name).filter(Boolean).slice(0, 8);
  const rows = [];
  for (const e of state.log || []) {
    if (e.cut || !e.text) continue;
    if (e.kind === "note") {
      if (/ died: |^Cast: .* joins the story\./.test(e.text)) rows.push(clip(e.text.replace(/ Their file goes on the memorial.*$/, ""), LINE_CHARS));
      continue;
    }
    if (e.kind === "roll") { const m = /^(.*)\n.*\n(CRITICAL )?(SUCCESS|FAILURE)/.exec(e.text); if (m && (m[2] || /PANIC/.test(e.text))) rows.push(clip(e.text.replace(/\n/g, " · "), LINE_CHARS)); continue; }
    if (!spoken.has(e.kind)) continue;
    const v = e.kind === "entity" ? voices.find((x) => x.id === e.entity) : null;
    const who = e.kind === "player" ? `PLAYER${e.by ? ` ${e.by}` : ""}` : e.kind === "heard" ? "WARDEN" : [v ? shownName(v) : e.kind === "system" ? "BROADCAST" : "TERMINAL", e.character].filter(Boolean).join(" · ").toUpperCase();
    rows.push(`${who}: ${clip(e.text, LINE_CHARS)}`);
  }
  const key = rows.length > KEY_LINES ? [...rows.slice(0, KEY_LINES - 10).filter((_, i, a) => i % Math.ceil(a.length / (KEY_LINES - 10)) === 0), ...rows.slice(-10)] : rows;
  const seen = new Set((state.log || []).filter((e) => e.character).map((e) => e.character.toLowerCase()));
  const figures = [
    ...(state.config.cast || []).filter((m) => seen.has(m.name.toLowerCase())).map((m) => ({ name: m.name, kind: "cast", pic: m.portrait || "", credit: "" })),
    ...voices.filter((v) => v.adversary?.revealed).map((v) => ({ name: v.name, kind: "adv", pic: v.adversary.picture || "", credit: v.adversary.credit || "" })),
  ].slice(0, 12);
  // Only "So far": it holds what the players learned. A wrap-up also tells what they never found out.
  const wrap = (state.synopses?.sofar?.sections || []).filter((x) => x.audience === "players" && /^so far$/i.test(x.heading)).map((x) => x.text).join("\n");
  return sanitizeSnapshot({ key, figures, hidden, wrap });
}

export function sanitizeSnapshot(x) {
  if (!x || typeof x !== "object") return null;
  const list = (a, n) => (Array.isArray(a) ? a : []).slice(0, n);
  const hidden = list(x.hidden, 8).map((s) => clip(s, 80)).filter(Boolean);
  return {
    key: list(x.key, KEY_LINES).map((s) => scrub(clip(s, LINE_CHARS), hidden)).filter(Boolean),
    figures: list(x.figures, 12).filter((f) => f && f.name).map((f) => ({ name: clip(f.name, 80), kind: f.kind === "adv" ? "adv" : "cast", pic: picOk(f.pic || "") ? f.pic : "", credit: clip(f.credit, 200) })),
    hidden,
    wrap: scrub(clip(x.wrap, 1500), hidden),
  };
}

const str = { type: "string" };
export const RECAP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["beats", "hook"],
  properties: {
    beats: { type: "array", description: "4 to 6 beats of the finished story, in order", items: { type: "object", additionalProperties: false, required: ["line", "who"], properties: { line: str, who: { ...str, description: "a name from FIGURES this beat is about, exactly as written, or empty" } } } },
    hook: { ...str, description: "one line pointing at the new story" },
  },
};

const SYSTEM = `You write the "Previously on..." cold open of an ongoing Mothership (sci-fi horror TTRPG) campaign, like a TV recap: 4 to 6 beats from the story the crew just finished, in order, each ONE line (under 18 words, past tense, plain and punchy). A narrator reads them to the players, so use only what is in the material below: no invention, nothing the crew did not witness. Spoilers about what already happened are fine.
"who" is the one person from FIGURES the beat is about, spelled exactly as written, or "" for none. Names under NEVER NAME are still unseen by the players: call them ??? , never describe or picture them, never use them as "who".
"hook" is one line (under 25 words) that points at the NEW STORY from its hook, without spoiling it.`;

export function coldOpenRequest(c, last, story, p) {
  const snap = last.recap || {};
  const hidden = snap.hidden || [];
  const done = c.stories.find((s) => s.id === last.id);
  const parts = [
    `CAMPAIGN: ${c.title}`,
    `STORY JUST FINISHED: ${done?.title || last.id}`,
    last.outcome && `THE WARDEN'S OUTCOME NOTE: ${scrub(last.outcome, hidden)}`,
    snap.wrap && `ITS SYNOPSIS:\n${snap.wrap}`,
    snap.key?.length && `KEY LINES OF PLAY:\n${snap.key.join("\n")}`,
    `FIGURES: ${(snap.figures || []).map((f) => f.name).join(", ") || "none"}`,
    hidden.length && `NEVER NAME: ${hidden.join(", ")}`,
    `THE CREW (anyone marked DECEASED or RETIRED is gone; do not show them alive): ${crewWithFate(p.crew, (pc) => pc.name).join(", ")}`,
    `NEW STORY: ${story.title}. ${story.hook}`,
  ];
  return { system: SYSTEM, context: parts.filter(Boolean).join("\n\n"), messages: [{ role: "user", content: "Write the cold open." }], schema: RECAP_SCHEMA, example: { beats: [{ line: "The crew took the job.", who: "" }], hook: "A new contract." }, maxTokens: 900 };
}

// raw: the model's reply. Unknown or unseen "who" lose their picture; hidden names are scrubbed from every line.
export function normalizeColdOpen(raw, snap, story) {
  const hidden = snap?.hidden || [];
  const figures = snap?.figures || [];
  const beats = (Array.isArray(raw?.beats) ? raw.beats : []).slice(0, BEATS).map((b) => {
    const line = scrub(clip(b?.line, 160), hidden);
    const w = String(b?.who || "").trim().toLowerCase();
    const f = w && figures.find((x) => x.name.toLowerCase() === w);
    return { line, who: f ? f.name : /\?\?\?/.test(line) && w ? "???" : "", kind: f ? f.kind : "", pic: f ? f.pic : "", credit: f ? f.credit : "" };
  }).filter((b) => b.line);
  if (beats.length < 2) throw new Error("the recap came back too short");
  return { for: story.id, first: false, beats, hook: scrub(clip(raw?.hook, 220), hidden) || story.hook };
}

export const introRecap = (c, story) => ({ for: story.id, first: true, beats: [], hook: clip(c.tagline, 400) });

export function sanitizeColdOpen(x) {
  if (!x || typeof x !== "object" || !x.for) return null;
  const beats = (Array.isArray(x.beats) ? x.beats : []).slice(0, BEATS).map((b) => ({ line: clip(b?.line, 200), who: clip(b?.who, 80), kind: b?.kind === "adv" ? "adv" : b?.kind === "cast" ? "cast" : "", pic: picOk(b?.pic || "") ? b.pic : "", credit: clip(b?.credit, 200) })).filter((b) => b.line);
  return { for: String(x.for).slice(0, 60), first: !!x.first, beats, hook: clip(x.hook, 400) };
}
