import { crewBrief } from "./crew.js";
import { logLine } from "./synopsis.js";
import { docTitle, docText } from "./roomdocs.js";

const RECENT = 40;

const SYSTEM = `You write in-world documents ("handouts") for the Warden (game master) of a Mothership (sci-fi horror TTRPG) session. The players will read them on their terminals as things their characters found or pulled from the system: a medical journal, a work order, a security log, a memo, a diary, a manifest, a chat transcript.

Write the document the Warden's BRIEF describes, as it exists in the world:
- In its author's voice and the form that kind of document takes: dated or time-stamped entries for a log or journal, headers for a memo or report, terse fields for a manifest.
- Write it in Markdown, used the way the document itself would: # headings for a memo or report title, **bold** for stamps and warnings, *italic*, __underlined__ for words the author underlined (in this app __text__ means underline), ~~crossed out~~ for words they struck through, - lists, > quoted messages, --- between entries. Don't overdo it.
- Brief: under 200 words, unless the brief asks for more. Concrete names, times, places and numbers from the story; every line earns its place.
- Make the clues the brief asks for CLEAR. Players skim and need hints they can't miss: put each one plainly in the text (a symptom named, a time that doesn't add up, a line the author underlines or repeats, an order nobody should give). Never be too subtle. It's still the author's own words, not the narrator explaining, and the whole secret needn't be spelled out unless the brief says so; but a player who reads it once should come away suspecting the right thing.
- Stay true to the story: the lore, the SECRETS (what's really going on), the cast and what has happened so far. Never contradict them, and don't reveal more of the secrets than the brief wants.
- title: what the document is called on screen, caps-friendly (e.g. MEDICAL LOG: DR. I. SALK).`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "text"],
  properties: { title: { type: "string" }, text: { type: "string" } },
};

const AUDIO = `\n\nTHIS ONE IS AN AUDIO RECORDING (an audio log, a voicemail, a black box), not a written document. The players will hear it spoken in SPEAKER's voice and read along. text is exactly what's said: plain words, one sentence (or broken-off fragment) per line, in SPEAKER's own voice and state of mind. No Markdown, no stage directions or [bracketed] cues (they would be read out); let what's said carry it: hesitations, a sentence cut off, a time-stamp spoken aloud. If several people speak (a conversation, a call), start each speaker's line with their name in CAPITALS and a colon (OKONKWO: ...); lines without a name are the last speaker's; someone not in the cast by what they're called (HOLLIS-VANE: ...). Under 120 words. title: what the recording is called on screen (e.g. AUDIO LOG: DR. I. SALK, DAY 19).`;

const soundsNote = (sounds = []) => (sounds.length
  ? `\n\nSOUND EFFECTS: you may put a sound in the recording, on a line of its own, as [SOUND: name], using one of these names exactly: ${sounds.map((s) => `${s.name} (${Math.round(s.seconds || 0)}s)`).join(", ")}. This is the one kind of bracketed line allowed. It starts as the next spoken line starts and plays under it (there is no pause for it), so put it right before the line it goes with; at the very end it plays out after the last words. Use at most two, only where a sound tells part of the story.`
  : "");

export function handoutRequest(state, brief, title = "", speaker = "") {
  const c = state.config;
  const cast = c.voices.flatMap((v) => (v.characters || []).map((ch) => `- ${ch.name} (via ${v.name})${ch.notes ? `: ${ch.notes}` : ""}`));
  const log = state.log.filter((e) => !e.cut && e.text && !["note"].includes(e.kind)).slice(-RECENT);
  const context = [
    `STATION NAME: ${c.stationName}`,
    `LORE (public):\n${c.lore || "(none)"}`,
    `SECRETS (what's really going on):\n${c.secrets || "(none)"}`,
    cast.length ? `CAST:\n${cast.join("\n")}` : "",
    c.crew?.length ? `THE PLAYERS' CHARACTERS:\n${crewBrief(c.crew)}` : "",
    log.length ? `WHAT HAS HAPPENED LATELY (the comms log, oldest first):\n${log.map((e) => logLine(e, c.voices)).join("\n")}` : "The story hasn't started yet.",
  ].filter(Boolean).join("\n\n");
  return {
    system: SYSTEM + (speaker ? AUDIO + soundsNote(state.sounds) : ""),
    context,
    messages: [{ role: "user", content: `BRIEF: ${brief}${title ? `\nTITLE (keep it, or refine it): ${title}` : ""}${speaker ? `\nSPEAKER: ${speaker}` : ""}\n\nWrite the ${speaker ? "recording" : "document"}.` }],
    schema: SCHEMA,
    example: { title: "MEDICAL LOG: DR. I. SALK", text: "DAY 14 / 06:10\n..." },
  };
}

export function normalizeHandout(r) {
  const title = docTitle(r?.title);
  const text = docText(r?.text);
  if (!title || !text) throw new Error("the document came back empty");
  return { title, text };
}
