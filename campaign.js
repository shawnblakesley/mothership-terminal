import { RIM_HAULERS } from "./campaigns/rim-haulers.js";
import { APP_BRIEF, DRAFT_SCHEMA, SPEAKER_LIST } from "./builder.js";
import { sanitizeCrew } from "./crew.js";
import { sanitizeCast, findCast, PORTRAIT_FILE } from "./cast.js";
import { SPEAKERS, fromPreset } from "./voices.js";

export const CAMPAIGNS = [RIM_HAULERS];
export const campaignById = (id) => CAMPAIGNS.find((c) => c.id === id) || null;

export const ACTS = [
  ["transgression", "Transgression"],
  ["omens", "Omens"],
  ["manifestation", "Manifestation"],
  ["banishment", "Banishment"],
  ["slumber", "Slumber"],
];

const loc = (c, id) => c.locations.find((l) => l.id === id);
export const isTransit = (story) => !story.at;
export const placeOf = (c, story) => (story.at ? loc(c, story.at).name : `${loc(c, story.from).name} to ${loc(c, story.to).name}`);
export const endsAt = (story) => story.at || story.to;

export function newProgress(c) {
  return { id: c.id, startedAt: Date.now(), at: c.start, current: "", done: [], crew: sanitizeCrew(structuredClone(c.crew)), cast: {} };
}

export function sanitizeProgress(p) {
  const c = campaignById(p?.id);
  if (!c) return null;
  const has = (id) => c.stories.some((s) => s.id === id);
  const cast = {};
  for (const m of c.cast) {
    const x = p.cast?.[m.id];
    if (!x || typeof x !== "object") continue;
    cast[m.id] = {
      attitude: Math.max(-3, Math.min(3, Math.round(Number(x.attitude) || 0))),
      why: String(x.why || "").slice(0, 160),
      portrait: PORTRAIT_FILE.test(x.portrait || "") ? x.portrait : "",
      history: String(x.history || "").slice(-600),
    };
  }
  return {
    id: c.id,
    startedAt: Number(p.startedAt) || Date.now(),
    at: loc(c, p.at) ? p.at : c.start,
    current: has(p.current) ? p.current : "",
    done: (Array.isArray(p.done) ? p.done : []).filter((d) => has(d?.id)).map((d) => ({ id: d.id, outcome: String(d.outcome || "").slice(0, 1500), at: Number(d.at) || 0 })).slice(-100),
    crew: sanitizeCrew(Array.isArray(p.crew) && p.crew.length ? p.crew : structuredClone(c.crew)),
    cast,
  };
}

const castById = (c, id) => c.cast.find((m) => m.id === id);
const recurringNamed = (c, name) => c.cast.find((m) => findCast([{ id: m.id, name: m.name }], name));
// The campaign's recurring characters in a built story: the ones it lists, and any the agent brought in.
const presentIn = (c, config) => c.cast.filter((m) => config.cast.some((x) => x.name === m.name));
const castNotes = (m, p) => [m.notes, p.cast[m.id]?.history && `Earlier in the campaign: ${p.cast[m.id].history}`].filter(Boolean).join(" ");

function storyBible(c, story) {
  const a = story.adversary;
  return [
    `STORY ${story.n}: ${story.title} (${isTransit(story) ? `in transit, ${placeOf(c, story)}, on ${c.ship.name}` : `at ${placeOf(c, story)}`})`,
    `HOOK: ${story.hook}`,
    `THE JOB: ${story.job}`,
    `EVENT: ${story.event}. HORROR: ${story.horror}.`,
    `ADVERSARY (added automatically, don't write it as a voice or cast member): ${a.name}, ${a.type}. ${a.persona}`,
    `THE ARC (Warden's Operations Manual: Transgression, Omens, Manifestation, Banishment, Slumber):`,
    ...ACTS.map(([k, label]) => `- ${label.toUpperCase()}: ${story.acts[k]}`),
    `SECRETS (added automatically; build on them, don't repeat them):`,
    ...story.secrets.map((x) => `- ${x}`),
    `FACTIONS INVOLVED: ${story.factions.map((f) => c.factions.find((x) => x.id === f)?.name).filter(Boolean).join(", ")}.`,
    story.hazards?.length ? `HAZARDS: ${story.hazards.join(", ")}.` : "",
  ].filter(Boolean).join("\n");
}

