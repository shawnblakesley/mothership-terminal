import { RIM_HAULERS } from "./campaigns/rim-haulers.js";
import { APP_BRIEF, DRAFT_SCHEMA, SPEAKER_LIST } from "./builder.js";
import { sanitizeCrew, newCond } from "./crew.js";
import { HAZARDS } from "./hazards.js";
import { sanitizeCast, findCast, PORTRAIT_FILE } from "./cast.js";
import { SPEAKERS, fromPreset } from "./voices.js";
import { sanitizeResources, rigStation, resourcesFrom, fuelCost, portMult, PRICES, MRE_PACK, TANK, firearms, addMagazines } from "./resources.js";
import { weaponByName } from "./weapons.js";
import { sanitizeDowntime } from "./downtime.js";
import { sanitizeMoney, startingCredits, DEBT_PAYMENT, DEBT_EVERY, DELIVERY, finalFee, upfrontOf, duesOf, debtDue, book, spend, exact, debtLetter, DUES_PCT } from "./money.js";

export const CAMPAIGNS = [RIM_HAULERS];
export const campaignById = (id) => CAMPAIGNS.find((c) => c.id === id) || null;

export const ACTS = [
  ["transgression", "Transgression"],
  ["omens", "Omens"],
  ["manifestation", "Manifestation"],
  ["banishment", "Banishment"],
  ["slumber", "Slumber"],
];

// Faction standing is a campaign house rule (Mothership 1e has none): built only from [+]/[-], attitudes and prices.
export const STANDINGS = { "-3": "Enemy", "-2": "Hostile", "-1": "Wary", 0: "Neutral", 1: "Friendly", 2: "Trusted", 3: "Ally" };
export const standingLabel = (n) => STANDINGS[n] || "Neutral";
export const clampStanding = (n) => Math.max(-3, Math.min(3, Math.round(Number(n) || 0)));
export const socialAdvantage = (n) => (n >= 2 ? "advantage" : n <= -2 ? "disadvantage" : "none");
export const attitudeNudge = (n) => (n >= 2 ? 1 : n <= -2 ? -1 : 0);
// A multiplier on prices at that faction's ports; null when they won't trade.
export const priceMultiplier = (n) => (n <= -3 ? null : { "-2": 1.25, "-1": 1.1, 2: 0.9, 3: 0.8 }[n] ?? 1);

const loc = (c, id) => c.locations.find((l) => l.id === id);
export const isTransit = (story) => !story.at;
export const placeOf = (c, story) => (story.at ? loc(c, story.at).name : `${loc(c, story.from).name} to ${loc(c, story.to).name}`);
export const endsAt = (story) => story.at || story.to;

export function newProgress(c, rng) {
  const crew = sanitizeCrew(structuredClone(c.crew));
  const p = { id: c.id, startedAt: Date.now(), at: c.start, current: "", done: [], crew, cast: {}, sessions: 0, offered: [], factions: Object.fromEntries(c.factions.map((f) => [f.id, 0])), favours: {}, nudges: {}, resources: sanitizeResources(c.ship.resources, c.ship.resources), ...sanitizeMoney({}, c, crew), ...sanitizeDowntime({}, crew) };
  // Starting credits are 2d10x10 per character, rolled once here (PSG), and shown in the ledger.
  for (const pc of p.crew) {
    pc.base = { stats: { ...pc.stats }, saves: { ...pc.saves } };
    const r = startingCredits(rng);
    pc.credits = 0;
    book(p, pc.id, r.total, `starting credits, 2d10x10: (${r.dice[0]}+${r.dice[1]})x10`);
  }
  return p;
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
  const crew = sanitizeCrew(Array.isArray(p.crew) && p.crew.length ? p.crew : structuredClone(c.crew));
  return {
    id: c.id,
    startedAt: Number(p.startedAt) || Date.now(),
    at: loc(c, p.at) ? p.at : c.start,
    current: has(p.current) ? p.current : "",
    sessions: Math.max(0, Math.min(9999, Math.round(Number(p.sessions) || 0))),
    offered: [...new Set(Array.isArray(p.offered) ? p.offered : [])].filter(has).slice(0, 9),
    done: (Array.isArray(p.done) ? p.done : []).filter((d) => has(d?.id)).map((d) => ({ id: d.id, outcome: String(d.outcome || "").slice(0, 1500), at: Number(d.at) || 0 })).slice(-100),
    crew,
    cast,
    factions: Object.fromEntries(c.factions.map((f) => [f.id, clampStanding(p.factions?.[f.id])])),
    favours: Object.fromEntries(c.factions.filter((f) => p.favours?.[f.id]).map((f) => [f.id, true])),
    nudges: Object.fromEntries(c.cast.map((m) => [m.id, Math.max(-1, Math.min(1, Math.round(Number(p.nudges?.[m.id]) || 0)))]).filter(([, n]) => n)),
    resources: sanitizeResources(p.resources, c.ship.resources),
    ...sanitizeMoney(p, c, crew),
    ...sanitizeDowntime(p.downtime, crew),
  };
}

