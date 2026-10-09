import { crewBrief, crewStatus } from "./crew.js";
import { terminalsBrief, screensBrief } from "./terminals.js";
import { voiceIdOf, playerTag } from "./agent.js";
import { attitudeLabel } from "./cast.js";

const LOG_ENTRIES = 200;
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
const SYNOPSIS_SCHEMA = {
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

export function logLine(e, voices) {
  const vars = (e.variants || []).map((v) => `\n    (only ${v.for} sees: ${clip(v.text)})`).join("");
  switch (e.kind) {
    case "player": return `${playerTag(e)} ${clip(e.text)}`;
    case "roll": return `[ROLL] ${clip(e.text).replace(/\n/g, " · ")}`;
    case "warden": return `[WARDEN COMMAND, private] ${clip(e.text)}`;
    case "aside": return `[WARDEN NOTE, private] ${clip(e.text)}`;
    case "heard": return `[WARDEN, said aloud at the table] ${clip(e.text)}`;
    case "table": return `[${e.playing ? `${e.playing}'S PLAYER` : "PLAYER"} ${e.speaker || ""}, said aloud at the table (table talk, not in the fiction)] ${clip(e.text)}`;
    case "aside_reply": return `[AGENT TO WARDEN, private] ${clip(e.text)}`;
    case "note": return `[CONSOLE NOTE, private] ${clip(e.text)}`;
    default: {
      const voice = voices.find((v) => v.id === voiceIdOf(e))?.name || e.entity || e.kind;
      const who = [voice, e.character].filter(Boolean).join(" · ").toUpperCase();
      return `[${who}${e.inPerson ? ", in person" : ""}] ${clip(e.text)}${vars}`;
    }
  }
}

export const SYNOPSIS_KINDS = ["prebrief", "sofar", "wrapup"];

const WRAPUP = `You help the Warden (game master) of a Mothership (sci-fi horror TTRPG) one-shot that has just ENDED. Write the WRAP-UP to read to the players or hand them as they go: the story they just played, and what became of each of them afterwards. It's over, so spoilers are fine: the truth can come out.

Use exactly these sections, in this order, with these headings (audience "players" for both):
1. "What happened": a blurb of 2 short paragraphs (~150 words in all), past tense, told like the back of a paperback: the story as it played out, from the COMMS LOG, with what was really going on behind it (from SECRETS), including what they never found out.
2. "Afterwards": one entry per crew member, each starting with their name and a colon, 2-4 sentences: their long-term fate after the mission, months or years on. Ground it in how they left the story (alive or dead, their Health, Wounds and Stress, what they did and chose in play) and who they are (backstory, crime, trinket, patch). Mothership's tone: grim, wry, sometimes bittersweet; a happy ending has to be earned. The dead get how they were remembered, or what happened to what they left behind. Blank line between entries.

Plain text, no markdown, no bullet points.`;

export function synopsisRequest(state, screens = [], kind = "sofar") {
  if (kind === "prebrief" && state.storyStart?.config) {
    state = { ...state, config: { ...state.config, ...state.storyStart.config }, station: state.storyStart.station ?? state.station };
    screens = [];
  }
  const c = state.config;
  const log = kind === "prebrief" ? [] : shownLog(state);
  const started = log.some((e) => e.kind === "player" || ["terminal", "system", "entity"].includes(e.kind));
  const feels = (m) => attitudeLabel(m.attitude).toLowerCase();
  const cast = (c.cast || []).map((m) => `- ${m.name} (${m.room ? `in ${m.room}` : "nowhere on the map"}; ${feels(m)} towards the players${m.why ? `, because ${m.why}` : ""})${m.notes ? `: ${m.notes}` : ""}`);
  const where = screensBrief(screens, c.terminals);
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
  const comms = `COMMS LOG (oldest first; private lines were never seen by the players):\n${logText(log, c.voices)}`;
  if (kind === "wrapup") {
    return {
      started,
      request: {
        system: WRAPUP, context, schema: SYNOPSIS_SCHEMA,
        messages: [{ role: "user", content: started ? `${comms}\n\nThe one-shot is over. Write the wrap-up.` : "The story never got going: nothing was said at the terminal. Write a short wrap-up anyway, from the setup: what was waiting for them, and where the crew went instead." }],
        example: { sections: [{ heading: "What happened", audience: "players", text: "..." }, { heading: "Afterwards", audience: "players", text: "NAME: ...\n\nNAME: ..." }] },
      },
    };
  }
  const ask = started
    ? `${comms}\n\nThe story is under way. Write the synopsis as of NOW.`
    : "The story hasn't started yet: nothing has been said at the terminal. Write the starting synopsis.";
  return {
    started,
    request: {
      system: SYSTEM, context, messages: [{ role: "user", content: ask }], schema: SYNOPSIS_SCHEMA,
      example: { sections: [{ heading: "Who you are", audience: "players", text: "- ...\n- ..." }, { heading: "Next goals", audience: "players", text: "- ..." }, { heading: "Next obstacles", audience: "warden", text: "- ... → ... → ..." }] },
    },
  };
}

const RECAP = `A Mothership (sci-fi horror TTRPG) story the players were playing has just ENDED. Write them a short recap to read on the END screen: it's over, so spoilers are fine now and the truth can come out.

- verdict: one line naming how it ended, like a closing title (e.g. "Three made it off KESTREL-9. One didn't.").
- sections, in this order, each short bullet lines ("- ...", each under ~20 words):
  1. "What happened": 4-8 bullets, the story as it played out, from the COMMS LOG.
  2. "The truth": 2-5 bullets of what was really going on (from SECRETS), including what they never found out.
  3. "The crew": one bullet per character: their fate (made it out, died, lost their mind, left behind...) and one moment that defined them.
Plain text, no markdown.`;

const RECAP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "sections"],
  properties: {
    verdict: str,
    sections: { type: "array", items: { type: "object", additionalProperties: false, required: ["heading", "text"], properties: { heading: str, text: str } } },
  },
};

