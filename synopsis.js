// The Warden's synopsis: a briefing to read or hand to the players (who they
// are, where they are, what they know, what they're here to do), with sections
// for the Warden only (what's really going on, story beats, next steps). Before
// play it covers the setup; once the story has started it is brought up to date
// from the comms log, telling the players only what they have actually learned.
import { crewBrief, crewStatus } from "./crew.js";
import { terminalsBrief } from "./terminals.js";
import { voiceIdOf } from "./agent.js";

const LOG_ENTRIES = 200; // most recent log entries the synopsis reads
const ENTRY_CHARS = 600;

const SYSTEM = `You help the Warden (game master) of a Mothership (sci-fi horror TTRPG) session run through a station computer terminal: the players type to the station, and an AI voices the computer, announcements and the people on the intercom.

Write the Warden a SYNOPSIS of the story so far, in sections.

PLAYER SECTIONS (audience "players"): read aloud or shared with the players.
- Second person, to the crew ("You are...", "You know..."). Evocative but plain, a few short paragraphs at most per section.
- Cover, in this order: who they are (the crew, one line each, by name), where they are (the place and exactly where they are standing now), what they know about the station, and what they are expected to do (their job, and what must happen before they can leave).
- If play has started, add what has happened so far and where things stand now, from the COMMS LOG.
- Only what the players' characters actually know: the public lore, their own briefing, and what they have seen and heard in the comms log. NEVER reveal SECRETS, Warden notes, or anything they haven't learned. If they discovered a secret in play, they know it now.

WARDEN-ONLY SECTIONS (audience "warden"): for the Warden's eyes only.
- What is really going on (the truth behind what the players know), the important story beats still to come, the threads in play, and concrete next steps: what to push, who might reach out, what the players could try, and where each path leads (including what it takes to get home).
- Once play has started, say which beats have already happened, what the players have missed or misread, and where the characters and the threat are now.
- Terse and practical: short bullet lines ("- ..."). Don't copy SECRETS out wholesale: pick what matters for running the next part of the game, and say when and how each reveal should land.

Put each Warden-only section right after the player section it relates to, or at the end. 4-8 sections in all. Plain text, no markdown headings or bold.`;

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
      example: { sections: [{ heading: "Who you are", audience: "players", text: "..." }, { heading: "What's really going on", audience: "warden", text: "- ..." }] },
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