// Moves one faction's standing; returns the change, or null if it didn't move.
export function shiftStanding(p, c, id, delta, why = "") {
  const f = c.factions.find((x) => x.id === id);
  if (!f) return null;
  const from = clampStanding(p.factions?.[id]), to = clampStanding(from + (Number(delta) || 0));
  p.factions = { ...p.factions, [id]: to };
  return to === from ? null : { faction: id, name: f.name, from, to, why };
}

// Marks a faction's one favour this story as used (or not); returns whether it is now used.
export function toggleFavour(p, c, id) {
  if (!c.factions.some((f) => f.id === id)) return false;
  const used = !p.favours?.[id];
  p.favours = { ...p.favours };
  if (used) p.favours[id] = true;
  else delete p.favours[id];
  return used;
}

// Prices at a port: its faction's standing applied to a base price; null when they won't trade.
export function priceAt(c, p, locId, base) {
  const m = priceMultiplier(clampStanding(p.factions?.[loc(c, locId)?.faction]));
  return m === null ? null : Math.round(base * m);
}

// What the standings do in a story, for the agent: [+]/[-] on social rolls, enemies, favours, prices, and the finale's help.
export function factionBrief(c, story, p) {
  const stand = (id) => clampStanding(p.factions?.[id]);
  const place = story.at ? loc(c, story.at) : null;
  const ids = [...new Set([...story.factions, place?.faction].filter(Boolean))];
  const lines = ids.map((id) => {
    const f = c.factions.find((x) => x.id === id), n = stand(id);
    if (!f) return "";
    const fx = [];
    if (n >= 2) fx.push(`[+] on the crew's social rolls with ${f.short}'s people (persuading, bluffing, bargaining, getting help)${p.favours?.[id] ? "; their one favour this story is already used" : "; once this story they will do the crew one favour you may offer (a forged permit, a docking slot, a tip-off, a hiding place)"}`);
    if (n <= -2) fx.push(`[-] on the crew's social rolls with ${f.short}'s people; they are actively against the crew in this story, and you may add trouble from them within the arc${f.trouble ? ` (${f.trouble})` : ""}`);
    if (place?.faction === id) {
      const m = priceMultiplier(n), pct = m === null ? 0 : Math.round((m - 1) * 100);
      if (m === null) fx.push(`they won't trade with the crew at ${place.name}`);
      else if (pct) fx.push(`prices at ${place.name} are ${pct > 0 ? "+" : ""}${pct}%`);
    }
    return `- ${f.name}: ${standingLabel(n)} (${n > 0 ? "+" : ""}${n})${fx.length ? `. ${fx.join("; ")}` : ". No effect."}`;
  }).filter(Boolean);
  if (story.finale) {
    const help = c.factions.filter((f) => stand(f.id) >= 2);
    lines.push(`THE FINALE: the crew's standing with every faction: ${c.factions.map((f) => `${f.short} ${standingLabel(stand(f.id))}`).join(", ")}.${help.length ? ` ${help.map((f) => f.name).join(", ")} send help in the final hour.` : " Nobody comes to help."}`);
  }
  return lines.length ? `FACTION STANDING (campaign house rule, not Mothership 1e; it is only [+]/[-] and how people treat the crew; when it gives [+] or [-] on an outcome_check, set advantage and name the faction in why):\n${lines.join("\n")}` : "";
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
    story.hazards?.length ? `HAZARDS IN THIS STORY (the app runs these rules in play; build the setting so they can happen):\n${hazardRules(story).join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

export const hazardRules = (story) => (story.hazards || []).filter((h) => HAZARDS[h]).map((h) => `- ${h} (${HAZARDS[h].kind === "psg" ? "Mothership rule" : "story hazard"}): ${HAZARDS[h].rule}`);

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
    factionBrief(c, story, p),
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
- station: the live state as path/value pairs (15-35). access_level=GUEST. Paths: doors.<room_id>, cameras.<room_id>, occupants.<room_id>, contents.<room_id>, lights.deck_N, plus systems of your own (power.*, life_support.*, comms...). The story's HAZARDS are tracked by the app: for a hazard that is already in force when the story starts, add hazards.<room_id>.type=<hazard> (and hazards.<room_id>.level=<n> for radiation 1-3, corrosive or acid 1-10, crush, collapse or machinery 1-3). Only those hazards, only in a room of the map; never invent others, and leave out hazards that start later in play.${transit ? " Start from the rig's usual state (air.reserve_hours, reactor, drive, container.seal, container.temp_c, cb_radio, nav.eta_hours) and change what this story changes. The rig's fuel, stores and life support are added automatically as rig.*: leave them out." : ` Include ${c.ship.room}.docked=${loc(c, story.at).dock.toUpperCase()}.`}
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

function arcOrders(c, story, p) {
  const a = story.adversary;
  return [
    `CAMPAIGN STORY ${story.n} of ${c.stories.length}: ${story.title}. ${story.event}; ${story.horror}.`,
    `THE ARC. Pace the story through these acts in order; let the players' choices move it on, never skip ahead of what they've earned:`,
    ...ACTS.map(([k, label], i) => `${i + 1}. ${label.toUpperCase()}: ${story.acts[k]}`),
    `THE ADVERSARY is ${a.name} (${a.type}). Keep it unseen through the Omens; it shows itself in the Manifestation.`,
    `When the Banishment is done or the crew escape or die, play the Slumber as the closing scene and leave its hooks for later stories.`,
    factionBrief(c, story, p),
  ].filter(Boolean).join("\n");
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
    standingOrders: [arcOrders(c, story, p), String(d.standingOrders || "").trim()].filter(Boolean).join("\n\n"),
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
export function carryInto(config, c, story, p, station) {
  config.crew = sanitizeCrew(structuredClone(p.crew));
  for (const pc of config.crew) pc.cond = { ...newCond(), cryo: pc.cond.cryo, lethal: pc.cond.lethal, dead: pc.cond.dead, tags: pc.cond.tags };
  config.shipCrew = c.ship.crew;
  p.favours = {};
  p.nudges = {};
  for (const m of presentIn(c, config)) {
    const member = config.cast.find((x) => x.name === m.name);
    const was = p.cast[m.id];
    if (!member) continue;
    const nudge = attitudeNudge(p.factions?.[m.faction]);
    if (was) Object.assign(member, { why: was.why, portrait: was.portrait || member.portrait });
    member.attitude = clampStanding((was ? was.attitude : member.attitude) + nudge);
    if (nudge) p.nudges[m.id] = nudge;
  }
  config.cast = sanitizeCast(config.cast);
  const mary = config.voices.find((v) => v.id === "mary" || (isTransit(story) && v.id === "terminal"));
  if (mary) Object.assign(mary, { ...fromPreset("human"), preset: "human" }, { voice: { ...fromPreset("human").voice, speaker: SPEAKERS.af_bella ? "af_bella" : fromPreset("human").voice.speaker } });
  const channel = config.voices.find((v) => v.id === config.castChannel);
  if (channel && !isTransit(story)) channel.systems = ["*"];
  // The rig's resources go into the story's station state (rig.*). A transit story burns the lane's fuel (house rule) unless it is being rebuilt.
  const lane = isTransit(story) && laneBetween(c, story.from, story.to);
  const burned = lane && p.current !== story.id ? Math.min(p.resources.fuel, fuelCost(lane.days)) : 0;
  p.resources.fuel -= burned;
  if (station) {
    station.rig = rigStation(p.resources);
    if (station.fuel) {
      delete station.fuel.pct;
      if (!Object.keys(station.fuel).length) delete station.fuel;
    }
  }
  return { burned, lane };
}

// When a story is finished: remember how it ended, where the rig is, the crew's sheets and how the recurring characters feel.
// `ticked` are the indexes of the story's affinity entries that happened; only those change a standing. Returns the story and the changes.
export function finishInto(p, c, config, outcome, ticked = [], station = null) {
  const story = c.stories.find((s) => s.id === p.current);
  if (!story) return null;
  p.resources = resourcesFrom(station, p.resources);
  const changes = [...new Set(Array.isArray(ticked) ? ticked : [])].map((i) => Number.isInteger(i) && story.affinity?.[i]).filter(Boolean)
    .map((a) => shiftStanding(p, c, a.faction, a.change, a.when)).filter(Boolean);
  p.favours = {};
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
    p.cast[m.id] = { attitude: clampStanding(member.attitude - (p.nudges?.[m.id] || 0)), why: member.why, portrait: member.portrait, history: history.slice(-600) };
  }
  p.nudges = {};
  return { story, changes };
}

export const campaignList = () => CAMPAIGNS;

// ---- Travel and resupply (campaign house rules; the PSG prices are in resources.js)
export const laneBetween = (c, a, b) => c.lanes.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a)) || null;

// The rig moves along a lane between stories; it burns 1 fuel unit per started 3 days of the lane.
export function travelTo(p, c, to) {
  const lane = laneBetween(c, p.at, to);
  if (p.current) return { ok: false, error: "Finish the story being played first." };
  if (!lane) return { ok: false, error: "There is no lane from here to there." };
  const cost = fuelCost(lane.days), have = p.resources.fuel;
  if (have < cost) return { ok: false, error: `Not enough fuel: ${lane.name} needs ${cost} unit${cost > 1 ? "s" : ""} and the rig has ${have}. Refuel first.` };
  const from = p.at;
  p.resources.fuel -= cost;
  p.at = to;
  return { ok: true, lane, cost, from, left: p.resources.fuel };
}

// Prices at the port the rig is at: PSG base price x the port class (house rule) x the faction's standing; null when they won't trade.
export function resupplyView(c, p) {
  const l = loc(c, p.at);
  const cls = l ? portMult(l.portClass) : 1;
  const m = priceMultiplier(clampStanding(p.factions?.[l?.faction]));
  const price = (base) => (m === null ? null : priceAt(c, p, p.at, base * cls));
  return {
    at: p.at, name: l?.name || "", portClass: l?.portClass || "", classMult: cls, trade: m !== null,
    prices: { ammo: price(PRICES.ammo), aid: price(PRICES.aid), stimpak: price(PRICES.stimpak), mre: price(PRICES.mre), tank: price(PRICES.tank) },
    fuelFactor: m === null ? null : cls * m,
    firearms: firearms.map((w) => w.name),
  };
}

// Buys supplies for the rig and one character, paid from the rig account or a character (`pay`). lines: counts of fuel, ammo (for `ammoFor`), aid, stimpak, mre, tank.
export function resupply(p, c, { to, lines = {}, ammoFor = "", fuelPrice = 0, pay = "rig" } = {}) {
  if (p.current) return { ok: false, error: "Finish the story being played first." };
  const v = resupplyView(c, p);
  if (!v.trade) return { ok: false, error: `${v.name} won't trade with the crew.` };
  const n = (k) => Math.max(0, Math.min(20, Math.round(Number(lines[k]) || 0)));
  const want = Object.fromEntries(["fuel", "ammo", "aid", "stimpak", "mre", "tank"].map((k) => [k, n(k)]));
  const pc = p.crew.find((x) => x.id === to) || p.crew[0];
  const gun = weaponByName(ammoFor);
  if (want.ammo && !gun?.shots) return { ok: false, error: "Pick the firearm the ammo is for." };
  if (p.resources.fuel + want.fuel > TANK) return { ok: false, error: `The tank holds ${TANK} units; the rig has ${p.resources.fuel}.` };
  const slots = want.aid + want.stimpak + want.tank + (want.ammo ? 1 : 0);
  if (slots && !pc) return { ok: false, error: "No crew to carry them." };
  if (pc && pc.items.length + slots > 24) return { ok: false, error: `${pc.name} can't carry that many items.` };
  const fuelEach = Math.round(Math.max(0, Number(fuelPrice) || 0) * v.fuelFactor);
  const total = want.fuel * fuelEach + want.ammo * v.prices.ammo + want.aid * v.prices.aid + want.stimpak * v.prices.stimpak + want.mre * v.prices.mre + want.tank * v.prices.tank;
  const paid = spend(p, pay, total, `resupply at ${v.name}`);
  if (!paid.ok) return paid;
  const bought = [];
  if (want.fuel) { p.resources.fuel += want.fuel; bought.push(`${want.fuel} fuel`); }
  if (want.mre) { p.resources.stores.rations = Math.min(99, p.resources.stores.rations + want.mre * MRE_PACK); bought.push(`${want.mre * MRE_PACK} MREs for the rig`); }
  if (want.ammo) { addMagazines(pc, gun, want.ammo); bought.push(`${want.ammo} magazine${want.ammo > 1 ? "s" : ""} for the ${gun.name}`); }
  for (const [k, item] of [["aid", "first aid kit"], ["stimpak", "stimpak"], ["tank", "oxygen tank"]]) {
    for (let i = 0; i < want[k]; i++) pc.items.push(item[0].toUpperCase() + item.slice(1));
    if (want[k]) bought.push(`${want[k]} ${item}${want[k] > 1 ? "s" : ""}`);
  }
  return { ok: true, total, bought, to: pc?.name || "", at: v.name, fuelFree: want.fuel > 0 && !fuelEach, entries: paid.entries };
}