function campaignContext(c, story, p) {
  const place = story.at ? loc(c, story.at) : null;
  const cast = story.cast.map((id) => castById(c, id)).filter(Boolean);
  const lines = [
    `CAMPAIGN: ${c.title}. ${c.pitch}`,
    `THE CREW'S RIG: ${c.ship.name}. ${c.ship.description}`,
    `THE PLAYERS' CHARACTERS (fixed; don't write them): ${p.crew.map((pc) => `${pc.name} (${pc.className}, ${pc.role})`).join("; ")}.`,
    `FACTIONS OF THE RIM:\n${c.factions.map((f) => `- ${f.name}: ${f.about}`).join("\n")}`,
    place
      ? `WHERE: ${place.name}, ${place.kind}. ${place.description}\nIts computer is ${place.computer}. ${c.ship.name} is docked at ${place.dock} (added automatically, with its own terminal and its computer MARY on its own system).`
      : `WHERE: aboard ${c.ship.name}, on the lane from ${loc(c, story.from).name} to ${loc(c, story.to).name}. The rig itself is the "station": its computer is MARY (persona below, fixed), and its terminals are fixed.\nMARY: ${c.ship.persona}`,
    `THE MAP (fixed; use exactly these room ids in station paths, cast rooms and terminal rooms):\n${mapFor(c, story)}`,
    `OTHER RECURRING CHARACTERS of the campaign (only if the story needs them, by these exact names; they keep their own voices): ${c.cast.filter((m) => !story.cast.includes(m.id)).map((m) => m.name).join(", ")}.`,
    cast.length ? `RECURRING CHARACTERS in this story (added automatically with their own voices; don't write them in cast, but use them in lore, secrets and personas):\n${cast.map((m) => `- ${m.name}: ${castNotes(m, p)}`).join("\n")}` : "",
    p.done.length ? `THE CAMPAIGN SO FAR (keep it consistent; consequences carry over):\n${p.done.map((d) => { const s = c.stories.find((x) => x.id === d.id); return `- ${s.title} (${placeOf(c, s)}): ${d.outcome || "played"}`; }).join("\n")}` : "This is the first story the crew play.",
  ];
  return lines.filter(Boolean).join("\n\n");
}

export function mapFor(c, story) {
  if (isTransit(story)) return [c.ship.map, story.places].filter(Boolean).join("\n");
  const place = loc(c, story.at);
  return [place.map, `Docked: ${c.ship.room}=${c.ship.name} @ ${place.dock}`, story.places].filter(Boolean).join("\n");
}

const FIELDS = ["lore", "secrets", "standingOrders", "station", "computer", "broadcastPersona", "voices", "cast", "terminals", "documents"];
const SCHEMA = { ...DRAFT_SCHEMA, required: FIELDS, properties: Object.fromEntries(FIELDS.map((k) => [k, DRAFT_SCHEMA.properties[k]])) };