const EARNED = `FACTION STAKES: the numbered stakes below are standing changes a faction would give the crew IF the condition clearly happened in this story. In "earned", list the numbers of only the stakes the COMMS LOG clearly shows were earned. Be conservative: when in doubt, leave it out. Two stakes that contradict each other cannot both be earned. [] if none.`;
const DELIVERED = `THE JOB: judge from the COMMS LOG whether the crew did it. "delivery": "full" if the job was done in full, "partly" if only part of it was, "none" if it was not done. "late": true only if the job is one where late delivery voids the fee AND the log shows it arrived late. Be conservative.`;

export function recapRequest(state, how, campaign = null) {
  const stakes = campaign?.stakes || [];
  const c = state.config;
  const log = shownLog(state);
  const context = [
    `STATION NAME: ${c.stationName}`,
    `STATION LORE:\n${c.lore || "(none)"}`,
    `SECRETS:\n${c.secrets || "(none)"}`,
    c.crew?.length ? `THE PLAYERS' CHARACTERS:\n${crewBrief(c.crew)}\n\nCONDITION AT THE END:\n${crewStatus(c.crew)}` : "",
  ].filter(Boolean).join("\n\n");
  return {
    system: campaign ? `${RECAP}\n\n${EARNED}\n\n${DELIVERED}` : RECAP,
    context,
    messages: [{ role: "user", content: `COMMS LOG (oldest first):\n${logText(log, c.voices)}\n\nHOW IT ENDED: ${how || "(the players called it a night)"}${campaign ? `\n\nTHE JOB: ${campaign.job}${campaign.late ? " (late delivery voids the fee)" : ""}\n\nFACTION STAKES:\n${stakes.length ? "" : "(none)\n"}${stakes.map((a, i) => `${i}. ${a.name} ${a.change > 0 ? "up" : "down"} ${Math.abs(a.change)} if: ${a.when}`).join("\n")}` : ""}\n\nWrite the recap.` }],
    schema: campaign ? { ...RECAP_SCHEMA, required: [...RECAP_SCHEMA.required, "earned", "delivery", "late"], properties: { ...RECAP_SCHEMA.properties, earned: { type: "array", items: { type: "integer" } }, delivery: { type: "string", enum: ["full", "partly", "none"] }, late: { type: "boolean" } } } : RECAP_SCHEMA,
    example: { verdict: "...", sections: [{ heading: "What happened", text: "- ..." }, { heading: "The truth", text: "- ..." }, { heading: "The crew", text: "- ..." }], ...(campaign ? { earned: [], delivery: "full", late: false } : {}) },
  };
}

const sectionsOf = (raw, max) => (Array.isArray(raw?.sections) ? raw.sections : []).filter((x) => x && String(x.text ?? "").trim()).slice(0, max);

export function normalizeRecap(raw) {
  const sections = sectionsOf(raw, 6).map((x) => ({ heading: String(x.heading ?? "").slice(0, 80), text: String(x.text).trim().slice(0, 4000) }));
  if (!sections.length) throw new Error("the recap came back empty");
  return { verdict: String(raw?.verdict ?? "").trim().slice(0, 200), sections };
}

export function normalizeSynopsis(raw) {
  const sections = sectionsOf(raw, 12).map((x) => ({ heading: String(x.heading ?? "").slice(0, 120), audience: x.audience === "warden" ? "warden" : "players", text: String(x.text).trim().slice(0, 6000) }));
  if (!sections.length) throw new Error("The model returned an empty synopsis. Try again.");
  return sections;
}

function shownLog(state) { return state.log.filter((e) => !e.cut && (e.text || e.variants?.length)); }
function logText(log, voices) { return log.slice(-LOG_ENTRIES).map((e) => logLine(e, voices)).join("\n"); }