// The jobs a pilot with no Warden can take: unplayed stories at the port the rig is at, and on the lanes that leave it.
// Player-safe: the sector payload's whitelist (id, title, hook, job) plus where it is and how long the lane is.
export function jobsAt(c, p) {
  const stories = c.stories.filter((s) => (s.at || s.from) === p.at && !p.done.some((d) => d.id === s.id));
  const jobs = sectorPayload(c, { ...p, offered: stories.map((s) => s.id) }).offered.map(({ id, title, hook, job }) => {
    const s = c.stories.find((x) => x.id === id), l = isTransit(s) && laneBetween(c, s.from, s.to);
    return { id, title, hook, job, where: placeOf(c, s), ...(l ? { lane: l.name, days: l.days, cost: fuelCost(l.days), short: p.resources.fuel < fuelCost(l.days) } : {}) };
  });
  const lanes = c.lanes.filter((l) => l.a === p.at || l.b === p.at).map((l) => {
    const to = l.a === p.at ? l.b : l.a, cost = fuelCost(l.days);
    return { to, dest: loc(c, to).name, lane: l.name, days: l.days, cost, short: p.resources.fuel < cost };
  });
  const cheapest = lanes.length ? Math.min(...lanes.map((l) => l.cost)) : 0;
  const v = resupplyView(c, p), trade = v.trade;
  return { port: loc(c, p.at)?.name || "", rig: c.ship.name, fuel: p.resources.fuel, capacity: TANK, money: p.money, fuelEach: trade ? Math.round(FUEL_PRICE * v.fuelFactor) : 0, low: p.resources.fuel < cheapest, stuck: isStuck(c, p), canRefuel: trade && p.resources.fuel < TANK, jobs, lanes };
}