export function buildRequest(c, story, p) {
  const transit = isTransit(story);
  const taken = story.cast.map((id) => castById(c, id)?.voice).filter(Boolean);
  const system = `You are preparing one story of an ongoing Mothership campaign, ready to play tonight.

${APP_BRIEF}

The story's arc, adversary, setting, map and recurring characters are written (below). Write everything else the app needs to run it, faithful to them: concrete, evocative, usable at the table. Blue-collar space trucking: union slang, CB radio, bills of lading, customs forms, debt; and then the horror.

FIELDS
- lore: what ${transit ? "MARY" : "the station's computer"} holds as public knowledge, as short labelled lines: the place, the job (from THE JOB), who's here, recent events as the public knows them (never the truth), and the factions' presence.
- secrets: bullet lines ("- ...") the computer guards by access level. The written secrets are already included word for word: write ONLY new bullets, never restate or reword them: codes and passwords the arc needs, where things are, who is lying, what the computer itself was told to hide. Keep the Banishment options findable.
- standingOrders: short extra steering for this story's tone and pacing, or "". The arc is added automatically.
- station: the live state as path/value pairs (15-35). access_level=GUEST. Paths: doors.<room_id>, cameras.<room_id>, occupants.<room_id>, contents.<room_id>, lights.deck_N, plus systems of your own (power.*, life_support.*, comms...).${transit ? " Start from the rig's usual state (fuel.pct, air.reserve_hours, reactor, drive, container.seal, container.temp_c, cb_radio, nav.eta_hours) and change what this story changes." : ` Include ${c.ship.room}.docked=${loc(c, story.at).dock.toUpperCase()}.`}
- computer: ${transit ? `name "MARY". persona: ONLY what is different about MARY on this trip (what she knows, what's wrong with her, what she's been told), under 80 words, addressed to her ("You ..."). Her usual persona is added automatically.` : `name "${loc(c, story.at).computer}" and its persona, addressed to it ("You are ..."): who it is, how it writes on a monochrome CRT, what it knows, how it treats access levels and hacking, and how this story has touched it.`}
- broadcastPersona: the automated public-address voice${transit ? " (MARY's cabin alerts and proximity alarms)" : ""}; announces, never converses.
- voices: always one with id "intercom": ${transit ? `the rig's CB radio (name "CB RADIO", preset intercom), which everyone off the rig is heard over: dispatch, other drivers, customs hails, whoever is out there; systems [].` : `the station intercom (name "INTERCOM", preset intercom), which also carries radio patched through from ${c.ship.name}'s CB; systems ["ALL"].`} Add others only if the story needs them (another ship's computer, a radio band). Never MARY, the adversary, or the recurring characters.
- cast: this story's own named people (2-7), never the recurring characters. Each with sex, a distinct speaker voice (never ${taken.length ? taken.join(", ") : "one already used"}, af_bella or each other's), room (a map room id, or "" for nowhere on the map: off-${transit ? "rig" : "station"}, missing, hiding) and notes.
- terminals: ${transit ? `0-2 terminals, only in rooms the story adds to the map (a derelict, a boarding ship). The rig's own terminals are fixed. [] if none.` : `3-5 terminals in the station's rooms (never in ${c.ship.room}: the rig's terminal is added automatically), each with a look, whether the crew can reach it at the start, and notes. system "" and os "".`} Make the looks tell the story.
- documents: 1-2 starting documents the crew carry: the job's paperwork (bill of lading, work order, manifest, customs declaration, union dispatch slip) with the job's details, codes and names they'll need. Markdown, under 200 words each, in the voice of whoever issued it. Never the secrets.

LENGTH: lore and secrets under ~200 words each; personas under ~150 words; cast notes under ~40 words.`;
  return {
    system: `${system}\n\n${SPEAKER_LIST}`,
    context: campaignContext(c, story, p),
    messages: [{ role: "user", content: `${storyBible(c, story)}\n\nWrite the story now.` }],
    schema: SCHEMA,
    example: null,
    maxTokens: 12000,
  };
}

function arcOrders(c, story) {
  const a = story.adversary;
  return [
    `CAMPAIGN STORY ${story.n} of ${c.stories.length}: ${story.title}. ${story.event}; ${story.horror}.`,
    `THE ARC. Pace the story through these acts in order; let the players' choices move it on, never skip ahead of what they've earned:`,
    ...ACTS.map(([k, label], i) => `${i + 1}. ${label.toUpperCase()}: ${story.acts[k]}`),
    `THE ADVERSARY is ${a.name} (${a.type}). Keep it unseen through the Omens; it shows itself in the Manifestation.`,
    `When the Banishment is done or the crew escape or die, play the Slumber as the closing scene and leave its hooks for later stories.`,
  ].join("\n");
}

// The full Story Builder draft for a campaign story: the agent's part, with the campaign's fixed pieces put in.
export function composeDraft(c, story, p, raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  const transit = isTransit(story);
  const place = story.at ? loc(c, story.at) : null;
  const recurring = story.cast.map((id) => castById(c, id)).filter(Boolean);
  const blocked = new Set([story.adversary.name.toLowerCase(), "mary"]);
  const notMine = (name) => !blocked.has(String(name || "").toLowerCase()) && !recurringNamed(c, name);
  const borrowed = (Array.isArray(d.cast) ? d.cast : []).map((x) => x && { x, m: recurringNamed(c, x.name) }).filter((y) => y?.m && !recurring.includes(y.m));
  const station = transit ? Object.entries(c.ship.station).map(([path, value]) => ({ path, value })) : [];
  for (const x of Array.isArray(d.station) ? d.station : []) {
    const at = station.findIndex((y) => y.path === x?.path);
    if (at >= 0) station[at] = x;
    else station.push(x);
  }
  const shipVoice = { id: "mary", name: "MARY", preset: "human", color: "#7fe0ff", persona: c.ship.persona, systems: [c.ship.system] };
  const voices = (Array.isArray(d.voices) ? d.voices : []).filter((v) => v && !/^mary$/i.test(v.id || "") && notMine(v.name));
  const cast = [
    ...recurring.map((m) => ({ name: m.name, sex: m.sex, voice: m.voice, room: story.rooms?.[m.id] ?? (place && m.home === place.id ? m.room : ""), notes: castNotes(m, p) })),
    ...borrowed.map(({ x, m }) => ({ name: m.name, sex: m.sex, voice: m.voice, room: x.room, notes: castNotes(m, p) })),
    ...(Array.isArray(d.cast) ? d.cast : []).filter((x) => x && notMine(x.name)),
  ];
  const shipTerminal = { name: `${c.ship.name} CAB`, room: c.ship.room, look: [], theme: "cyan", open: true, system: c.ship.system, os: c.ship.os,
    notes: `Aboard ${c.ship.name}, docked at ${place?.name}. The crew start here. Its own system: MARY (the rig's computer) answers here, not the station's computer. The station intercom reaches it through the CB.` };
  const aiTerminals = (Array.isArray(d.terminals) ? d.terminals : []).filter((t) => t && roomOf(t) !== c.ship.room && (!transit || !/^(cab|engine_room|cargo_spine)$/.test(roomOf(t))))
    .map((t) => (transit ? t : { ...t, system: "", os: "" }));
  const computer = transit
    ? { name: c.ship.computer, persona: [c.ship.persona, d.computer?.persona && `THIS TRIP:\n${d.computer.persona}`].filter(Boolean).join("\n\n") }
    : { name: place.computer, persona: d.computer?.persona || "" };
  return {
    title: story.title,
    pitch: story.hook,
    stationName: transit ? c.ship.name : place.name,
    theme: transit ? "cyan" : place.theme,
    lore: d.lore,
    secrets: [...story.secrets.map((x) => `- ${x}`), String(d.secrets || "").trim()].filter(Boolean).join("\n"),
    standingOrders: [arcOrders(c, story), String(d.standingOrders || "").trim()].filter(Boolean).join("\n\n"),
    station,
    map: mapFor(c, story),
    computer,
    broadcastPersona: d.broadcastPersona,
    voices: transit ? voices : [...voices, shipVoice],
    adversaries: [{ name: story.adversary.name, persona: story.adversary.persona, preset: story.adversary.preset, ...(story.adversary.combat ? { combat: structuredClone(story.adversary.combat) } : {}) }],
    cast,
    documents: d.documents,
    terminals: transit ? [...c.ship.terminals, ...aiTerminals] : [shipTerminal, ...aiTerminals],
    crew: [],
  };
}
const roomOf = (t) => String(t?.room || "").toLowerCase().replace(/[^a-z0-9_]/g, "");

// After the story is applied: the crew as they left the last story, the recurring characters as the crew left them, MARY's own voice.
export function carryInto(config, c, story, p) {
  config.crew = sanitizeCrew(structuredClone(p.crew));
  for (const m of presentIn(c, config)) {
    const member = config.cast.find((x) => x.name === m.name);
    const was = p.cast[m.id];
    if (!member || !was) continue;
    Object.assign(member, { attitude: was.attitude, why: was.why, portrait: was.portrait || member.portrait });
  }
  config.cast = sanitizeCast(config.cast);
  const mary = config.voices.find((v) => v.id === "mary" || (isTransit(story) && v.id === "terminal"));
  if (mary) Object.assign(mary, { ...fromPreset("human"), preset: "human" }, { voice: { ...fromPreset("human").voice, speaker: SPEAKERS.af_bella ? "af_bella" : fromPreset("human").voice.speaker } });
  const channel = config.voices.find((v) => v.id === config.castChannel);
  if (channel && !isTransit(story)) channel.systems = ["*"];
}

// When a story is finished: remember how it ended, where the rig is, the crew's sheets and how the recurring characters feel.
export function finishInto(p, c, config, outcome) {
  const story = c.stories.find((s) => s.id === p.current);
  if (!story) return null;
  p.done = [...p.done.filter((d) => d.id !== story.id), { id: story.id, outcome: String(outcome || "").trim().slice(0, 1500), at: Date.now() }];
  p.at = endsAt(story);
  p.current = "";
  if (config.crew?.length) p.crew = sanitizeCrew(structuredClone(config.crew));
  for (const m of presentIn(c, config)) {
    const member = config.cast.find((x) => x.name === m.name);
    if (!member) continue;
    const base = castNotes(m, p);
    const added = member.notes.startsWith(base) ? member.notes.slice(base.length).trim() : "";
    const history = [p.cast[m.id]?.history, added && `(${story.title}) ${added}`].filter(Boolean).join(" ");
    p.cast[m.id] = { attitude: member.attitude, why: member.why, portrait: member.portrait, history: history.slice(-600) };
  }
  return story;
}

export const campaignList = () => CAMPAIGNS;
