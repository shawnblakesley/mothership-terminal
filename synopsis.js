// The Warden's synopsis: a punchy, bulleted briefing to read or hand to the
// players (who they are, where they are, what they know, their job, their next
// goals), with sections for the Warden only (what's really going on, and the
// next obstacles to throw at them). Before play it covers the setup; once the
// story has started it is brought up to date from the comms log, telling the
// players only what they have actually learned.
import { crewBrief, crewStatus } from "./crew.js";
import { terminalsBrief } from "./terminals.js";
import { voiceIdOf } from "./agent.js";

const LOG_ENTRIES = 200; // most recent log entries the synopsis reads
const ENTRY_CHARS = 600;

const SYSTEM = `You help the Warden (game master) of a Mothership (sci-fi horror TTRPG) session run through a station computer terminal: the players type to the station, and an AI voices the computer, announcements and the people on the intercom.

Write the Warden a SYNOPSIS: a punchy briefing, not prose. Every section is short bullet lines ("- ..."), each under ~20 words. No paragraphs, no scene-setting flourishes, no repeating yourself between sections.

Use exactly these sections, in this order, with these headings:

PLAYER SECTIONS (audience "players"): read aloud or shared with the players. Second person ("You...").
1. "Who you are": one bullet per crew member: name, role, one telling detail.
2. "Where you are": 1-2 bullets: the place, and exactly where they are standing now.
3. "What you know": 3-6 bullets of the facts that matter.
4. "Your job": 1-3 bullets: what they were sent to do, and what must happen before they can leave.
5. "So far": ONLY if play has started: 3-6 bullets of what has happened, from the COMMS LOG, most important first.
6. "Next goals": 2-4 bullets: concrete things the crew could do next, from what they know (a place to reach, a person to find, a system to fix). Actionable, not hints at secrets.

Player sections hold only what the characters actually know: the public lore, their briefing, and what they have seen and heard in the comms log. NEVER reveal SECRETS, Warden notes, or anything they haven't learned. If they discovered a secret in play, they know it now.

WARDEN-ONLY SECTIONS (audience "warden"): for the Warden's eyes only.
7. "What's really going on": 3-6 bullets: the truth that matters for the next stretch of play (not SECRETS copied out). Once play has started, also which beats have landed, what the players have missed or misread, and where the characters and the threat are now.
8. "Next obstacles": 3-5 bullets, each one obstacle the Warden can throw at the players next, written as "obstacle → how it shows up → ways through (a fitting Stat or Save to roll, if any)". Tie them to the players' next goals and where they are; escalate the horror.

Plain text, no markdown headings or bold.`;

const str = { type: "string" };
export const SYNOPSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sections"],
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "audience", "text"],
        properties: { heading: str, audience: { type: "string", enum: ["players", "warden"] }, text: str },
      },
    },
  },
};

const clip = (s) => { const t = String(s ?? ""); return t.length > ENTRY_CHARS ? `${t.slice(0, ENTRY_CHARS)}…` : t; };

// The log as the Warden saw it: who said what, the Warden's commands and notes.
function logLine(e, voices) {
  const vars = (e.variants || []).map((v) => `\n    (only ${v.for} sees: ${clip(v.text)})`).join("");
  switch (e.kind) {
    case "player": return `[PLAYER${e.by ? ` · ${e.by}` : ""}${e.at ? ` · at ${e.at}` : ""}] ${clip(e.text)}`;
    case "roll": return `[ROLL] ${clip(e.text).replace(/\n/g, " · ")}`;
    case "warden": return `[WARDEN COMMAND, private] ${clip(e.text)}`;
    case "aside": return `[WARDEN NOTE, private] ${clip(e.text)}`;
    case "aside_reply": return `[AGENT TO WARDEN, private] ${clip(e.text)}`;
    case "note": return `[CONSOLE NOTE, private] ${clip(e.text)}`;
    default: {
      const voice = voices.find((v) => v.id === voiceIdOf(e))?.name || e.entity || e.kind;
      const who = [voice, e.character].filter(Boolean).join(" · ").toUpperCase();
      return `[${who}${e.inPerson ? ", in person" : ""}] ${clip(e.text)}${vars}`;
    }
  }
}

export function synopsisRequest(state, screens = []) {
  const c = state.config;
  const log = state.log.filter((e) => !e.cut && (e.text || e.variants?.length));
  // Started = something has been typed or said at the terminal (not just Warden notes).
  const started = log.some((e) => e.kind === "player" || ["terminal", "system", "entity"].includes(e.kind));
  const cast = c.voices.flatMap((v) => (v.characters || []).map((ch) => `- ${ch.name} (via ${v.name})${ch.notes ? `: ${ch.notes}` : ""}`));
  const where = screens.map((s) => `- ${s.character || "a screen with no crew file"}: ${c.terminals.find((t) => t.id === s.terminal)?.name || s.terminal}`);
  const context = [
    `STATION NAME: ${c.stationName}`,
    `STATION LORE (public):\n${c.lore || "(none)"}`,
    `SECRETS (Warden only):\n${c.secrets || "(none)"}`,
    c.standingOrders?.trim() ? `WARDEN STANDING ORDERS:\n${c.standingOrders.trim()}` : "",
    `MAP:\n${c.map || "(none)"}`,
    `LIVE STATION STATE (JSON):\n${JSON.stringify(state.station)}`,
    c.crew?.length ? `THE PLAYERS' CHARACTERS:\n${crewBrief(c.crew)}\n\nCONDITION NOW:\n${crewStatus(c.crew)}` : "THE PLAYERS' CHARACTERS: (none set up)",
    cast.length ? `CAST (people who can speak):\n${cast.join("\n")}` : "",
    c.terminals?.length ? `TERMINALS:\n${terminalsBrief(c.terminals)}${where.length ? `\n\nWHERE THE PLAYERS ARE NOW:\n${where.join("\n")}` : ""}` : "",
  ].filter(Boolean).join("\n\n");
  const ask = started
    ? `COMMS LOG (oldest first; private lines were never seen by the players):\n${log.slice(-LOG_ENTRIES).map((e) => logLine(e, c.voices)).join("\n")}\n\nThe story is under way. Write the synopsis as of NOW.`
    : "The story hasn't started yet: nothing has been said at the terminal. Write the starting synopsis.";
  return {
    started,
    request: {
      system: SYSTEM, context, messages: [{ role: "user", content: ask }], schema: SYNOPSIS_SCHEMA,
      example: { sections: [{ heading: "Who you are", audience: "players", text: "- ...\n- ..." }, { heading: "Next goals", audience: "players", text: "- ..." }, { heading: "Next obstacles", audience: "warden", text: "- ... → ... → ..." }] },
    },
  };
}

export function normalizeSynopsis(raw) {
  const sections = (Array.isArray(raw?.sections) ? raw.sections : [])
    .filter((x) => x && String(x.text ?? "").trim())
    .slice(0, 12)
    .map((x) => ({ heading: String(x.heading ?? "").slice(0, 120), audience: x.audience === "warden" ? "warden" : "players", text: String(x.text).trim().slice(0, 6000) }));
  if (!sections.length) throw new Error("The model returned an empty synopsis. Try again.");
  return sections;
}