// Stuck (no Warden): the rig can't afford the cheapest lane from here and its account can't buy the fuel for it.
const dispatchNeed = (c, p) => {
  const costs = c.lanes.filter((l) => l.a === p.at || l.b === p.at).map((l) => fuelCost(l.days));
  return costs.length ? Math.max(0, Math.min(...costs) - p.resources.fuel) : 0;
};
const fuelEach = (c, p) => Math.round(FUEL_PRICE * (resupplyView(c, p).fuelFactor ?? portMult(loc(c, p.at)?.portClass)));
export function isStuck(c, p) {
  const need = dispatchNeed(c, p);
  return need > 0 && (!resupplyView(c, p).trade || need * fuelEach(c, p) > p.money);
}

// Call dispatch (house rule): Local 1312 advances the fuel for the cheapest lane; its price is added to the note, union standing unchanged.
export function callDispatch(p, c) {
  if (p.current) return { ok: false, error: "Finish the story being played first." };
  if (!isStuck(c, p)) return { ok: false, error: "The rig isn't stuck: dispatch only helps a rig that can't buy the fuel for a lane." };
  const units = dispatchNeed(c, p), cost = units * fuelEach(c, p);
  p.resources.fuel += units;
  const e = book(p, "debt", cost, "Union fuel advance");
  return { ok: true, units, cost, entries: [e], at: loc(c, p.at).name };
}

// No Warden to resupply: the pilot buys fuel for the rig account at the port the rig is at, the Warden's resupply at the default 500cr a unit (house rule, the port's multiplier applies), as much as fills the tank or the rig account allows.
export const FUEL_PRICE = 500;
export function refuel(p, c) {
  if (p.current) return { ok: false, error: "Finish the story being played first." };
  const v = resupplyView(c, p);
  if (!v.trade) return { ok: false, error: `${v.name} won't trade with the crew.` };
  const each = Math.round(FUEL_PRICE * v.fuelFactor), room = TANK - p.resources.fuel;
  if (room <= 0) return { ok: false, error: "The tank is full." };
  const n = Math.min(room, each ? Math.floor(p.money / each) : room);
  if (n < 1) return { ok: false, error: `Not enough credits: the rig account has ${exact(p.money)} and a unit of fuel is ${exact(each)}.` };
  const r = resupply(p, c, { lines: { fuel: n }, fuelPrice: FUEL_PRICE });
  return r.ok ? { ...r, added: n } : r;
}

// What the players' screens get of the sector: a whitelist, so nothing of a story's arc, adversary, secrets, cast or description can leak.
export function sectorPayload(c, p) {
  const at = loc(c, p.at) || loc(c, c.start);
  const spot = (s) => (s.at ? { x: loc(c, s.at).x, y: loc(c, s.at).y + 30 } : { x: (loc(c, s.from).x + loc(c, s.to).x) / 2, y: (loc(c, s.from).y + loc(c, s.to).y) / 2 });
  const story = (id) => c.stories.find((s) => s.id === id);
  return {
    t: "sector",
    title: c.title,
    ports: c.locations.map(({ id, name, kind, x, y, theme }) => ({ id, name, kind, x, y, theme })),
    lanes: c.lanes.map(({ a, b, name, days, dark }) => ({ a, b, name, days, dark: !!dark })),
    rig: { name: c.ship.name, at: at.id, x: at.x, y: at.y },
    played: p.done.map((d) => story(d.id)).filter(Boolean).map(({ id, title }) => ({ id, title })),
    offered: (p.offered || []).map(story).filter(Boolean).map(({ id, title, hook, job }) => ({ id, title, hook, job, ...(({ x, y }) => ({ x, y }))(spot(story(id))) })),
  };
}

// ---- Pay, debt and union dues (campaign house rules; credits notation and starting credits are PSG)

// A story's fee goes to the rig account, less the union's dues (house rule: 4% of the pay). Skipping the dues keeps the 4% and costs Union standing.
function payIn(p, c, story, gross, why, skipDues) {
  const out = { lines: [], entries: [], changes: [] };
  if (gross <= 0) return out;
  const dues = duesOf(gross);
  out.entries.push(book(p, "rig", gross, `${story.title}: fee, ${why}`));
  if (!skipDues && dues) out.entries.push(book(p, "rig", -dues, `${story.title}: union dues, ${DUES_PCT}% (house rule)`));
  out.lines.push(`Pay for ${story.title} (house rule): ${exact(gross)} fee, ${skipDues ? "union dues skipped (kept " + exact(dues) + ")" : `less ${DUES_PCT}% union dues ${exact(dues)}`}, ${exact(gross - (skipDues ? 0 : dues))} to the rig account.`);
  if (skipDues && dues) {
    const ch = shiftStanding(p, c, "union", -1, "skipped the union dues");
    if (ch) out.changes.push(ch);
  }
  return out;
}

// When a story is played: any part of its fee paid up front goes in at once (dues taken), once per play.
export function payUpfront(p, c, story) {
  const out = { lines: [], entries: [], changes: [] };
  const amount = upfrontOf(story);
  if (!amount || p.upfront?.[story.id]) return out;
  p.upfront = { ...p.upfront, [story.id]: amount };
  return payIn(p, c, story, amount, "paid up front", false);
}

// When a story is finished: the fee by how it was delivered, the debt's schedule, and the finale's payoff.
// o: { delivery: full|partly|none, late, skipDues, fee } (fee overrides the computed remainder). Call after finishInto.
export function settleStory(p, c, story, o = {}) {
  const delivery = DELIVERY[o.delivery] === undefined ? "full" : o.delivery;
  const paid = p.upfront?.[story.id] || 0;
  const out = { lines: [], entries: [], changes: [], handout: null, delivery };
  const take = (r) => { out.lines.push(...r.lines); out.entries.push(...r.entries); out.changes.push(...r.changes); };
  if (story.payoff) {
    const owed = p.debt, cleared = Math.round(owed * DELIVERY[delivery]);
    if (cleared) {
      book(p, "debt", -cleared, `${story.title}: the finale ${delivery === "full" ? "pays off" : "pays down"} the note`);
      out.entries.push(p.ledger.at(-1));
      out.lines.push(`${story.title} (house rule): ${delivery === "full" ? "the note to Gallow-Mercer Finance is paid off" : `half the note is paid off (${exact(cleared)})`}.`);
    } else out.lines.push(`${story.title}: not delivered, so the note stands at ${exact(p.debt)}.`);
  } else {
    const fee = o.fee === undefined || o.fee === "" || o.fee === null ? finalFee(story, delivery, !!o.late, paid) : Math.max(0, Math.round(Number(o.fee) || 0));
    if (story.late && o.late) out.lines.push(`${story.title}: delivered late, which voids the fee (house rule).`);
    if (fee) take(payIn(p, c, story, fee, DELIVERY[delivery] < 1 ? (delivery === "none" ? "not delivered" : "delivered in part, half the fee") : "delivered in full", !!o.skipDues));
    else if (!(story.late && o.late)) out.lines.push(`${story.title}: no fee to pay${paid ? ` (${exact(paid)} was paid up front)` : ""}.`);
  }
  delete p.upfront?.[story.id];
  p.finished = (p.finished || 0) + 1;
  if (debtDue(p.finished, p.debt) && !story.payoff) {
    const due = Math.min(DEBT_PAYMENT, p.debt);
    if (p.money >= due) {
      out.entries.push(book(p, "rig", -due, "payment on the Gallow-Mercer Finance note"), book(p, "debt", -due, "scheduled payment"));
      p.missed = 0;
      out.lines.push(`Debt payment due (house rule: ${exact(DEBT_PAYMENT)} every ${DEBT_EVERY} finished stories): ${exact(due)} paid from the rig account; ${exact(p.debt)} still owed to Gallow-Mercer Finance.`);
    } else {
      p.missed++;
      const ch = shiftStanding(p, c, "gallow_mercer", -1, "missed a payment");
      if (ch) out.changes.push(ch);
      out.handout = debtLetter(p, c, due);
      out.lines.push(`Debt payment MISSED (house rule): ${exact(due)} was due and the rig account has ${exact(p.money)}. Gallow-Mercer Finance has sent a letter; ${exact(p.debt)} still owed.`);
    }
  }
  return out;
}
