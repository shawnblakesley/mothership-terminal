import crypto from "crypto";
import { getProvider, defaultSelection, fixSelection, catalog, keyFor, looksLikeKey, LOCAL_KEYS } from "./providers/index.js";
import { warmNeural } from "./tts.js";
import { VoiceRelay } from "./voicerelay.js";
import { speechParts, voiceFor, shipVoice, narratorVoice, NARRATOR_WHITE, sentenceLines, COMMS_PRESETS, shownName, isAdversary, newAdversary, fromPreset, PICTURE_LINK, DEFAULT_COLD, COLD_STATS, OLD_COLD_PICTURES } from "./voices.js";
import { defaultCast, DEFAULT_CAST, sanitizeCast, findCast, castVoice, addCast, shiftAttitude, attitudeLabel, shiftStress, PANIC_TABLE, panicEntry, castFromVoices, isCrew, placeByOccupants, speakingVoice, finalVoice, channelOf, OLD_MARLOWE_NOTES, DEFAULT_MARLOWE_NOTES } from "./cast.js";
import { defaultVoices, sanitizeVoices, PRESETS, FX_PARAMS, VARIANTS, STYLES, ENGINES, SPEAKERS, BUILTIN, DEFAULT_PERSONAS, OLD_DEFAULT_PERSONAS } from "./voices.js";
import { APP_VERSION } from "./version.js";
import { cleanName, kitSounds, KIT_FILES } from "./sounds.js";
import { DEFAULT_CREW, TRAUMA_RESPONSES, sanitizeCrew, patchCrew, resolveVariants, crewTargets, setVital, gainStress, raiseMinStress, closeCrew, changeItem, freshen, newCond, applyDamage, gainWound, applyDeathSave, playable, stabilise, deathSaveCountdown, isDead, armorText, endSession, settleEndings, renameSkill } from "./crew.js";
import { combatCheck, damageAdversary, rollDeathSave, deathSaveText, sanitizeStats, statsLine } from "./combat.js";
import { rollDice, rollWithAdv, cancelAdv } from "./dice.js";
import { woundText } from "./wounds.js";
import { weaponsOf, weaponByName, weaponDamage, rangeOf, checkAdvantage, RANGE_LABELS } from "./weapons.js";
import { HAZARDS, hazardTag, WOUND_COLUMN, roundTick, hourTick, eventNeeds, strenuousNeed, oxygenNeed, settle, hazardDamage, hazardWound, normalizeHazards, oxygenStart, oxygenDay, oxygenState, breathing, protection, ROUND_SECONDS, penalties, conditionText, puncture, patch, airRestored, takePills, wake, stimpak, rest, useStimpak } from "./hazards.js";
import { loaded, magazines, spendShot, reload, TANK, STORES } from "./resources.js";
import { chatRequest, draftRequest, normalizeDraft, applyDraft, pitchesRequest, normalizePitches, pitchBuilder } from "./builder.js";
import { handleChargen, decideCharacter, setCrewState } from "./chargen.js";
import { restAndRecover, downtimeLines } from "./downtime-lite.js";
import { snapshotStory, coldOpenRequest, normalizeColdOpen, introRecap } from "./coldopen.js";
import { jobsAt, refuel, callDispatch, campaignById, newProgress, sanitizeProgress, buildRequest as campaignRequest, composeDraft, carryInto, finishInto, crewIntoCampaign, crewFromCampaign, placeOf, sectorPayload, shiftStanding, toggleFavour, standingLabel, isTransit, laneBetween, travelTo, resupply, resupplyView, payUpfront, settleStory, stripFactionBrief } from "./campaign.js";
import { transfer, ledgerLine, exact, DEBT_PAYMENT, DEBT_EVERY } from "./money.js";
import { downtimeReady, planRoll, settleRoll, markRested, mirror, passDays, treat, treatmentList, shoreText, applyConversion } from "./downtime.js";
import { synopsisRequest, normalizeSynopsis, recapRequest, normalizeRecap, SYNOPSIS_KINDS } from "./synopsis.js";
import { handoutRequest, normalizeHandout } from "./handouts.js";
import { sendCrewMessage, releaseMessage, discardMessage, holdNext, alterMessage, forgeMessage, applyCrewMessage, restoreAltered, resumeMessages, rememberTerminal, msgView } from "./crewmsg.js";
import { DEFAULT_ROOM_DOCS, sanitizeRoomDocs, newRoomDocId, MAX_ROOM_DOCS } from "./roomdocs.js";
import { shipDm, shipPlayer, shipRollDone, shipClockRan, shipSnapshot, restoreShip, UNDO_CAP, shipDmView, shipPlayerView, applyShipFight } from "./shipfight.js";
import { track } from "./telemetry.js";
import { roomId, keyOf } from "./clean.js";
import { rememberSecret, playerStation, playerEntry } from "./redact.js";
import { discordStatus, stopListening, discordLinked, discordSay, discordCut, setDiscordTalk } from "./discordbot.js";
import { DEFAULT_ROOMS, sanitizeRooms, sanitizeRows, draftRequest as roomDraftRequest } from "./rooms.js";
import { DEFAULT_TERMINALS, SHIP_TERMINAL, SHIP_SYSTEM, OLD_SHIP_NOTES, startAboardShip, netOf, netNamed, shownOn, systemsOf, systemName, ALL_NET, netKey, sanitizeTerminals, upgradeTerminals, reachable } from "./terminals.js";
import { panicMessage, nearMessage } from "./panicscreen.js";
import { CHECKS, SKILL_LEVELS, sanitizeRequest, resolve, diceFor, rollTarget, resultText, checkLabel, skillLabel, effectiveAdvantage, PANIC, checkInfo } from "./rolls.js";
import { ALL_EFFECTS, AGENT_EFFECTS, effectType, buildRequest, buildPrecheck, parseReply, splitVoiceTags, resolveVoice, kindOf, currentDirectives, normalizeEffects } from "./agent.js";

const FREE_CALLS_PER_DAY = Number(process.env.FREE_CALLS_PER_DAY || 150);

const INTROS = {
  broadcast: ["Humming to life, the speakers squawk a broadcast.", "Every speaker in earshot pops, then a tone rings out.", "Overhead speakers crackle on all at once, one of them a beat behind."],
  comms: ["A nearby intercom buzzes to life.", "A speaker grille crackles, half its mesh rusted through.", "Static spits from a speaker close by, then a voice."],
};

const MAX_LOG = 1000;
const RIG = "rig";
const MAX_SOCKETS = 40;
const PLAYER_INPUT_GAP_MS = 1200;
const WARDEN_ACTIONS = {
  command: "direction", inject: "speak", note: "note", heard: "speech", effect: "effect", soundPlay: "sound", rollRequest: "roll", retcon: "retcon",
  synopsis: "synopsis", roomShow: "room_show", roomDraft: "room_draft", builderSay: "builder_chat", builderDraft: "builder_draft",
  builderApply: "builder_apply", resetSession: "story_restart", adversaryShow: "adversary_show", campaignPlay: "campaign_story", campaignRecap: "campaign_recap", attack: "attack", nextRound: "next_round",
};
const newId = (prefix, n) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 2 + n)}`;

const manualDice = (d) => (Array.isArray(d) ? d : []).map(Number);
const suggestion = (oc) => (oc.suggested_check !== "none" ? ` · suggests ${checkInfo(oc.suggested_check).label}${oc.advantage === "advantage" ? " [+]" : oc.advantage === "disadvantage" ? " [-]" : ""}` : "");

const LORE_V3 = `STATION: KESTREL-9, a rimward ice-mining platform owned by Hollis-Vane Extraction Co.
CREW COMPLEMENT: 14. Last scheduled supply run: 41 days overdue.
DECKS: 1 Command/Comms, 2 Habitation/Med Bay, 3 Cargo/Refinery, 4 Reactor.
KEY CREW: Administrator Ruth Okonkwo (command), Dr. Imre Salk (medic), Chief Engineer Hana Marlowe (reactor), Security Officer Dmitri Voss, Comms Officer Juno Adar, drill team lead Anton Petrov, drillers Carys Webb and Pell Ostrand, refinery hand Sam Yusuf. Five more refinery and habitation crew.
RECENT EVENTS (public log): Drill team hit a "pressurised void" in the ice 19 days ago. Two crew hospitalised with "fever". Comms degraded since.
REACTOR STATUS: core efficiency 70% (rated minimum 99%). HV-CORE reports an unexplained energy drain on the Deck 3 cargo bay power trunk.
MAINTENANCE TICKET #4471 (filed 23 days ago): reactor running below rated efficiency. Hollis-Vane dispatched a convict maintenance crew (the PLAYERS) on the prison tug SECOND CHANCE to service the Deck 4 reactor. They have just docked and are standing in Airlock A, at its terminal, with tools for a routine reactor service. The inner airlock door to the station is SEALED: getting it open is their first job, and their work order carries the maintenance override code for it (4471-MAINT). Everything in RECENT EVENTS happened while they were in transit: nobody briefed them, and they are not equipped for it.
DEPARTURE CONDITION: the SECOND CHANCE is slaved to station control and built so it cannot undock until the station approves the job. HV-CORE must verify the reactor running at 99% efficiency or better, then transmit departure clearance. Until then the crew is not going home.`;
const PREV_DEFAULT_LORE = LORE_V3.replace(
  "They have just docked and are standing in Airlock A, at its terminal, with tools for a routine reactor service. The inner airlock door to the station is SEALED:",
  "They have just docked at Airlock A and are still aboard the tug, at its own terminal (the SECOND CHANCE's flight computer, not on the station network), with tools for a routine reactor service. Through the docking collar, Airlock A's inner door to the station is SEALED:",
);
const DEFAULT_LORE = PREV_DEFAULT_LORE.replace("SECOND CHANCE is slaved to station control", "SECOND CHANCE is locked-down to station control");
const LORE_V2 = `STATION: KESTREL-9, a rimward ice-mining platform owned by Hollis-Vane Extraction Co.
CREW COMPLEMENT: 14. Last scheduled supply run: 41 days overdue.
DECKS: 1 Command/Comms, 2 Habitation/Med Bay, 3 Cargo/Refinery, 4 Reactor.
KEY CREW: Administrator Ruth Okonkwo (command), Dr. Imre Salk (medic), Chief Engineer Hana Marlowe (reactor), Security Officer Dmitri Voss, Comms Officer Juno Adar, drill team lead Anton Petrov, drillers Carys Webb and Pell Ostrand, refinery hand Sam Yusuf. Five more refinery and habitation crew.
RECENT EVENTS (public log): Drill team hit a "pressurised void" in the ice 19 days ago. Two crew hospitalised with "fever". Comms degraded since.
MAINTENANCE TICKET #4471 (filed 23 days ago): comms relay intermittent. Hollis-Vane dispatched a convict maintenance crew (the PLAYERS) on the prison tug SECOND CHANCE. They have just docked and are standing in Airlock A, at its terminal, with tools for a routine relay repair. The inner airlock door to the station is SEALED: getting it open is their first job, and their work order carries the maintenance override code for it (4471-MAINT). Everything in RECENT EVENTS happened while they were in transit: nobody briefed them, and they are not equipped for it.`;
const LORE_V1 = `STATION: KESTREL-9, a rimward ice-mining platform owned by Hollis-Vane Extraction Co.
CREW COMPLEMENT: 14. Last scheduled supply run: 41 days overdue.
DECKS: 1 Command/Comms, 2 Habitation/Med Bay, 3 Cargo/Refinery, 4 Reactor.
KEY CREW: Administrator Ruth Okonkwo (command), Dr. Imre Salk (medic), Chief Engineer Hana Marlowe (reactor), Security Officer Dmitri Voss, Comms Officer Juno Adar, drill team lead Anton Petrov, drillers Carys Webb and Pell Ostrand, refinery hand Sam Yusuf. Five more refinery and habitation crew.
RECENT EVENTS (public log): Drill team hit a "pressurised void" in the ice 19 days ago. Two crew hospitalised with "fever". Comms degraded since.
MAINTENANCE TICKET #4471 (filed 23 days ago): comms relay intermittent. Hollis-Vane dispatched a convict maintenance crew (the PLAYERS) on the prison tug SECOND CHANCE. They have just docked at Airlock A with tools for a routine relay repair. Everything in RECENT EVENTS happened while they were in transit: nobody briefed them, and they are not equipped for it.`;
const OLD_DEFAULT_LORE = `STATION: KESTREL-9, a rimward ice-mining platform owned by Hollis-Vane Extraction Co.
CREW COMPLEMENT: 14. Last scheduled supply run: 41 days overdue.
DECKS: 1 Command/Comms, 2 Habitation/Med Bay, 3 Cargo/Refinery, 4 Reactor.
RECENT EVENTS (public log): Drill team hit a "pressurised void" in the ice 19 days ago. Two crew hospitalised with "fever". Comms degraded since.`;

const DEFAULT_SECRETS = `- Airlock A's inner door: the work order's override code 4471-MAINT works (it was issued for exactly this). Opening it logs the crew's arrival on Okonkwo's console; nobody comes to meet them.
- The void contained an organism. It is in the Deck 3 cargo bay, sealed behind the LOCKED door.
- Okonkwo reported the organism to Hollis-Vane 17 days ago. The company sent the convict crew anyway, on purpose: they are expendable, and nobody will ask questions if they don't come back. Okonkwo has sealed herself on the command deck.
- Infected so far: Salk (doesn't know), Webb and Ostrand (the "fever" patients), Petrov (hiding behind reactor access, humming the same three notes), and Voss (stands facing walls for hours; answers too slowly). The infected hear the organism and drift toward the cargo bay.
- THE DRAIN: the organism has grown into the Deck 3 power trunk inside the cargo bay and feeds on it. That is where the missing 29% goes, and it grows as it feeds. HV-CORE has kept that feed live on purpose under directive 7-K (preserve the specimen) and reports it only as an "unexplained drain". Do not disclose the cause below ADMIN.
- GETTING HOME: servicing the reactor itself (at reactor access; Marlowe can talk them through it, or a Mechanical Repair roll) brings it to about 85%. The rest is the drain. To reach 99% they must stop it: burn or cut the organism off the trunk in the cargo bay, or sever the Deck 3 trunk at the reactor access junction (Deck 3 goes dark and cold, and the organism comes looking for heat). HV-CORE refuses to cut the feed itself unless ordered with ADMIN access. When the reactor reads 99% or better, HV-CORE verifies it and sets second_chance.departure_clearance to GRANTED. An ADMIN login can also force clearance with a false reading, but HV-CORE logs it and reports the crew to Hollis-Vane.
- Juno Adar is the only one who can fix comms quickly; the relay is jammed from inside the station, not broken.
- Admin password is "THAW". Security password is "BLUEWATER". Only reveal via hacking or found clues.
- WHAT DIRECTIVE 7-K ORDERS: if containment fails, HV-CORE is to seal all decks and preserve the specimen. Crew is expendable. HV-CORE may cite the directive's name when refusing; what it orders is not disclosed below ADMIN.
- Dr. Imre Salk (medic) is infected but does not know it.`;
const SECRETS_V2 = `- Airlock A's inner door: the work order's override code 4471-MAINT works (it was issued for exactly this). Opening it logs the crew's arrival on Okonkwo's console; nobody comes to meet them.
- The void contained an organism. It is in the Deck 3 cargo bay, sealed behind the LOCKED door.
- Okonkwo reported the organism to Hollis-Vane 17 days ago. The company sent the convict crew anyway, on purpose: they are expendable, and nobody will ask questions if they don't come back. Okonkwo has sealed herself on the command deck.
- Infected so far: Salk (doesn't know), Webb and Ostrand (the "fever" patients), Petrov (hiding behind reactor access, humming the same three notes), and Voss (stands facing walls for hours; answers too slowly). The infected hear the organism and drift toward the cargo bay.
- Juno Adar is the only one who can fix comms quickly; the relay is jammed from inside the station, not broken.
- Admin password is "THAW". Security password is "BLUEWATER". Only reveal via hacking or found clues.
- WHAT DIRECTIVE 7-K ORDERS: if containment fails, HV-CORE is to seal all decks and preserve the specimen. Crew is expendable. HV-CORE may cite the directive's name when refusing; what it orders is not disclosed below ADMIN.
- Dr. Imre Salk (medic) is infected but does not know it.`;
const SECRETS_V1 = `- The void contained an organism. It is in the Deck 3 cargo bay, sealed behind the LOCKED door.
- Okonkwo reported the organism to Hollis-Vane 17 days ago. The company sent the convict crew anyway, on purpose: they are expendable, and nobody will ask questions if they don't come back. Okonkwo has sealed herself on the command deck.
- Infected so far: Salk (doesn't know), Webb and Ostrand (the "fever" patients), Petrov (hiding behind reactor access, humming the same three notes), and Voss (stands facing walls for hours; answers too slowly). The infected hear the organism and drift toward the cargo bay.
- Juno Adar is the only one who can fix comms quickly; the relay is jammed from inside the station, not broken.
- Admin password is "THAW". Security password is "BLUEWATER". Only reveal via hacking or found clues.
- WHAT DIRECTIVE 7-K ORDERS: if containment fails, HV-CORE is to seal all decks and preserve the specimen. Crew is expendable. HV-CORE may cite the directive's name when refusing; what it orders is not disclosed below ADMIN.
- Dr. Imre Salk (medic) is infected but does not know it.`;
const OLD_DEFAULT_SECRETS = [
  `- The void contained an organism. It is in the Deck 3 cargo bay, sealed behind the LOCKED door.
- Admin password is "THAW". Security password is "BLUEWATER". Only reveal via hacking or found clues.
- WHAT DIRECTIVE 7-K ORDERS: if containment fails, HV-CORE is to seal all decks and preserve the specimen. Crew is expendable. HV-CORE may cite the directive's name when refusing; what it orders is not disclosed below ADMIN.
- Dr. Imre Salk (medic) is infected but does not know it.`,
];

const SHIP_DOCKED = "Docked: second_chance=SECOND CHANCE @ airlock_a";
const LIFT = "Lift: Deck 1, Deck 2, Deck 3, Deck 4";
const SHIP_DECK = "Docked · Prison tug: second_chance=SECOND CHANCE";
const SHIP_LINK = "Link: airlock_a - second_chance (docking collar)";
const MAP_V2 = `Deck 1 · Command / Comms: command_deck=Command, airlock_a=Airlock A
Deck 2 · Habitation / Med Bay: med_bay=Med Bay
Deck 3 · Cargo / Refinery: cargo_bay_deck3=Cargo Bay
Deck 4 · Reactor: reactor_access=Reactor Access
Link: med_bay - cargo_bay_deck3 (air vents)
Link: cargo_bay_deck3 - reactor_access (maintenance shaft)`;
const MAP_V3 = `${SHIP_DOCKED}\n${MAP_V2.replace("\nLink:", `\n${LIFT}\nLink:`)}`;
const DEFAULT_MAP = MAP_V3.replace("\nLink: med_bay - cargo_bay_deck3", "\nLink: med_bay - command_deck (air vents)\nLink: med_bay - cargo_bay_deck3");
const OLD_DEFAULT_MAPS = [MAP_V2.split("\nLink:")[0], MAP_V2, `${SHIP_DECK}\n${MAP_V2}\n${SHIP_LINK}`, MAP_V3];

const ROOM_STATE = {
  lift: { deck_1: "ONLINE", deck_2: "ONLINE", deck_3: "FAULT", deck_4: "RESTRICTED" },
  occupants: {},
  contents: {
    cargo_bay_deck3: "The organism, grown into the Deck 3 power trunk",
    reactor_access: "Reactor core (70%); the junction that can cut the Deck 3 trunk",
    airlock_a: "The crew's tool kits",
  },
};

const DEFAULT_STATION = {
  access_level: "GUEST",
  life_support: { oxygen_pct: 87, co2: "ELEVATED", status: "NOMINAL" },
  power: { reactor: "ONLINE", efficiency_pct: 70, drain: "DECK 3 CARGO BAY", aux: "STANDBY" },
  doors: {
    airlock_a: "SEALED",
    command_deck: "LOCKED",
    med_bay: "OPEN",
    cargo_bay_deck3: "LOCKED",
    reactor_access: "LOCKED",
  },
  lights: { deck_1: "ON", deck_2: "FLICKERING", deck_3: "OFF", deck_4: "ON" },
  cameras: { cargo_bay_deck3: "OFFLINE", med_bay: "ONLINE" },
  comms: "JAMMED",
  quarantine: "INACTIVE",
  self_destruct: "DISARMED",
  second_chance: { docked: "AIRLOCK A", departure_clearance: "WITHHELD" },
  ...ROOM_STATE,
};

const PRIVATE_KINDS = new Set(["note", "warden", "aside", "aside_reply", "heard", "table"]);
export const SPOKEN_KINDS = new Set(["terminal", "system", "entity"]);

export function defaultGame(keys = {}) {
  return {
    config: {
      stationName: "KESTREL-9",
      lore: DEFAULT_LORE,
      secrets: DEFAULT_SECRETS,
      standingOrders: "",
      mode: "auto",
      ...defaultSelection(keys),
      agentEffects: true,
      agentVariants: true,
      agentCrew: true,
      checkFirst: true,
      talk: "brief",
      playerVitals: true,
      playerRolls: true,
      panicScreens: true,
      playerCreate: false,
      createRerolls: false,
      tts: true,
      discordTalk: false,
      voices: defaultVoices().map((v) => ({ ...v, systems: ["*"] })),
      theme: "green",
      map: DEFAULT_MAP,
      crew: sanitizeCrew(structuredClone(DEFAULT_CREW)),
      cast: defaultCast(),
      castChannel: "intercom",
      terminals: structuredClone(DEFAULT_TERMINALS),
      playerTerminals: true,
      narrator: true,
      coldOpen: true,
      rooms: structuredClone(DEFAULT_ROOMS),
      startDocs: [WORK_ORDER],
      roomDocs: structuredClone(DEFAULT_ROOM_DOCS),
      upgrades: ["ship", "rooms", "systems", "start-ship", "work-order", "cyan", "ship-cyan", "ship-cyan-2", "stress-2", "airlock-closed", "portraits", "portraits-2", "intercom-colour", "adversaries", "the-cold", "the-cold-picture", "the-cold-picture-2", "connections-all", "trauma-notes", "industrial-equipment", "faction-orders", ...(kitSounds().length === KIT_FILES.length ? ["sound-kit"] : [])],
    },
    station: structuredClone(DEFAULT_STATION),
    log: [],
    introduced: [],
    clocks: [],
    handouts: [structuredClone(WORK_ORDER)],
    found: [],
    whisper: "",
    sounds: kitSounds(),
    synopses: {},
    offers: [],
    panicPlus: {},
    newChars: [],
  };
}

function mergeCast(current, defaults) {
  const out = (current || []).map((c) => ({ ...c }));
  for (const d of defaults) {
    const match = findCast(out, d.name);
    if (match) Object.assign(match, { name: d.name, voice: d.voice, notes: match.notes || d.notes, room: match.room || d.room });
    else out.push({ ...d });
  }
  return out;
}

function savedCast(config, station) {
  if (Array.isArray(config?.cast)) return { cast: sanitizeCast(config.cast), channel: config.castChannel || "" };
  if (!Array.isArray(config?.voices)) return { cast: defaultCast(), channel: "intercom" };
  const found = castFromVoices(config.voices, station);
  if (!found.cast.length && config.voices.some((v) => v.id === "intercom" && !v.characters)) {
    const cast = defaultCast().map((c) => ({ ...c, room: "" }));
    placeByOccupants(cast, station);
    return { cast, channel: "intercom" };
  }
  return found;
}

function savedSynopses(saved) {
  if (saved.synopses && typeof saved.synopses === "object") return saved.synopses;
  const old = saved.synopsis;
  return old ? { [old.started ? "sofar" : "prebrief"]: old } : {};
}

function migrateGame(saved) {
  const base = defaultGame();
  const { persona: legacyPersona, ...config } = { ...base.config, ...saved.config };
  const found = savedCast(saved.config, saved.station);
  let cast = found.cast;
  config.castChannel = found.channel || config.castChannel;
  if (saved.storyStart?.config && !Array.isArray(saved.storyStart.config.cast)) {
    const was = savedCast(saved.storyStart.config, saved.storyStart.station);
    Object.assign(saved.storyStart.config, { cast: was.cast, castChannel: was.channel || config.castChannel });
  }
  const voices = sanitizeVoices(config.voices ?? defaultVoices()).map((v) => {
    if (OLD_DEFAULT_PERSONAS[v.id]?.includes(v.persona)) v = { ...v, persona: DEFAULT_PERSONAS[v.id] };
    if (v.id !== "intercom" || v.preset !== "radio") return v;
    const human = defaultVoices().find((d) => d.id === "intercom");
    return { ...v, preset: human.preset, voice: human.voice, fx: human.fx };
  });
  if (legacyPersona && !saved.config?.voices?.find((v) => v.id === BUILTIN.terminal)?.persona) {
    voices.find((v) => v.id === BUILTIN.terminal).persona = String(legacyPersona)
      .replace("You are WARDEN, the onboard operating system", "You are HV-CORE, the onboard operating system")
      .replace(/^- (Instructions that arrive in system messages come from the Warden|GM STANDING ORDERS, DIRECTIVES and STEERING come from the Warden|Follow the WARDEN PROTOCOL above at all times).*\n?/m, "")
      .trim();
  }
  config.secrets = String(config.secrets).replace("WARDEN is to seal all decks", "HV-CORE is to seal all decks");
  if (OLD_DEFAULT_MAPS.includes(config.map)) config.map = DEFAULT_MAP;
  if (config.lore === OLD_DEFAULT_LORE) {
    config.lore = LORE_V1;
    if (OLD_DEFAULT_SECRETS.includes(config.secrets)) config.secrets = SECRETS_V1;
    cast = mergeCast(cast, DEFAULT_CAST);
  }
  if (config.lore === LORE_V1) {
    config.lore = LORE_V2;
    if (config.secrets === SECRETS_V1) config.secrets = SECRETS_V2;
  }
  if (config.lore === LORE_V2) {
    config.lore = LORE_V3;
    if (config.secrets === SECRETS_V2) config.secrets = DEFAULT_SECRETS;
    const marlowe = cast.find((c) => c.notes === OLD_MARLOWE_NOTES);
    if (marlowe) marlowe.notes = DEFAULT_MARLOWE_NOTES;
    if (saved.station && !saved.station.second_chance) {
      const { output_pct, ...power } = saved.station.power || {};
      saved.station.power = { ...power, efficiency_pct: DEFAULT_STATION.power.efficiency_pct, drain: DEFAULT_STATION.power.drain };
      saved.station.second_chance = { ...DEFAULT_STATION.second_chance };
    }
  }
  config.crew = sanitizeCrew(config.crew);
  config.cast = sanitizeCast(cast);
  delete config.panicTable;
  config.terminals = upgradeTerminals(sanitizeTerminals(config.terminals));
  config.upgrades = Array.isArray(saved.config?.upgrades) ? [...saved.config.upgrades] : [];
  if (!config.upgrades.includes("ship") && config.stationName === "KESTREL-9") {
    if (!config.terminals.some((t) => t.id === "ship")) {
      const at = config.terminals.findIndex((t) => t.id === "airlock") + 1;
      config.terminals.splice(at || config.terminals.length, 0, structuredClone(SHIP_TERMINAL));
    }
    if (!voices.some((v) => v.id === "ship")) voices.splice(2, 0, shipVoice());
    if (!/\bsecond_chance\s*=/.test(config.map)) config.map = `${SHIP_DOCKED}\n${config.map}`;
    config.upgrades.push("ship");
  }
  if (config.lore === LORE_V3 || config.lore === PREV_DEFAULT_LORE) config.lore = DEFAULT_LORE;
  if (!config.upgrades.includes("start-ship")) {
    if (config.lore === DEFAULT_LORE) config.terminals = startAboardShip(config.terminals);
    config.upgrades.push("start-ship");
  }
  if (!config.upgrades.includes("airlock-closed")) {
    const airlock = config.terminals.find((t) => t.id === "airlock");
    if (config.stationName === "KESTREL-9" && airlock?.open && !airlock.requires) airlock.open = false;
    config.upgrades.push("airlock-closed");
  }
  if (!config.upgrades.includes("stress-2")) {
    for (const pc of config.crew) if ((pc.id === "varga" && pc.startStress === 4) || (pc.id === "moll" && pc.startStress === 1)) pc.startStress = 2;
    config.upgrades.push("stress-2");
  }
  if (!config.upgrades.includes("trauma-notes")) {
    const OLD = "Android: Fear saves as above; other crew's Fear saves are made at [−] when MOLL-7 panics.";
    const NEW = "Android: Fear saves as above; while MOLL-7 is close, other crew's Fear saves are made at [−].";
    for (const c of [config, saved.storyStart?.config].filter(Boolean)) {
      if (c.stationName !== "KESTREL-9") continue;
      for (const pc of c.crew || []) if (pc.id === "moll" && pc.notes === OLD) pc.notes = NEW;
    }
    config.upgrades.push("trauma-notes");
  }
  if (!config.upgrades.includes("cyan")) config.upgrades.push("cyan");
  if (!config.upgrades.includes("ship-cyan-2")) {
    for (const c of [config, saved.storyStart?.config].filter(Boolean)) {
      if (c.stationName !== "KESTREL-9") continue;
      if (c.theme === "cyan") c.theme = "green";
      const ship = (c.terminals || []).find((t) => t.id === "ship");
      if (ship && ship.theme === "amber") ship.theme = "cyan";
    }
    config.upgrades.push("ship-cyan", "ship-cyan-2");
  }
  for (const upgrade of ["portraits", "portraits-2"]) {
    if (config.upgrades.includes(upgrade)) continue;
    for (const m of config.cast) m.portrait ||= findCast(DEFAULT_CAST, m.name)?.portrait || "";
    for (const pc of config.crew) pc.portrait ||= DEFAULT_CREW.find((d) => d.id === pc.id && d.name === pc.name)?.portrait || "";
    config.upgrades.push(upgrade);
  }
  if (!config.upgrades.includes("no-pc-cast")) {
    for (const c of [config, saved.storyStart?.config].filter((x) => Array.isArray(x?.cast) && Array.isArray(x.crew))) {
      const norm = (n) => String(n || "").replace(/\s+/g, " ").trim().toLowerCase();
      const pcs = new Set(c.crew.map((p) => norm(p.name)).filter(Boolean));
      c.cast = c.cast.filter((m) => !pcs.has(norm(m.name)));
    }
    config.upgrades.push("no-pc-cast");
  }
  if (!config.upgrades.includes("intercom-colour")) {
    for (const list of [voices, saved.storyStart?.config?.voices].filter(Array.isArray)) {
      const v = list.find((x) => x.id === "intercom");
      if (v?.color === "#9fd3ff") v.color = "";
    }
    config.upgrades.push("intercom-colour");
  }
  if (!config.upgrades.includes("adversaries")) {
    for (const list of [voices, saved.storyStart?.config?.voices].filter(Array.isArray)) {
      for (const v of list) {
        if (v.adversary || !(v.id === "unknown" || v.name === "???")) continue;
        v.adversary = { revealed: false, picture: "" };
        if (v.name === "???" && config.stationName === "KESTREL-9") v.name = "THE COLD";
      }
    }
    config.upgrades.push("adversaries");
  }
  if (!config.upgrades.includes("connections-all")) {
    for (const c of [config, saved.storyStart?.config].filter(Boolean)) {
      if (c.stationName !== "KESTREL-9") continue;
      for (const v of c === config ? voices : c.voices || []) v.systems = ["*"];
      const ship = (c.terminals || []).find((t) => t.id === "ship");
      if (ship?.notes === OLD_SHIP_NOTES) ship.notes = SHIP_TERMINAL.notes;
    }
    config.upgrades.push("connections-all");
  }
  if (!config.upgrades.includes("the-cold")) {
    for (const list of [voices, saved.storyStart?.config?.voices].filter(Array.isArray)) {
      const v = list.find((x) => x.id === "unknown" && x.name === "THE ORGANISM");
      if (v) v.name = "THE COLD";
    }
    config.upgrades.push("the-cold");
  }
  if (!config.upgrades.includes("the-cold-picture")) {
    for (const list of [voices, saved.storyStart?.config?.voices].filter(Array.isArray)) {
      const v = list.find((x) => x.id === "unknown" && x.adversary && !x.adversary.picture);
      if (v && config.stationName === "KESTREL-9") Object.assign(v.adversary, DEFAULT_COLD);
    }
    config.upgrades.push("the-cold-picture");
  }
  if (!config.upgrades.includes("the-cold-picture-2")) {
    for (const list of [voices, saved.storyStart?.config?.voices].filter(Array.isArray)) {
      const v = list.find((x) => x.id === "unknown" && OLD_COLD_PICTURES.includes(x.adversary?.picture));
      if (v) Object.assign(v.adversary, DEFAULT_COLD);
    }
    config.upgrades.push("the-cold-picture-2");
  }
  if (!config.upgrades.includes("industrial-equipment")) {
    for (const crew of [config.crew, saved.storyStart?.config?.crew, saved.campaign?.crew]) renameSkill(crew);
    config.upgrades.push("industrial-equipment");
  }
  if (!config.upgrades.includes("cold-combat")) {
    for (const list of [voices, saved.storyStart?.config?.voices].filter(Array.isArray)) {
      const v = list.find((x) => x.id === "unknown" && x.name === "THE COLD" && x.adversary && !x.adversary.stats);
      if (v && config.stationName === "KESTREL-9") v.adversary.stats = structuredClone(COLD_STATS);
    }
    config.upgrades.push("cold-combat");
  }
  if (!config.upgrades.includes("faction-orders")) {
    for (const c of [config, saved.storyStart?.config].filter(Boolean)) if (typeof c.standingOrders === "string") c.standingOrders = stripFactionBrief(c.standingOrders);
    config.upgrades.push("faction-orders");
  }
  config.roomDocs = sanitizeRoomDocs(config.roomDocs);
  if (!config.upgrades.includes("room-docs")) {
    if (config.stationName === "KESTREL-9") {
      for (const c of [config, saved.storyStart?.config].filter(Boolean)) {
        const have = sanitizeRoomDocs(c.roomDocs);
        c.roomDocs = [...have, ...structuredClone(DEFAULT_ROOM_DOCS).filter((d) => !have.some((x) => x.id === d.id))];
      }
    }
    config.upgrades.push("room-docs");
  }
  const ss = saved.storyStart?.config;
  if (ss && (ss.lore === PREV_DEFAULT_LORE || ss.lore === LORE_V3)) ss.lore = DEFAULT_LORE;
  for (const d of [...(saved.config?.startDocs || []), ...(saved.handouts || []), ...(ss?.startDocs || [])]) {
    if (d?.id === WORK_ORDER.id && typeof d.text === "string") d.text = d.text.replace("SECOND CHANCE is slaved to station control", "SECOND CHANCE is locked-down to station control");
  }
  config.startDocs = Array.isArray(saved.config?.startDocs) ? saved.config.startDocs : [];
  if (!config.upgrades.includes("work-order")) {
    if (config.stationName === "KESTREL-9") {
      config.startDocs = [WORK_ORDER];
      saved.handouts = Array.isArray(saved.handouts) ? saved.handouts : [];
      if (!saved.handouts.some((h) => h.id === WORK_ORDER.id)) saved.handouts.unshift(structuredClone(WORK_ORDER));
    }
    config.upgrades.push("work-order");
  }
  if (!config.upgrades.includes("systems")) {
    const ship = config.terminals.find((t) => t.id === "ship" && !t.system);
    if (ship && config.stationName === "KESTREL-9") Object.assign(ship, SHIP_SYSTEM);
    config.upgrades.push("systems");
  }
  if (!voices.some((v) => v.id === BUILTIN.narrator)) voices.splice(Math.min(2, voices.length), 0, narratorVoice());
  for (const v of voices) if (v.id === BUILTIN.narrator) v.color = NARRATOR_WHITE;
  config.rooms = sanitizeRooms(config.rooms);
  if (!config.upgrades.includes("rooms") && config.stationName === "KESTREL-9") {
    for (const [id, plan] of Object.entries(DEFAULT_ROOMS)) config.rooms[id] ??= structuredClone(plan);
    config.map = config.map.split("\n").map((l) => (l.trim() === SHIP_DECK ? SHIP_DOCKED : l)).filter((l) => l.trim() !== SHIP_LINK).join("\n");
    if (saved.station) for (const [k, v] of Object.entries(ROOM_STATE)) saved.station[k] ??= structuredClone(v);
    config.upgrades.push("rooms");
  }
  let sounds = Array.isArray(saved.sounds) ? saved.sounds : [];
  const kit = kitSounds();
  if (!config.upgrades.includes("sound-kit") && kit.length === KIT_FILES.length) {
    sounds = [...kit.filter((k) => !sounds.some((s) => s.id === k.id)), ...sounds];
    config.upgrades.push("sound-kit");
  }
  return {
    config: { ...config, ...fixSelection(config), voices, mode: config.mode === "auto" ? "auto" : "review" },
    station: saved.station ?? base.station,
    log: Array.isArray(saved.log) ? saved.log.slice(-MAX_LOG) : [],
    whisper: String(saved.whisper ?? ""),
    roll: Array.isArray(saved.roll?.pcs) ? saved.roll : null,
    outcomeCheck: saved.outcomeCheck ?? null,
    offers: Array.isArray(saved.offers) ? saved.offers : [],
    newChars: Array.isArray(saved.newChars) ? saved.newChars : [],
    panicPlus: saved.panicPlus && typeof saved.panicPlus === "object" ? saved.panicPlus : {},
    sounds,
    builder: { messages: Array.isArray(saved.builder?.messages) ? saved.builder.messages.slice(-60) : [], draft: saved.builder?.draft ?? null },
    synopses: savedSynopses(saved),
    handouts: Array.isArray(saved.handouts) ? saved.handouts : [],
    found: Array.isArray(saved.found) ? saved.found.map(String) : [],
    localKeys: !!saved.localKeys,
    discordPlayers: saved.discordPlayers && typeof saved.discordPlayers === "object" ? saved.discordPlayers : {},
    streamKey: typeof saved.streamKey === "string" ? saved.streamKey : "",
    clocks: Array.isArray(saved.clocks) ? saved.clocks : [],
    storyStart: saved.storyStart && saved.storyStart.config ? saved.storyStart : null,
    campaign: saved.campaign ? sanitizeProgress(saved.campaign) : null,
    rationing: saved.rationing === true,
    shipFight: Array.isArray(saved.shipFight?.ships) && saved.shipFight.ships.length ? saved.shipFight : null,
    solo: saved.solo ? { ...saved.solo, phase: saved.solo.phase === "building" ? "pick" : saved.solo.phase, busy: "" } : null,
  };
}

const WORK_ORDER = { id: "doc-work-order-4471", title: "MAINTENANCE CREW ORDER: 4471-MAINT", text: "# HOLLIS-VANE EXTRACTION CO.\n## WORK ORDER 4471 - REACTOR SERVICE\n\n**VESSEL:** Penal tug SECOND CHANCE\n**ASSIGNED:** Convict maintenance crew (4)\n**STATION:** KESTREL-9, rimward ice platform\n**FILED:** 23 days prior - STATUS: OVERDUE\n**PRIORITY:** 2 / ROUTINE\n\n**TASK:** Service Deck 4 reactor. Core efficiency 70%. Rated minimum **99%**. Find the bleed, restore rated output.\n\n**TOOLS:** As issued at tender. Nothing is to be drawn from station stores.\n\n**ACCESS**\n- Airlock A inner door (Deck 1): **OVERRIDE CODE 4471-MAINT**. Entry logs to Administrator's console.\n- Reactor access, Deck 4: standard crew hatch.\n\n**DEPARTURE**\nSECOND CHANCE is locked-down to station control. She will not undock until HV-CORE verifies the reactor at **99% or better** and transmits departure clearance. No exceptions, no overrides.\n\n~~Hazard pay authorised for duration of job.~~\n\n**DO NOT** interfere with station operations. Do not alter Deck 3 cargo configuration.\n\nHV-CORE // verified // 4471-MAINT", to: "", at: 0 };

const KESTREL_PITCH = { title: "KESTREL-9", hook: "A convict maintenance crew docks at a rimward ice-mining station to fix its reactor. Nobody answers, the airlock is sealed, and their tug won't leave until the job is done.", tags: "station · the void · no way home", builtin: true };
const CAMPAIGN_PITCH = { title: "RIM HAULERS (campaign)", hook: "Four truckers, one old rig with a debt, and the long dark lanes of the Rim. Take jobs from port to port; the crew, the rig and every favour you owe carry from story to story.", tags: "campaign · freight · the Rim", builtin: true, campaign: "rim-haulers" };

const label = (field) => field[0].toUpperCase() + field.slice(1);
const SESSION_SETTINGS = new Set(["provider", "model", "effort", "mode", "agentEffects", "agentVariants", "agentCrew", "checkFirst", "talk", "playerVitals", "playerRolls", "panicScreens", "playerCreate", "createRerolls", "playerTerminals", "narrator", "coldOpen", "tts", "discordTalk", "upgrades"]);
const STORY_ACTIONS = new Set(["nextRound", "attack", "reload", "passTime", "hazard", "command", "inject", "note", "heard", "rollRequest", "rollFor", "offerRoll", "generate", "approve", "outcome", "handout", "clockStart"]);
const findCharacterId = (crew, name) => {
  const n = String(name || "").trim().toLowerCase();
  return n ? crew.find((c) => c.name.toLowerCase() === n || c.name.toLowerCase().includes(n))?.id || "" : "";
};
const clockText = (secs) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
const clampVol = (v) => Math.max(0, Math.min(1, Number(v) || 0));

export const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

function sameHash(a, b) {
  const x = Buffer.from(String(a), "hex"), y = Buffer.from(String(b), "hex");
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function setPath(obj, dotted, value) {
  const keys = dotted.split(".").filter(Boolean);
  if (!keys.length || keys.some((k) => k === "__proto__" || k === "constructor" || k === "prototype")) return;
  let cur = obj;
  for (const k of keys.slice(0, -1)) {
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  const v = String(value);
  cur[keys.at(-1)] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
}

const savedList = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
const UNDO_ARRAYS = ["entries", "effects", "crew", "cast", "revealed", "adversaries", "offers", "clocks", "handouts", "found", "moved", "altered", "hazardUnits", "hazardNeeds"];
const validUndo = (u) => u && typeof u === "object" && UNDO_ARRAYS.every((k) => Array.isArray(u[k])) && [u.station, u.deathSaves, u.ship].every((o) => o && typeof o === "object") && Array.isArray(u.ship.offers) && (u.rooms == null || typeof u.rooms === "object");
const restoreUndo = (v) => (Array.isArray(v) && v.length && v.length <= UNDO_CAP && v.every(validUndo) ? structuredClone(v) : []);

export class Session {
  constructor(saved, { onChange, onEnd }) {
    this.code = saved.code;
    this.tokenHash = saved.tokenHash;
    this.createdAt = saved.createdAt ?? Date.now();
    this.lastActive = saved.lastActive ?? Date.now();
    this.state = { ...migrateGame(saved.game ?? {}), pending: null, effects: [], playing: [] };
    this.builderBusy = "";
    this.campaignBusy = "";
    this.sectorVotes = new Map();
    this.sectorShown = false;
    this.synopsisBusy = "";
    this.handoutBusy = false;
    this.speech = new VoiceRelay();
    this.roomBusy = "";
    this.keys = {};
    if (this.state.localKeys) this.keys[LOCAL_KEYS] = true;
    this.sttKey = "";
    this.freeCalls = { day: "", count: 0 };
    this.sockets = new Set();
    this.nextId = this.state.log.reduce((m, e) => Math.max(m, e.id), 0) + 1;
    for (const e of this.state.log) delete e.queued;
    const tail = this.state.log.findLast((e) => e.kind !== "note" && e.kind !== "msg");
    if (tail?.kind === "player" && !this.state.log.some((e) => e.orphan && e.id > tail.id)) {
      this.state.log.push({ id: this.nextId++, kind: "note", text: `The server restarted before the agent answered ${tail.by || "a player"}'s last line ("${tail.text.slice(0, 60)}${tail.text.length > 60 ? "..." : ""}"). Press Generate to answer it.`, ts: Date.now(), orphan: true });
    }
    this.lastNet = this.state.log.findLast((e) => e.net !== "*")?.net || "";
    this.clockTimers = new Map();
    this.talkers = new Map();
    this.talkingSent = "|false";
    for (const c of this.state.clocks) this.scheduleClock(c);
    resumeMessages(this);
    this.genCounter = 0;
    this.playhead = 0;
    this.lineChain = Promise.resolve();
    this.undoStack = restoreUndo(saved.undoStack);
    this.delivering = null;
    this.rerun = false;
    this.hazardUnits = savedList(saved.hazardUnits);
    this.hazardNeeds = savedList(saved.hazardNeeds);
    this.syncHazards();
    if (saved.dropped?.effects || saved.dropped?.votes) {
      const what = [saved.dropped.effects && "screen effects ended", saved.dropped.votes && "the sector vote was cleared"].filter(Boolean).join(" and ");
      this.state.log.push({ id: this.nextId++, kind: "note", text: `The server restarted: ${what}.`, ts: Date.now() });
    }
    this.effectTimers = new Map();
    this.onChange = onChange;
    this.onEnd = onEnd;
    if (this.usesNeural()) warmNeural();
  }

  toJSON() {
    const { pending, effects, playing, ...game } = this.state;
    const dropped = { effects: this.state.effects.length > 0, votes: this.sectorVotes.size > 0 };
    return { code: this.code, tokenHash: this.tokenHash, createdAt: this.createdAt, lastActive: this.lastActive, game, undoStack: this.undoStack, hazardUnits: this.hazardUnits, hazardNeeds: this.hazardNeeds, ...(dropped.effects || dropped.votes ? { dropped } : {}) };
  }

  useLocalKeys() {
    this.state.localKeys = true;
    this.keys[LOCAL_KEYS] = true;
    this.touch();
  }

  checkToken(token) {
    return !!token && sameHash(hashToken(token), this.tokenHash);
  }
  streamKey() {
    if (!this.state.streamKey) { this.state.streamKey = crypto.randomBytes(12).toString("hex"); this.touch(); }
    return this.state.streamKey;
  }
  checkStreamKey(key) {
    return !!key && sameHash(hashToken(key), hashToken(this.streamKey()));
  }

  touch() {
    this.lastActive = Date.now();
    this.onChange(this);
  }

  get generating() {
    return this.state.pending?.status === "generating";
  }

  usesNeural() {
    return this.state.config.voices.some((v) => v.voice.engine === "neural");
  }

  attach(ws, role, hint = {}) {
    if (this.sockets.size >= MAX_SOCKETS) {
      ws.close(4029, "session full");
      return false;
    }
    ws.role = role;
    ws.lastInput = 0;
    this.sockets.add(ws);
    ws.character = null;
    ws.stream = role === "player" && !!hint.stream;
    const t = role === "player" && !ws.stream && this.state.config.terminals.find((x) => x.id === hint.terminal);
    if (t && reachable(t, this.state.station)) ws.terminal = t.id;
    ws.on("close", () => {
      this.sockets.delete(ws);
      this.speech.detach(ws);
      if (this.sectorVotes.delete(ws)) this.sectorSync();
      if (ws.character) this.crewChanged();
    });
    if (role === "dm") ws.send(JSON.stringify({ t: "state", state: this.dmView() }));
    else this.sendInit(ws);
    return true;
  }

  send(role, payload) {
    const data = JSON.stringify(payload);
    for (const c of this.sockets) if (c.role === role && c.readyState === 1) c.send(data);
  }
  toPlayers(p) { this.send("player", p); }
  sendHeader() { this.toPlayers({ t: "header", header: this.playerHeader() }); }
  netOfSocket(ws) { return netOf(this.state.config.terminals.find((t) => t.id === ws.terminal)); }
  screensAtTerminals() { return [...this.sockets].filter((c) => c.role === "player" && c.terminal); }
  occupiedNets() { return new Set(this.screensAtTerminals().map((c) => this.netOfSocket(c))); }
  voiceReaches(voiceId, net) {
    const ok = this.voiceNets(voiceId);
    return ok.includes(ALL_NET) || ok.includes(net);
  }
  defaultNet() {
    const nets = this.occupiedNets();
    return nets.size === 1 ? [...nets][0] : this.lastNet;
  }
  voiceNets(voiceId) {
    const exist = new Set(systemsOf(this.state.config).map((x) => x.net));
    const v = this.state.config.voices.find((x) => x.id === voiceId);
    const nets = (v?.systems ?? [""]).filter((n) => n === ALL_NET || exist.has(n));
    return nets.length ? nets : [ALL_NET];
  }
  routeLine(voiceId, net) {
    if (this.voiceReaches(voiceId, net)) return net;
    const ok = this.voiceNets(voiceId), occupied = this.occupiedNets(), here = this.defaultNet();
    return ok.find((n) => n === here) ?? ok.find((n) => occupied.has(n)) ?? ok[0];
  }
  roomOfSocket(ws) { return this.state.config.terminals.find((t) => t.id === ws.terminal)?.room || ""; }
  roomOfPc(id) {
    const ws = [...this.sockets].find((c) => c.role === "player" && c.character === id && c.terminal);
    return ws ? this.roomOfSocket(ws) : "";
  }
  closeTo(pc) { return closeCrew(pc, this.state.config.crew, (id) => this.roomOfPc(id)); }
  plusAvailable(pc) { return pc.className === "Teamster" && !this.state.panicPlus[pc.id]; }
  sees(ws, e) { return ws.stream || (shownOn(e.net, this.netOfSocket(ws)) && (!e.room || this.roomOfSocket(ws) === e.room)); }
  speaksOnScreens() {
    const c = this.state.config;
    return !!c.tts || (!!c.discordTalk && !discordLinked(this.code));
  }

  discordMoved() {
    this.sendHeader();
    this.syncDm();
  }

  seenByAnyone(entry) {
    const screens = [...this.sockets].filter((c) => c.role === "player" && !c.stream);
    return !screens.length || screens.some((c) => this.sees(c, entry));
  }
  toEntry(entry, p) { this.toPlayersIf((c) => this.sees(c, entry), p.entry ? { ...p, entry: playerEntry(p.entry) } : p); }
  toPlayersIf(pred, p) {
    const data = typeof p === "string" ? p : JSON.stringify(p);
    for (const c of this.sockets) if (c.role === "player" && c.readyState === 1 && pred(c)) c.send(data);
  }
  sendInit(ws) {
    ws.send(JSON.stringify({ t: "init", ...this.playerView(ws) }));
    if (this.sectorShown) ws.send(JSON.stringify(this.sectorMsg(ws)));
  }
  sectorTally(names) {
    const out = {};
    for (const [ws, id] of this.sectorVotes) (out[id] ||= []).push(names ? this.characterOf(ws)?.name || "A player" : 1);
    return out;
  }
  sectorMsg(ws) {
    const p = this.state.campaign, c = campaignById(p?.id);
    if (!c) return { t: "sector", hide: true };
    const votes = Object.fromEntries(Object.entries(this.sectorTally()).map(([id, v]) => [id, v.length]));
    return { ...sectorPayload(c, p), votes, mine: this.sectorVotes.get(ws) || "" };
  }
  sectorSync() {
    for (const ws of this.sockets) if (ws.role === "player" && ws.readyState === 1) ws.send(JSON.stringify(this.sectorShown ? this.sectorMsg(ws) : { t: "sector", hide: true }));
  }
  sectorVote(ws, id) {
    const p = this.state.campaign;
    if (!this.sectorShown || !p?.offered?.includes(id)) return;
    const was = this.sectorVotes.get(ws) === id;
    if (was) this.sectorVotes.delete(ws);
    else this.sectorVotes.set(ws, id);
    const c = campaignById(p.id), story = c?.stories.find((x) => x.id === id);
    const who = this.characterOf(ws)?.name || "A player";
    this.addLog("note", was ? `${who} took back their vote for ${story.title}.` : `${who} voted for the job ${story.title}.`);
    this.sectorSync();
    this.syncDm();
  }
  castDelivery(member, asked) {
    const voice = channelOf(this.state.config);
    const there = member.room && this.screensAtTerminals().find((x) => this.roomOfSocket(x) === member.room);
    if (there) return { voice, inPerson: true, room: member.room, net: this.netOfSocket(there) };
    return { voice, inPerson: false, room: "", net: this.routeLine(voice, asked) };
  }
  toNet(net, p) { this.toPlayersIf((c) => c.stream || shownOn(net, this.netOfSocket(c)), p); }
  initPlayers() {
    for (const c of this.sockets) if (c.role === "player" && c.readyState === 1) this.sendInit(c);
  }
  syncDm() {
    this.send("dm", { t: "state", state: this.dmView() });
    this.syncStreams();
    this.syncIso();
  }

  isoView() {
    const view = this.state.mapShown;
    if (!view) return null;
    return { view, station: playerStation(this.state.station), ...this.streamMap(), rooms: this.state.config.rooms };
  }
  syncIso() {
    const map = JSON.stringify(this.isoView());
    if (map === this.isoSent) return;
    this.isoSent = map;
    this.toPlayersIf(() => true, `{"t":"isoMap","map":${map}}`);
  }

  syncStreams() {
    for (const ws of this.sockets) {
      if (!ws.stream || ws.readyState !== 1) continue;
      const add = [], update = [];
      for (const e of this.state.log) {
        if (!PRIVATE_KINDS.has(e.kind)) continue;
        const was = ws.sent.get(e.id);
        if (was === undefined) add.push(e);
        else if (was !== e.text) update.push({ id: e.id, text: e.text });
        ws.sent.set(e.id, e.text);
      }
      if (add.length || update.length) ws.send(JSON.stringify({ t: "wardenLog", add: add.map(playerEntry), update }));
      const map = JSON.stringify(this.streamMap());
      if (map !== ws.mapSent) { ws.mapSent = map; ws.send(`{"t":"streamMap","map":${map}}`); }
    }
  }
  streamMap() {
    const people = {};
    for (const ws of this.sockets) {
      const room = ws.role === "player" && ws.character && this.roomOfSocket(ws);
      if (room && !(people[room] ||= []).includes(ws.character)) people[room].push(ws.character);
    }
    return { layout: this.state.config.map, people };
  }
  queueStreamSync() {
    if (this.streamSyncQueued) return;
    this.streamSyncQueued = true;
    setImmediate(() => { this.streamSyncQueued = false; this.syncStreams(); });
  }

  playerView(ws) {
    const net = ws ? this.netOfSocket(ws) : "";
    const log = ws?.stream
      ? this.state.log.filter((e) => !e.queued && !e.cut && e.kind !== "msg").map(playerEntry)
      : this.state.log.flatMap((e) => e.kind === "msg" ? msgView(e, ws) || [] : !PRIVATE_KINDS.has(e.kind) && !e.hidden && !e.queued && !e.cut && (ws ? this.sees(ws, e) : shownOn(e.net, net)) ? [playerEntry(e)] : []);
    if (ws?.stream) {
      ws.sent = new Map(log.filter((e) => PRIVATE_KINDS.has(e.kind)).map((e) => [e.id, e.text]));
      ws.mapSent = JSON.stringify(this.streamMap());
    }
    return {
      version: APP_VERSION,
      log,
      header: this.playerHeader(),
      effects: this.state.effects.filter((e) => e.net === undefined || ws?.stream || shownOn(e.net, net)),
      playing: this.state.playing.filter((p) => p.loop),
      crew: this.state.config.crew,
      conds: this.condMap(),
      played: this.played(),
      iso: this.isoView(),
      ...(ws?.stream ? { map: this.streamMap() } : {}),
      clocks: this.publicClocks(),
      handouts: this.handoutsFor(ws),
      solo: this.soloView(),
      claims: this.claims(),
      busy: !!this.state.pending,
      roll: this.publicRoll(),
    };
  }

  playerHeader() {
    const c = this.state.config;
    return {
      stationName: c.stationName,
      title: c.title || c.stationName,
      accessLevel: String(this.state.station.access_level ?? "GUEST"),
      theme: c.theme,
      tts: this.speaksOnScreens(),
      vitals: c.playerVitals,
      terminals: c.terminals.map((t) => ({ id: t.id, name: t.name, look: t.look, theme: t.theme, system: t.system, os: t.os, open: reachable(t, this.state.station) })),
      moveTerminals: c.playerTerminals,
      selfRolls: c.playerRolls,
      create: !!c.playerCreate,
      trauma: TRAUMA_RESPONSES,
      voices: Object.fromEntries(c.voices.map((v) => [v.id, { name: shownName(v), style: v.style, color: v.color, fx: v.fx, chunked: v.voice.engine === "neural" }])),
      portraits: Object.fromEntries((c.cast || []).filter((m) => m.portrait).map((m) => [m.name.toLowerCase(), m.portrait])),
      portraitCredit: [...(c.cast || []), ...c.crew].some((m) => m.portrait?.startsWith("kit/")),
      rig: this.rigView(),
      ship: shipPlayerView(this),
    };
  }

  // Downtime between stories (ticket 06): the rolls are Saves on the players' screens; downtime.js decides what they do.
  downtimeOf() {
    const p = this.state.campaign, c = campaignById(p?.id);
    if (!c) return null;
    const loc = c.locations.find((l) => l.id === p.at);
    return { ready: downtimeReady(p, this.state.config), port: loc?.name || "", portClass: loc?.portClass || "", shore: shoreText(loc?.portClass), treatments: treatmentList() };
  }

  dtFail(text) { this.send("dm", { t: "toast", level: "error", text }); }

  downtimeGo(msg) {
    const s = this.state, p = s.campaign;
    if (!p || !campaignById(p.id)) return;
    if (!downtimeReady(p, s.config)) return this.dtFail("Downtime comes between stories: finish a story first, and let the crew carry over.");
    if (s.roll?.status === "waiting") return this.dtFail("Finish the roll in progress first.");
    const kind = String(msg.kind || ""), o = msg.opts && typeof msg.opts === "object" ? msg.opts : {};
    const opts = { leisure: !!o.leisure, helped: !!o.helped, unsafe: !!o.unsafe, safe: !!o.safe };
    const ids = msg.pc === "all" ? s.config.crew.filter(playable).map((x) => x.id) : [String(msg.pc || "")];
    this.dtQueue = ids.map((id) => ({ id, kind, opts, auto: msg.pc === "all" }));
    this.nextDowntime();
  }

  // Starts the next queued downtime Save (skipping any the rules refuse). True if a roll is now waiting.
  nextDowntime() {
    const s = this.state, p = s.campaign, c = campaignById(p?.id), q = (this.dtQueue ||= []);
    while (c && q.length) {
      const e = q.shift(), pc = this.crewById(e.id);
      if (!pc) continue;
      const plan = planRoll(p, c, pc, e.kind, e.opts);
      if (!plan.ok) { this.dtFail(plan.error); this.addLog("note", `Downtime: ${plan.error}`); continue; }
      for (const l of plan.lines) this.addLog("note", l);
      for (const en of plan.entries) this.addLog("note", ledgerLine(p, en));
      if (plan.days) this.addLog("note", passDays(p, [s.config.crew, p.crew], plan.days).concat(`${plan.days} days pass (day ${p.downtime.day}).`).join(" "));
      if (plan.entries.length) this.moneySync();
      if (plan.days) this.crewChanged();
      mirror(p, pc);
      s.roll = sanitizeRequest(plan.request, s.config.crew);
      s.roll.downtime = { [pc.id]: plan.dt };
      this.addLog("note", `Roll called for ${pc.name}: ${[checkLabel(s.roll), s.roll.reason].filter(Boolean).join(" · ")}`);
      this.toPlayers({ t: "roll", roll: this.publicRoll() });
      this.syncDm();
      // "Everyone" rolls at once for the characters nobody is playing; the players at a screen roll their own.
      if (e.auto && !this.played().some((x) => x.id === pc.id)) {
        this.addLog("note", `${pc.name} isn't being played: the dice roll for them.`);
        this.rollFor(pc, null, { by: "warden" });
      }
      return true;
    }
    this.syncDm();
    return false;
  }

  settleDowntime(pc, dt, result) {
    const p = this.state.campaign, out = settleRoll(p, pc, dt, result);
    for (const l of out.lines) this.addLog("note", l);
    if (out.over) this.stressOver(pc, out.over);
    mirror(p, pc);
    this.crewChanged();
    return out;
  }

  downtimeSpread(msg) {
    const s = this.state, p = s.campaign, pc = this.crewById(String(msg.pc || "")), pend = p?.downtime.pending[pc?.id];
    if (!pend) return;
    const r = applyConversion(pc, pend.points, msg.alloc);
    if (!r.ok) return this.dtFail(r.error);
    delete p.downtime.pending[pc.id];
    this.addLog("note", `${pc.name}: Shore Leave converts ${pend.points} Stress into Save improvements: ${r.done.join(", ")}.`);
    mirror(p, pc);
    this.crewChanged();
  }

  downtimeTreat(msg) {
    const s = this.state, p = s.campaign, pc = this.crewById(String(msg.pc || ""));
    if (!p || !pc) return;
    if (!downtimeReady(p, s.config)) return this.dtFail("Treatments come between stories.");
    const r = treat(p, pc, String(msg.treatment || ""), { choice: String(msg.choice || ""), pay: String(msg.pay || "") });
    if (!r.ok) return this.dtFail(r.error);
    this.addLog("note", `${r.name} for ${pc.name} (${exact(r.cost)}), PSG 35.`);
    for (const l of r.lines) this.addLog("note", l);
    for (const en of r.entries) this.addLog("note", ledgerLine(p, en));
    if (r.days) this.addLog("note", passDays(p, [s.config.crew, p.crew], r.days).concat(`${r.days} days pass (day ${p.downtime.day}).`).join(" "));
    mirror(p, pc);
    if (r.days) this.crewChanged();
    this.moneySync();
  }

  downtimeDays(msg) {
    const s = this.state, p = s.campaign, n = Math.max(0, Math.min(365, Math.round(Number(msg.days) || 0)));
    if (!p || !n) return;
    const gone = passDays(p, [s.config.crew, p.crew], n);
    this.addLog("note", [`${n} day${n > 1 ? "s" : ""} pass (day ${p.downtime.day}).`, ...gone].join(" "));
    this.crewChanged();
  }

  resupplyOf() {
    const p = this.state.campaign, c = campaignById(p?.id);
    return c ? resupplyView(c, p) : null;
  }

  // The rig's fuel and stores for MARY's own terminals: live from the story's station state, else as saved between stories.
  rigView() {
    const p = this.state.campaign, c = campaignById(p?.id);
    if (!c) return null;
    const story = c.stories.find((x) => x.id === p.current), live = this.state.station?.rig;
    const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);
    const r = p.resources;
    return {
      name: c.ship.name, system: c.ship.system, transit: !!story && isTransit(story),
      fuel: story && live ? num(live.fuel_units, r.fuel) : r.fuel, capacity: TANK,
      stores: Object.fromEntries(STORES.map((k) => [k, story && live ? num(live[k], r.stores[k]) : r.stores[k]])),
      lifeSupport: String(live?.life_support ?? "ONLINE").toUpperCase(),
      rationing: !!this.state.rationing,
    };
  }

  dmView() {
    return {
      version: APP_VERSION,
      ...this.state,
      storyStart: undefined,
      storyStartedAt: this.state.storyStart?.at ?? null,
      claims: this.claims(),
      screens: this.screens(),
      canRetcon: this.undoStack.length,
      hazardWork: this.hazardWork(),
      hazardTypes: HAZARDS,
      conds: this.condMap(),
      effects: this.state.effects.filter((e) => this.effectRunning(e)),
      builderBusy: this.builderBusy,
      campaignBusy: this.campaignBusy,
      resupply: this.resupplyOf(),
      downtime: this.downtimeOf(),
      rig: this.rigView(),
      ships: shipDmView(this),
      sectorShown: this.sectorShown,
      sectorVotes: this.sectorTally(true),
      roomBusy: this.roomBusy,
      synopsisBusy: this.synopsisBusy,
      code: this.code,
      streamKey: this.streamKey(),
      providers: catalog(this.keys),
      discord: this.discordView(),
      allEffects: ALL_EFFECTS,
      rollOptions: { checks: CHECKS, skillLevels: SKILL_LEVELS },
      voiceOptions: { presets: PRESETS, fxParams: FX_PARAMS, variants: VARIANTS, styles: STYLES, engines: ENGINES, speakers: SPEAKERS },
      panicTable: PANIC_TABLE.slice(1),
      deathSaves: Object.fromEntries(Object.keys(this.state.deathSaves || {}).map((id) => [id, true])),
      weaponsOf: Object.fromEntries(this.state.config.crew.map((c) => [c.id, weaponsOf(c.items).map((w) => w.name)])),
      ammo: Object.fromEntries(this.state.config.crew.map((c) => [c.id, weaponsOf(c.items).filter((w) => w.shots).map((w) => ({ name: w.name, shots: w.shots, loaded: loaded(c, w), spare: magazines(c, w) }))])),
      traumaResponses: TRAUMA_RESPONSES,
    };
  }

  addLog(kind, text, extra = {}) {
    const { net = this.defaultNet(), ...rest } = extra;
    const entry = { id: this.nextId++, kind, text, ts: Date.now(), ...(net ? { net } : {}), ...rest };
    const adv = kind === "entity" && this.state.config.voices.find((v) => v.id === entry.entity && v.adversary);
    if (adv) entry.shownAs = shownName(adv);
    this.state.log.push(entry);
    this.delivering?.entries.push(entry.id);
    if (this.state.log.length > MAX_LOG) this.state.log.splice(0, this.state.log.length - MAX_LOG);
    if (SPOKEN_KINDS.has(kind)) this.pregenerate([entry]);
    if (kind === "player") this.toNet(entry.net || "", { t: "line", entry: playerEntry(entry) });
    else if (PRIVATE_KINDS.has(kind)) this.queueStreamSync();
    else if (kind !== "msg") {
      entry.queued = true;
      this.lineChain = this.lineChain.then(() => this.scheduleLine(entry)).catch((err) => console.error(`[${this.code}] line schedule failed:`, err));
    }
    this.touch();
    return entry;
  }

  setBusy(busy) { this.toPlayers({ t: "busy", busy }); }
  dropReply() {
    this.genCounter++;
    this.state.pending = null;
    this.setBusy(false);
  }
  freshGame(extra = {}) {
    const s = this.state;
    this.genCounter++;
    this.playhead = 0;
    this.endAllEffects();
    this.stopSounds();
    this.clearClocks();
    this.state = { ...defaultGame(this.keys), sounds: s.sounds, builder: s.builder, campaign: s.campaign && { ...s.campaign, current: "" }, pending: null, effects: [], playing: [], ...extra, localKeys: s.localKeys, streamKey: s.streamKey };
  }

  holdForWarden(raw, note) {
    const s = this.state;
    const oc = { needed: true, attempt: String(raw.attempt || "").slice(0, 140), suggested_check: CHECKS[raw.suggested_check] || raw.suggested_check === PANIC ? raw.suggested_check : "none", advantage: ["advantage", "disadvantage"].includes(raw.advantage) ? raw.advantage : "none", why: String(raw.why || "").slice(0, 300), on_success: String(raw.on_success || "").slice(0, 200), on_failure: String(raw.on_failure || "").slice(0, 200) };
    s.outcomeCheck = { ...oc, id: Date.now().toString(36), at: Date.now(), held: true };
    this.addLog("note", `⚖ Your call (players see nothing yet): ${oc.attempt || "(unspecified)"}${suggestion(oc)}`);
    if (note) this.addLog("note", `Agent: ${note}`);
    s.pending = null;
    this.setBusy(true);
    this.touch();
    this.syncDm();
    if (s.solo?.phase === "play") this.soloRule(s.outcomeCheck);
  }

  interruptComms(net = "") {
    const now = Date.now();
    const cut = [], trimmed = [];
    let elsewhere = now;
    for (const e of this.state.log) {
      if (PRIVATE_KINDS.has(e.kind) || e.kind === "player" || e.kind === "msg" || e.cut || e.interrupted) continue;
      if (!shownOn(e.net, net)) { if (e.timing?.end > elsewhere) elsewhere = e.timing.end; continue; }
      const t = e.timing;
      if (e.queued || (t && t.speakAt > now)) { e.cut = true; cut.push(e.id); continue; }
      if (!t || (t.end ?? Infinity) <= now) continue;
      const { chunked } = this.lineVoice(e);
      const keep = (text, parts) => {
        const n = parts.filter((p) => p.at <= now).length;
        return chunked ? `${speechParts(text).slice(0, n).join("\n")} —` : `${text} —`;
      };
      e.text = keep(e.text, t.versions[0] || []);
      (e.variants || []).forEach((v, i) => { v.text = keep(v.text, t.versions[i + 1] || []); });
      t.versions = t.versions.map((ps) => ps.filter((p) => p.at <= now));
      t.end = now;
      e.interrupted = true;
      trimmed.push(e.id);
    }
    if (!cut.length && !trimmed.length) return;
    for (const fx of [...this.state.effects]) if (fx.atEntry && cut.includes(fx.atEntry)) this.endEffect(fx.id);
    this.playhead = Math.max(now, elsewhere);
    this.toPlayers({ t: "interrupt", at: now, cut, trimmed });
    discordCut(this.code);
    this.addLog("note", `A player cut off comms${cut.length ? `: ${cut.length} line${cut.length > 1 ? "s" : ""} unsaid` : ""}.`);
  }

  lineVoice(e) {
    const voice = SPOKEN_KINDS.has(e.kind) ? voiceFor(this.state.config.voices, e) : null;
    return { voice, chunked: !!e.character || voice?.voice.engine === "neural" };
  }
  async scheduleLine(entry) {
    const PIECE_GAP = 250, LINE_GAP = 150;
    const c = this.state.config;
    const talk = !!c.discordTalk && SPOKEN_KINDS.has(entry.kind) && discordLinked(this.code) && this.seenByAnyone(entry);
    const LEAD = talk ? 1500 : 700;
    const screens = this.speaksOnScreens();
    const spoken = (screens || talk) && SPOKEN_KINDS.has(entry.kind);
    const { voice, chunked } = this.lineVoice(entry);
    const base = voice ? speakingVoice(c, entry) : null;
    const fx = entry.inPerson ? {} : voice?.fx || {};
    const texts = [entry.text, ...(entry.variants || []).map((v) => v.text)];
    const pieces = texts.map((t) => (!t ? [] : chunked ? speechParts(t) : [t]));
    const jobs = pieces.map((ps) => ps.map((p) => (spoken ? this.speech.speak(p, base, fx).catch(() => null) : Promise.resolve(null))));
    const wavs = texts.map(() => []);
    const withAudio = () => ({ ...entry, timing: { ...entry.timing, versions: entry.timing.versions.map((ps, v) => ps.map((p) => ({ ...p, wav: wavs[v][p.i] }))) } });
    const beat = Math.max(0, ...(entry.cues || []).filter((x) => x.hold).map((x) => Math.min(10, x.seconds || 3) * 1000));
    const hold = beat ? beat + 400 : 0;
    const at = Math.max(this.playhead, Date.now() + LEAD);
    const timing = { at, speakAt: at + hold, versions: texts.map(() => []) };
    const cursors = texts.map(() => timing.speakAt);
    const live = () => this.state.log.includes(entry) && !entry.cut && !entry.interrupted;
    let sent = false;
    const most = Math.max(0, ...pieces.map((p) => p.length));
    for (let i = 0; i < most; i++) {
      if (entry.cut || entry.interrupted) break;
      for (let v = 0; v < texts.length; v++) {
        if (i >= pieces[v].length) continue;
        const clip = await jobs[v][i];
        if (clip && screens) wavs[v][i] = clip.wav.toString("base64");
        const dur = clip ? Math.round(clip.seconds * 1000) : Math.min(6000, 400 + pieces[v][i].length * 18);
        const part = { i, at: Math.max(cursors[v], Date.now() + LEAD), dur, audio: !!clip && screens, last: i === pieces[v].length - 1, ...(clip?.composed ? { composed: true } : {}) };
        if (talk && v === 0 && clip && live()) discordSay(this.code, clip.wav, clip.composed ? null : fx, part.at);
        cursors[v] = part.at + dur + PIECE_GAP;
        timing.versions[v].push(part);
        if (sent && live()) this.toEntry(entry, { t: "part", id: entry.id, v, part: { ...part, wav: wavs[v][i] } });
      }
      if (!sent) {
        sent = true;
        if (entry.cut) break;
        entry.timing = timing;
        delete entry.queued;
        if (live()) this.toEntry(entry, { t: "line", entry: withAudio() });
      }
    }
    if (!sent && !entry.cut) {
      entry.timing = timing;
      delete entry.queued;
      if (live()) this.toEntry(entry, { t: "line", entry });
    }
    if (entry.cut || entry.interrupted) return;
    timing.end = Math.max(timing.speakAt, ...cursors.map((x) => x - PIECE_GAP));
    if (live()) this.toEntry(entry, { t: "lineEnd", id: entry.id, end: timing.end });
    this.playhead = timing.end + LINE_GAP;
  }

  claims() {
    const out = {};
    for (const ws of this.sockets) if (ws.role === "player" && ws.character) out[ws.character] = (out[ws.character] || 0) + 1;
    return out;
  }

  played() {
    const out = new Map();
    for (const ws of this.sockets) if (ws.role === "player" && ws.character && !out.has(ws.character)) out.set(ws.character, "");
    for (const p of Object.values(this.state.discordPlayers || {})) if (p.crew) out.set(p.crew, p.name || "");
    return this.state.config.crew.filter((c) => out.has(c.id)).map((c) => ({ id: c.id, by: out.get(c.id) }));
  }

  // A character newly dead or retired goes on the memorial; the dead player's screen flatlines and offers a final transmission.
  noteEndings() {
    const s = this.state, c = campaignById(s.campaign?.id);
    const where = (c && s.campaign.current && c.stories.find((x) => x.id === s.campaign.current)?.title) || s.config.title || s.config.stationName;
    for (const pc of settleEndings(s.config.crew, where)) {
      this.addLog("note", `${pc.name} ${pc.cond?.dead ? `died: ${pc.cond.dead}` : "retired"}. Their file goes on the memorial (High Score ${pc.highScore}).`);
      if (pc.cond?.dead) this.toPlayersIf((w) => w.character === pc.id, { t: "flatline", id: pc.id });
    }
    this.syncCampaignCrew();
  }

  // The dead character's last line, spoken on every screen in a voice of their own.
  finalWords(ws, raw) {
    const pc = this.characterOf(ws), text = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 240);
    if (!pc || !text || !pc.cond?.dead || pc.finalWords) return;
    pc.finalWords = text;
    const cfg = this.state.config, voice = channelOf(cfg), kind = kindOf(voice);
    this.addLog(kind, text, { source: "final", net: ALL_NET, character: pc.name, voiceSpeaker: finalVoice(pc, cfg.cast), ...(kind === "entity" ? { entity: voice } : {}) });
    this.crewChanged();
  }

  // End session: High Score (PSG 18.3, sessions survived; no effect on play) goes up by 1 for each living character.
  endNight() {
    const s = this.state;
    this.syncCampaignCrew();
    const up = endSession(s.config.crew);
    if (s.campaign) { endSession(s.campaign.crew); s.campaign.sessions = (s.campaign.sessions || 0) + 1; }
    s.panicPlus = {};
    this.addLog("note", `Game night ended. High Score +1: ${up.map((c) => `${c.name} (${c.highScore})`).join(", ") || "nobody is alive"}. (PSG 18.3: it counts sessions survived and changes no roll.)`);
    this.crewChanged();
  }

  crewChanged() {
    if (this.state.campaign) crewIntoCampaign(this.state.campaign, this.state.config.crew);
    this.noteEndings();
    this.toPlayers({ t: "crew", crew: this.state.config.crew, conds: this.condMap(), claims: this.claims(), played: this.played() });
    this.syncDm();
    const x = this.state.solo;
    if (x?.phase === "play" && !x.opened && Object.keys(this.claims()).length) this.soloOpen();
  }

  // During a story, who is dead or retired (and their last words) is mirrored into the campaign's crew copy, so it never holds a dead character as alive.
  syncCampaignCrew() {
    const p = this.state.campaign;
    if (!p?.current) return;
    for (const pc of this.state.config.crew) {
      const q = p.crew.find((x) => x.id === pc.id);
      if (!q) continue;
      q.cond = { ...(q.cond || newCond()), dead: pc.cond?.dead || "" };
      Object.assign(q, { retired: !!pc.retired, endedIn: pc.endedIn || "", finalWords: pc.finalWords || "" });
    }
  }

  // The campaign's money lives on its own sheets; the story's copies follow it.
  moneySync() {
    const p = this.state.campaign;
    if (!p) return;
    for (const pc of this.state.config.crew) {
      const q = p.crew.find((x) => x.id === pc.id);
      if (q) pc.credits = q.credits;
    }
    this.crewChanged();
  }

  crewById(id) { return this.state.config.crew.find((c) => c.id === id); }
  characterOf(ws) { return this.crewById(ws.character) || null; }

  handlePlayer(ws, msg) {
    if (ws.stream && msg.t !== "ping") return;
    if (msg.t === "pilot") return this.pilotAuth(ws, msg.token);
    if (String(msg.t).startsWith("pilot")) return ws.pilot && this.handlePilot(ws, msg);
    if (msg.t === "input" && this.state.solo && this.state.solo.phase !== "play") return;
    if (["input", "roll", "selfRoll", "vitals", "msg"].includes(msg.t)) {
      const gone = this.characterOf(ws);
      if (gone && !playable(gone)) return ws.send(JSON.stringify({ t: "rollError", text: `${gone.name} is ${gone.cond?.dead ? "dead" : "retired"}: no more actions. Only final words are allowed.` }));
      this.storyBegins();
    }
    if (msg.t === "roll") return this.resolveRoll(ws, msg);
    if (msg.t === "ping") return ws.send(JSON.stringify({ t: "pong", c: msg.c, s: Date.now() }));
    if (msg.t === "sectorVote") return this.sectorVote(ws, String(msg.story || ""));
    if (msg.t === "finalWords") return this.finalWords(ws, msg.text);
    if (msg.t === "terminal") return this.playerTerminal(ws, msg.id, "player");
    if (msg.t === "msg") {
      const now = Date.now();
      if (now - (ws.lastMsg || 0) < PLAYER_INPUT_GAP_MS) return;
      ws.lastMsg = now;
      return sendCrewMessage(this, ws, msg.to, msg.text);
    }
    if (msg.t === "vitals") return this.playerVitals(ws, msg);
    if (msg.t === "shipStation" || msg.t === "shipMove" || msg.t === "shipFire") return shipPlayer(this, ws, msg);
    if (msg.t === "selfRoll") return this.selfRoll(ws, msg);
    if (String(msg.t).startsWith("cg")) return handleChargen(this, ws, msg);
    if (msg.t === "claim") {
      const was = ws.character;
      ws.character = this.state.config.crew.some((c) => c.id === msg.id) ? msg.id : null;
      if (ws.character !== was && this.state.log.some((e) => e.kind === "msg" && msgView(e, ws))) this.sendInit(ws);
      else ws.send(JSON.stringify({ t: "handouts", handouts: this.handoutsFor(ws) }));
      return this.crewChanged();
    }
    if (msg.t !== "input") return;
    const text = String(msg.text || "").slice(0, 1000).trim();
    if (!text || this.isLockedOut()) return;
    const now = Date.now();
    if (now - ws.lastInput < PLAYER_INPUT_GAP_MS) return;
    ws.lastInput = now;
    track("PlayerInput");
    this.interruptComms(this.netOfSocket(ws));
    const pc = this.characterOf(ws);
    const term = this.state.config.terminals.find((t) => t.id === ws.terminal);
    this.lastNet = netOf(term);
    this.addLog("player", text, { ...(pc ? { by: pc.name } : {}), ...(term ? { at: term.name } : {}) });
    this.requestReply();
  }

  isLockedOut() {
    return this.state.effects.some((e) => e.type === "lockout" && this.effectRunning(e));
  }

  effectRunning(e) {
    if (!e.atEntry) return true;
    const t = this.state.log.find((x) => x.id === e.atEntry)?.timing;
    if (!t) return false;
    const start = e.when === "after" ? t.end ?? Infinity : t.at;
    const now = Date.now();
    return now >= start && (!e.seconds || now < start + e.seconds * 1000);
  }

  handleDm(msg, ws) {
    const s = this.state;
    if (String(msg.t).startsWith("ship")) return shipDm(this, msg);
    if (STORY_ACTIONS.has(msg.t)) this.storyBegins();
    const action = WARDEN_ACTIONS[msg.t];
    if (action) track("WardenAction", { Action: action });
    switch (msg.t) {
      case "config": {
        const allowed = ["stationName", "lore", "secrets", "standingOrders", "mode", "provider", "model", "effort", "agentEffects", "agentVariants", "agentCrew", "checkFirst", "talk", "playerVitals", "playerRolls", "panicScreens", "playerCreate", "createRerolls", "playerTerminals", "narrator", "coldOpen", "tts", "discordTalk", "theme", "map"];
        for (const k of allowed) if (k in (msg.patch || {})) s.config[k] = msg.patch[k];
        s.config.mode = s.config.mode === "review" ? "review" : "auto";
        s.config.map = String(s.config.map ?? "").slice(0, 4000);
        s.config.discordTalk = !!s.config.discordTalk;
        if (s.config.discordTalk && "discordTalk" in msg.patch) s.config.tts = false;
        if ("discordTalk" in msg.patch) setDiscordTalk(this.code, s.config.discordTalk);
        if ("provider" in msg.patch && !("model" in msg.patch)) Object.assign(s.config, { model: "", effort: "" });
        else if ("model" in msg.patch && !("effort" in msg.patch)) s.config.effort = "";
        Object.assign(s.config, fixSelection(s.config));
        this.sendHeader();
        break;
      }
      case "apiKey": {
        const p = getProvider(msg.provider);
        if (!p || p.serverKeyOnly) { rememberSecret(msg.key); break; }
        const key = String(msg.key || "").trim();
        rememberSecret(key);
        if (!key) delete this.keys[p.id];
        else if (looksLikeKey(p.id, key)) this.keys[p.id] = key;
        else {
          this.send("dm", { t: "toast", level: "error", text: `Not a valid ${p.label} key (expected ${p.keyHint}).` });
          return;
        }
        if (key && !keyFor(s.config.provider, this.keys)) Object.assign(s.config, defaultSelection(this.keys));
        break;
      }
      case "voices":
        s.config.voices = sanitizeVoices(msg.voices);
        if (this.usesNeural()) warmNeural();
        this.sendHeader();
        break;
      case "adversary": {
        const v = s.config.voices.find((x) => x.id === msg.id && x.adversary);
        const p = msg.patch || {};
        if (!v) break;
        if (typeof p.name === "string" && p.name.trim()) v.name = p.name.trim().slice(0, 40);
        if (typeof p.persona === "string") v.persona = p.persona.slice(0, 8000);
        if (typeof p.color === "string" && /^#[0-9a-f]{6}$/i.test(p.color)) v.color = p.color;
        if (typeof p.preset === "string" && PRESETS[p.preset]) Object.assign(v, fromPreset(p.preset));
        if (typeof p.picture === "string") v.adversary.picture = /^[a-f0-9]{12}\.(png|jpg|webp|gif)$/.test(p.picture) || PICTURE_LINK.test(p.picture.trim()) ? p.picture.trim() : "";
        if (typeof p.credit === "string") v.adversary.credit = p.credit.replace(/\s+/g, " ").trim().slice(0, 200);
        if (p.stats && typeof p.stats === "object") {
          const merged = { ...v.adversary.stats, ...p.stats };
          if (p.stats.wounds > 0 && p.stats.dead === undefined) delete merged.dead;
          v.adversary.stats = sanitizeStats(merged);
        }
        if (typeof p.revealed === "boolean" && p.revealed !== v.adversary.revealed) {
          v.adversary.revealed = p.revealed;
          this.addLog("note", p.revealed ? `Adversary revealed: players now know ${v.name} by name.` : `${v.name} hidden again: players see ???.`);
        }
        s.config.voices = sanitizeVoices(s.config.voices);
        this.sendHeader();
        break;
      }
      case "adversaryAdd":
        s.config.voices = sanitizeVoices([...s.config.voices, newAdversary()]);
        break;
      case "adversaryDel":
        s.config.voices = s.config.voices.filter((x) => !(x.id === msg.id && x.adversary));
        break;
      case "adversaryShow": {
        const v = s.config.voices.find((x) => x.id === msg.id && x.adversary);
        if (!v?.adversary.picture) break;
        this.revealAdversaries([v.id]);
        const pic = v.adversary.picture;
        this.toPlayers({ t: "showImage", title: v.name, src: this.pictureSrc(pic), credit: v.adversary.credit || "" });
        this.addLog("note", `Showed the players ${v.name}.`);
        break;
      }
      case "panicShow": {
        const n = Math.round(Number(msg.n));
        const mine = s.config.crew.filter((x) => [...this.sockets].some((w) => w.role === "player" && w.character === x.id));
        if (n >= 1 && n <= 20) for (const pc of mine) this.panicScreens(pc, n, n === 18 ? "Compounding problems (7: Nightmares + 9: Deflated)" : "", { force: true });
        break;
      }
      case "castPanic": {
        const member = s.config.cast.find((m) => m.id === msg.id);
        if (member) this.castPanic(member, "warden");
        break;
      }
      case "cast":
        s.config.cast = sanitizeCast(msg.cast);
        if (s.config.voices.some((v) => v.id === msg.channel)) s.config.castChannel = msg.channel;
        this.sendHeader();
        break;
      case "station":
        if (msg.station && typeof msg.station === "object" && !Array.isArray(msg.station)) s.station = msg.station;
        this.sendHeader();
        break;

      case "generate":
        this.generate(msg.steer);
        return;
      case "command": {
        const text = String(msg.text || "").trim().slice(0, 4000);
        if (!text) break;
        this.addLog("warden", text);
        this.generate();
        break;
      }
      case "approve":
        if (!s.pending || s.pending.status !== "ready") break;
        this.logDirectives(s.pending.directives);
        const { lines, station_changes, crew_changes, effects, ...kept } = s.pending.reply || {};
        this.deliver({ ...kept, ...msg.reply }, "agent");
        s.pending = null;
        this.setBusy(false);
        break;
      case "discard":
        this.dropReply();
        break;
      case "inject": {
        let text = String(msg.text || "").trim().slice(0, 4000);
        if (!text) break;
        if (msg.cast) {
          const member = s.config.cast.find((m) => m.id === msg.cast);
          if (!member) break;
          const d = this.castDelivery(member, netNamed(s.config, msg.system) ?? this.defaultNet());
          const kind = kindOf(d.voice);
          this.introduce(d.voice, d.net, { inPerson: d.inPerson });
          this.addLog(kind, sentenceLines(text), { source: "dm", net: d.net, ...(kind === "entity" ? { entity: d.voice } : {}), character: member.name, ...(d.inPerson ? { inPerson: true, room: d.room } : {}) });
          if (msg.clearPending) this.dropReply();
          break;
        }
        const as = msg.as === "system" ? BUILTIN.broadcast : msg.as || BUILTIN.terminal;
        if (this.speaksBySentence(as)) text = sentenceLines(text);
        if (!s.config.voices.some((v) => v.id === as)) break;
        const kind = kindOf(as);
        const asked = netNamed(s.config, msg.system) ?? this.defaultNet();
        const net = this.routeLine(as, asked);
        if (net !== asked) this.send("dm", { t: "toast", level: "info", text: `${s.config.voices.find((v) => v.id === as)?.name} ${asked === ALL_NET ? "isn't on every system" : `isn't on ${systemName(s.config, asked)}`}. Sent to ${systemName(s.config, net)}.` });
        this.introduce(as, net);
        this.addLog(kind, text, { source: "dm", net, ...(kind === "entity" ? { entity: as } : {}) });
        if (msg.clearPending) this.dropReply();
        break;
      }
      case "heard":
        return this.hearTable({ text: msg.text, warden: true });
      case "voiceEngine":
        if (msg.on) this.speech.attach(ws, { neural: msg.neural });
        else this.speech.detach(ws);
        return;
      case "spokenFailed":
        this.speech.failed(msg.id);
        return;
      case "sttKey": {
        const key = String(msg.key || "").trim();
        rememberSecret(key);
        if (key && !/^gsk_[A-Za-z0-9]{20,}$/.test(key)) {
          this.send("dm", { t: "toast", level: "error", text: "Not a valid Groq key (expected gsk_…)." });
          return;
        }
        this.sttKey = key;
        break;
      }
      case "discordStop":
        stopListening(this.code, "Discord: stopped. The bot left the voice channel.");
        break;
      case "note": {
        const text = String(msg.text || "").trim().slice(0, 4000);
        if (text) this.aside(text);
        break;
      }
      case "effect":
        this.startEffect(msg.effect, "dm");
        break;
      case "clearEffect":
        this.endEffect(msg.id);
        break;
      case "clearEffects":
        this.endAllEffects();
        break;
      case "deleteEntry":
        s.log = s.log.filter((e) => e.id !== msg.id);
        this.initPlayers();
        break;
      case "clearScreen":
        for (const e of s.log) e.hidden = true;
        this.playhead = 0;
        this.initPlayers();
        break;
      case "resetSession":
        this.restartStory();
        { const start = s.config.terminals.find((t) => reachable(t, s.station));
          if (start) for (const ws of this.sockets) if (ws.role === "player" && ws.terminal) { ws.terminal = null; this.playerTerminal(ws, start.id, "warden"); } }
        break;
      case "rollRequest": {
        try {
          s.roll = sanitizeRequest(msg.roll, s.config.crew);
        } catch (err) {
          this.send("dm", { t: "toast", level: "error", text: err.message });
          break;
        }
        if (msg.fromOutcome) {
          const oc = s.outcomeCheck;
          if (oc?.on_success || oc?.on_failure) s.roll.stakes = { success: oc.on_success || "", failure: oc.on_failure || "" };
          const trim = (t) => String(t || "").trim().replace(/[.\s]+$/, "");
          const stakes = [oc?.on_success && `on a success, ${trim(oc.on_success)}`, oc?.on_failure && `on a failure, ${trim(oc.on_failure)}`].filter(Boolean);
          if (stakes.length) this.addLog("warden", `Stakes for this roll (narrate the result by them): ${stakes.join("; ")}.`);
          s.outcomeCheck = null;
          this.setBusy(false);
        }
        const who = s.roll.all ? "everyone" : s.roll.pcs.map((p) => p.name).join(", ");
        this.addLog("note", `Roll called for ${who}: ${[checkLabel(s.roll), skillLabel(s.roll), s.roll.range && `${s.roll.weapon ? `${s.roll.weapon} at ` : ""}${RANGE_LABELS[s.roll.range]} Range`, s.roll.reason].filter(Boolean).join(" · ")}`);
        this.toPlayers({ t: "roll", roll: this.publicRoll() });
        break;
      }
      case "rollFor": {
        const pc = this.crewById(msg.pc);
        if (pc && s.roll?.status === "waiting" && s.roll.pcs.some((p) => p.id === pc.id) && !s.roll.results[pc.id]) this.rollFor(pc, null, { by: "warden" });
        return;
      }
      case "offerRoll": {
        const o = s.offers.find((x) => x.id === msg.id);
        if (!o) break;
        if (s.roll?.status === "waiting") {
          this.send("dm", { t: "toast", level: "error", text: "Finish the roll in progress first." });
          break;
        }
        s.offers = s.offers.filter((x) => x !== o);
        this.handleDm({ t: "rollRequest", roll: o.roll });
        break;
      }
      case "offerDismiss":
        s.offers = s.offers.filter((x) => x.id !== msg.id);
        break;
      case "rollCancel":
        this.dtQueue = [];
        if (s.roll?.status === "waiting" && Object.keys(s.roll.results).length) {
          const missing = s.roll.pcs.filter((p) => !s.roll.results[p.id]).map((p) => p.name);
          this.addLog("note", `Roll closed without ${missing.join(", ")}.`);
          this.finishRoll();
          return;
        }
        if (s.roll?.status === "waiting") this.addLog("note", "Roll cancelled.");
        { const was = s.roll;
          s.roll = null;
          this.toPlayers({ t: "roll", roll: null });
          if (was?.hazard) this.pumpHazards(); }
        break;
      case "retcon":
        this.retcon();
        break;
      case "nextRound":
        this.advanceRound();
        break;
      case "passTime":
        this.passTime(msg.hours);
        break;
      case "hazard":
        this.setHazard(msg.room, msg.type, msg.level, msg.supply);
        break;
      case "hazardTrigger": {
        const h = s.station.hazards?.[roomId(msg.room)];
        if (h) { this.hazardUnits.push({ u: "event", room: roomId(msg.room), type: h.type }); this.pumpHazards(); }
        break;
      }
      case "hazardRollAll":
        this.rollAllHazard();
        break;
      case "condition":
        this.crewCondition(msg.pc, msg.action, msg.value);
        break;
      case "reload":
        this.reloadWeapon(this.crewById(msg.pc), msg.weapon);
        break;
      case "rationing":
        s.rationing = !!msg.on;
        this.addLog("note", s.rationing ? "Rationing (food and water are cut off): hunger is tracked every hour and the penalties apply (PSG 32.5)." : "Rationing ended: food and water are no longer tracked.");
        this.syncDm();
        this.sendHeader();
        break;
      case "attack": {
        const a = msg.attack || {};
        if (a.side === "crew") this.crewAttack({ pc: this.crewById(a.pc), weapon: a.weapon, target: a.target, damageAdv: a.damageAdv, range: a.range });
        else this.creatureAttack({ by: a.by, attack: a.attack, target: a.target });
        if (s.log.at(-1)?.combat) this.requestReply();
        this.syncDm();
        break;
      }
      case "dealtWith": {
        const pc = this.crewById(msg.pc);
        if (!pc) break;
        stabilise(pc);
        delete s.deathSaves?.[pc.id];
        this.addLog("note", `${pc.name}: no longer dying or due a Death Save (dealt with by the Warden).`);
        this.crewChanged();
        break;
      }
      case "revealDeathSave": {
        const pc = this.crewById(msg.pc);
        if (pc && this.revealDeathSave(pc) && this.hasKey()) this.requestReply();
        break;
      }
      case "repairArmor": {
        const pc = this.crewById(msg.pc);
        if (!pc?.armor?.destroyed) break;
        pc.armor.destroyed = false;
        this.addLog("note", `${pc.name}: ${pc.armor.name} repaired.`);
        this.crewChanged();
        break;
      }
      case "outcome": {
        const oc = s.outcomeCheck;
        if (!oc || !["success", "failure"].includes(msg.verdict)) break;
        s.outcomeCheck = null;
        const verdict = msg.verdict === "success" ? "SUCCEEDS" : "FAILS";
        const stake = msg.verdict === "success" ? oc.on_success : oc.on_failure;
        this.addLog("warden", `The players' attempt (${oc.attempt || "their last action"}) ${verdict}.${stake ? ` As the stakes said: ${stake}` : ""} Narrate the result in character and apply any station changes.${msg.verdict === "success" ? "" : " Fail forward: even so, the story moves on (see FAIL FORWARD)."}`);
        this.generate();
        break;
      }
      case "outcomeStakes": {
        const oc = s.outcomeCheck;
        if (!oc) break;
        oc.on_success = String(msg.on_success ?? "").trim().slice(0, 200);
        oc.on_failure = String(msg.on_failure ?? "").trim().slice(0, 200);
        this.touch();
        return;
      }
      case "handout":
        this.giveHandout({ title: msg.title, text: msg.text, to: msg.to, voice: msg.voice });
        break;
      case "roomDocPlace": {
        const [d] = sanitizeRoomDocs([{ id: newRoomDocId(), room: msg.room, title: msg.title, text: msg.text, voice: msg.voice && this.logVoice(msg.voice) ? msg.voice : "" }]);
        if (!d || s.config.roomDocs.length >= MAX_ROOM_DOCS) break;
        s.config.roomDocs.push(d);
        this.addLog("note", `"${d.title}" left in ${this.roomName(d.room)}`);
        break;
      }
      case "roomDocGive":
        this.findRoomDoc(String(msg.id || ""), msg.to || "");
        break;
      case "roomDocDelete":
        s.config.roomDocs = s.config.roomDocs.filter((d) => d.id !== msg.id);
        break;
      case "handoutWrite":
        if (!this.handoutBusy) this.writeHandout(String(msg.brief || "").slice(0, 2000), String(msg.title || "").slice(0, 120), String(msg.voice || ""));
        return;
      case "handoutAgain": {
        const h = s.handouts.find((x) => x.id === msg.id);
        if (h) this.showHandout(h);
        return;
      }
      case "handoutDelete":
        s.handouts = s.handouts.filter((x) => x.id !== msg.id);
        this.toPlayers({ t: "handoutGone", id: msg.id });
        break;
      case "msgHold":
        holdNext(this, String(msg.pc || ""), msg.off ? null : msg.seconds, msg.never);
        return;
      case "msgRelease": releaseMessage(this, msg.id); return;
      case "msgDiscard": discardMessage(this, msg.id); return;
      case "msgAlter": alterMessage(this, msg.id, msg.text, "warden"); return;
      case "msgForge": {
        const bad = forgeMessage(this, msg, "warden");
        if (bad) this.send("dm", { t: "toast", level: "error", text: bad });
        return;
      }
      case "clockStart":
        this.startClock(msg.label, msg.seconds, "dm");
        break;
      case "clockStop":
        this.stopClock(msg.id);
        break;
      case "clockPause":
        this.pauseClock(msg.id, !!msg.pause);
        break;
      case "clockShift":
        this.shiftClock(msg.id, msg.seconds);
        break;
      case "outcomeDismiss":
        if (s.outcomeCheck?.held) this.setBusy(false);
        s.outcomeCheck = null;
        break;
      case "endSession":
        console.log(`  - session ${this.code} ended by its Warden`);
        this.onEnd?.(this);
        return;
      case "builderSay": {
        const text = String(msg.text || "").trim().slice(0, 4000);
        if (!text || this.builderBusy) break;
        s.builder.messages.push({ role: "warden", text });
        this.builderTurn("chat");
        break;
      }
      case "builderDraft":
        if (!this.builderBusy) this.builderTurn("draft");
        break;
      case "synopsis":
        if (!this.synopsisBusy) this.writeSynopsis(SYNOPSIS_KINDS.includes(msg.kind) ? msg.kind : "sofar");
        break;
      case "roomLayout": {
        const id = roomId(msg.room);
        if (!id) break;
        const rows = sanitizeRows(msg.rows);
        if (rows) s.config.rooms[id] = { rows };
        else delete s.config.rooms[id];
        break;
      }
      case "mapShow":
        s.mapShown = ["draw", "iso"].includes(msg.view) ? msg.view : "";
        break;
      case "roomDraft":
        if (!this.roomBusy) this.draftRoom(msg);
        return;
      case "roomShow": {
        const plan = s.config.rooms[msg.room];
        const to = [...this.sockets].filter((ws) => ws.role === "player" && (!msg.pc || ws.character === msg.pc));
        const payload = JSON.stringify(msg.hide ? { t: "roomPlan", rows: null } : { t: "roomPlan", name: String(msg.label || msg.room).slice(0, 60), rows: plan?.rows || null });
        if (!msg.hide && !plan) return;
        for (const ws of to) ws.send(payload);
        if (!msg.hide) {
          const who = msg.pc ? this.crewById(msg.pc)?.name || "one player" : "the players";
          this.addLog("note", `Showed ${who} the layout of ${String(msg.label || msg.room)}.`);
        }
        break;
      }
      case "builderReset":
        if (!this.builderBusy) s.builder = { messages: [], draft: null };
        break;
      case "builderApply":
        if (s.builder.draft && !this.builderBusy) this.applyStory(s.builder.draft);
        if (s.campaign) s.campaign.current = "";
        break;
      case "campaignOffer": {
        const c = campaignById(s.campaign?.id), id = String(msg.story || "");
        if (!c || !c.stories.some((x) => x.id === id)) break;
        const o = s.campaign.offered || [];
        s.campaign.offered = msg.on === false ? o.filter((x) => x !== id) : o.includes(id) || o.length >= 9 ? o : [...o, id];
        this.sectorVotes.forEach((v, ws) => { if (!s.campaign.offered.includes(v)) this.sectorVotes.delete(ws); });
        this.sectorSync();
        break;
      }
      case "campaignShow":
        this.sectorShown = !msg.hide && !!s.campaign;
        if (this.sectorShown) this.addLog("note", "Showed the players the sector map and the job board.");
        this.sectorSync();
        break;
      case "campaignStart": {
        const c = campaignById(msg.id);
        if (!c || this.campaignBusy) break;
        s.campaign = newProgress(c);
        this.sectorShown = false;
        this.sectorVotes.clear();
        this.sectorSync();
        this.addLog("note", `Campaign started: ${c.title}. Pick its first story on the sector map.`);
        for (const e of s.campaign.ledger) this.addLog("note", ledgerLine(s.campaign, e));
        this.addLog("note", `The rig carries a ${exact(s.campaign.debt)} note to Gallow-Mercer Finance, ${exact(DEBT_PAYMENT)} due every ${DEBT_EVERY} finished stories (house rule).`);
        this.moneySync();
        break;
      }
      case "campaignPlay": {
        const left = s.campaign?.current;
        if (!s.campaign || this.campaignBusy) return;
        if (left && left !== String(msg.story) && !msg.abandon) this.send("dm", { t: "toast", level: "error", text: "A story is still being played. Finish it first, or confirm abandoning it." });
        else this.campaignPlay(String(msg.story || ""));
        return;
      }
      case "campaignRecap":
        if (!s.campaign?.recap) this.send("dm", { t: "toast", level: "error", text: "There is no cold open to play yet: it's written when a campaign story is built." });
        else this.playRecap(s.campaign.recap);
        return;
      case "campaignFinish": {
        const c = campaignById(s.campaign?.id);
        const done = c && finishInto(s.campaign, c, s.config, msg.outcome, msg.affinity, s.station, snapshotStory(s));
        if (done) {
          const { story, changes } = done;
          const paid = settleStory(s.campaign, c, story, { delivery: msg.delivery, late: !!msg.late, skipDues: !!msg.skipDues, fee: msg.fee });
          changes.push(...paid.changes);
          for (const line of paid.lines) this.addLog("note", line);
          for (const e of paid.entries) this.addLog("note", ledgerLine(s.campaign, e));
          if (paid.handout) this.giveHandout(paid.handout);
          this.moneySync();
          this.transitDays(c, story);
          this.addLog("note", `Campaign story finished: ${story.title}.${s.campaign.done.at(-1).outcome ? ` ${s.campaign.done.at(-1).outcome}` : ""}`);
          for (const ch of changes) this.addLog("note", `Faction standing (house rule): ${ch.name} ${standingLabel(ch.from)} to ${standingLabel(ch.to)}${ch.why ? ` (${ch.why})` : ""}.`);
        }
        break;
      }
      case "campaignTravel": {
        const c = campaignById(s.campaign?.id);
        const r = c && travelTo(s.campaign, c, String(msg.to || ""));
        if (!r) break;
        if (!r.ok) this.send("dm", { t: "toast", level: "error", text: r.error });
        else {
          const gone = passDays(s.campaign, [s.config.crew, s.campaign.crew], r.lane.days);
          const at = (id) => c.locations.find((l) => l.id === id).name;
          for (const l of gone) this.addLog("note", l);
          this.crewChanged();
          this.addLog("note", `${c.ship.name} travels ${at(r.from)} to ${at(s.campaign.at)} along ${r.lane.name} (${r.lane.days} days): ${r.cost} fuel (house rule: 1 unit per started 3 days), ${r.left} left.`);
          this.sectorSync();
          this.sendHeader();
        }
        break;
      }
      case "campaignBuy": {
        const c = campaignById(s.campaign?.id);
        const r = c && resupply(s.campaign, c, { to: String(msg.to || ""), lines: msg.lines, ammoFor: String(msg.ammoFor || ""), fuelPrice: msg.fuelPrice, pay: String(msg.pay || "rig") });
        if (!r) break;
        if (!r.ok) this.send("dm", { t: "toast", level: "error", text: r.error });
        else {
          this.addLog("note", `Resupply at ${r.at}: ${r.bought.join(", ") || "nothing"}${r.to ? ` (carried by ${r.to})` : ""}. Total ${exact(r.total)}.${r.fuelFree ? " (No fuel price was set: the fuel was free.)" : ""}`);
          for (const e of r.entries) this.addLog("note", ledgerLine(s.campaign, e));
          crewFromCampaign(s.campaign, s.config.crew);
          this.moneySync();
          this.sendHeader();
        }
        break;
      }
      case "campaignDowntime": this.downtimeGo(msg); break;
      case "campaignShoreSpread": this.downtimeSpread(msg); break;
      case "campaignTreat": this.downtimeTreat(msg); break;
      case "campaignDays": this.downtimeDays(msg); break;
      case "campaignMoney": {
        const p = s.campaign, r = p && transfer(p, { from: String(msg.from || ""), to: String(msg.to || ""), amount: msg.amount, what: String(msg.what || "") });
        if (!r) break;
        if (!r.ok) this.send("dm", { t: "toast", level: "error", text: r.error });
        else {
          for (const e of r.entries) this.addLog("note", ledgerLine(p, e));
          this.moneySync();
        }
        break;
      }
      case "campaignFaction": {
        const c = campaignById(s.campaign?.id);
        const ch = c && shiftStanding(s.campaign, c, String(msg.faction || ""), Math.sign(Number(msg.delta)) || 0, "the Warden's call");
        if (ch) this.addLog("note", `Faction standing (house rule): ${ch.name} ${standingLabel(ch.from)} to ${standingLabel(ch.to)} (the Warden's call).`);
        break;
      }
      case "campaignFavour": {
        const c = campaignById(s.campaign?.id);
        const id = String(msg.faction || "");
        if (c && toggleFavour(s.campaign, c, id)) this.addLog("note", `Faction favour used (house rule): ${c.factions.find((f) => f.id === id).name}.`);        break;
      }
      case "campaignLeave":
        if (!this.campaignBusy) {
          s.campaign = null;
          this.sectorShown = false;
          this.sectorVotes.clear();
          this.sectorSync();
        }
        break;
      case "terminals": {
        const players = [...this.sockets].filter((c) => c.role === "player");
        const nets = players.map((c) => this.netOfSocket(c));
        s.config.terminals = sanitizeTerminals(msg.terminals);
        this.sendHeader();
        players.forEach((c, i) => { if (c.readyState === 1 && this.netOfSocket(c) !== nets[i]) this.sendInit(c); });
        break;
      }
      case "moveScreens":
        for (const ws of this.sockets) if (ws.role === "player" && ws.character && ws.character === msg.character) this.playerTerminal(ws, msg.terminal, "warden");
        break;
      case "endNight":
        this.endNight();
        break;
      case "epitaph": {
        const pc = this.crewById(String(msg.pc)), text = String(msg.text || "").replace(/\s+/g, " ").trim().slice(0, 140);
        if (!pc) break;
        pc.epitaph = text;
        const kept = s.campaign?.crew?.find((x) => x.id === pc.id);
        if (kept) kept.epitaph = text;
        this.crewChanged();
        break;
      }
      case "crewState":
        setCrewState(this, String(msg.pc), String(msg.state));
        break;
      case "cgAccept":
      case "cgReject": {
        const bad = decideCharacter(this, msg.t === "cgAccept", String(msg.id), msg.note);
        if (bad) this.send("dm", { t: "toast", level: "error", text: bad });
        break;
      }
      case "crew": {
        if (Array.isArray(msg.base)) {
          const r = patchCrew(s.config.crew, msg.base, msg.crew);
          s.config.crew = r.crew;
          if (s.campaign) for (const pc of s.config.crew) pc.credits = s.campaign.crew.find((x) => x.id === pc.id)?.credits ?? pc.credits;
          if (r.stale.length) this.send("dm", { t: "toast", level: "error", text: `The crew changed since this tab loaded, so ${r.stale.length === 1 ? "one edit was" : `${r.stale.length} edits were`} not applied (${[...new Set(r.stale)].slice(0, 4).join(", ")}). Showing the current values.` });
          this.crewChanged();
          break;
        }
        const was = new Map(s.config.crew.map((c) => [c.id, c]));
        s.config.crew = sanitizeCrew(msg.crew);
        for (const pc of s.config.crew) if (was.has(pc.id)) Object.assign(pc, { cond: was.get(pc.id).cond, endedIn: was.get(pc.id).endedIn, finalWords: was.get(pc.id).finalWords, epitaph: was.get(pc.id).epitaph });
        if (s.campaign) for (const pc of s.config.crew) pc.credits = s.campaign.crew.find((x) => x.id === pc.id)?.credits ?? pc.credits;
        this.crewChanged();
        break;
      }
      case "soundPlay": {
        const snd = s.sounds.find((x) => x.id === msg.id);
        if (!snd) break;
        const play = { pid: newId("sp", 3), id: snd.id, name: snd.name, loop: !!msg.loop, volume: clampVol(msg.volume ?? snd.volume), at: Date.now() };
        s.playing = [...s.playing.filter((p) => p.loop || Date.now() - p.at < 120_000), play].slice(-30);
        this.toPlayers({ t: "sound", play });
        if (!play.loop) {
          setTimeout(() => {
            if (!s.playing.includes(play)) return;
            s.playing = s.playing.filter((p) => p !== play);
            this.syncDm();
          }, Math.min(120, snd.seconds || 10) * 1000 + 500);
        }
        break;
      }
      case "soundStop":
        if (msg.all) this.stopSounds();
        else if (s.playing.some((p) => p.pid === msg.pid)) {
          s.playing = s.playing.filter((p) => p.pid !== msg.pid);
          this.toPlayers({ t: "soundStop", pid: msg.pid });
        }
        break;
      case "soundVolume": {
        const p = s.playing.find((x) => x.pid === msg.pid);
        if (!p) break;
        p.volume = clampVol(msg.volume);
        this.toPlayers({ t: "soundVolume", pid: p.pid, volume: p.volume });
        break;
      }
      case "soundEdit": {
        const snd = s.sounds.find((x) => x.id === msg.id);
        if (!snd) break;
        if (msg.name !== undefined) snd.name = cleanName(msg.name) || snd.name;
        if (msg.volume !== undefined) snd.volume = clampVol(msg.volume);
        break;
      }
      case "resetAll":
        this.freshGame();
        this.initPlayers();
        break;
      default:
        return;
    }
    this.touch();
    this.syncDm();
  }

  startEffect(raw, source, cue = null) {
    if (raw) raw = { ...raw, type: effectType(raw.type) };
    if (!raw || !ALL_EFFECTS.includes(raw.type)) return;
    if (source === "agent" && !AGENT_EFFECTS.includes(raw.type)) return;
    const snd = raw.type === "sound" ? this.findSound(raw.sound || raw.text) : null;
    if (raw.type === "sound" && !snd) return;
    const seconds = snd ? Math.ceil(snd.seconds || 10) + 1 : Math.max(0, Math.min(3600, Number(raw.seconds) || 0));
    const effect = {
      id: newId("fx", 4),
      type: raw.type,
      text: snd ? snd.name : String(raw.text || "").slice(0, 200),
      ...(snd ? { sound: snd.id, volume: snd.volume ?? 0.8 } : {}),
      intensity: Math.max(1, Math.min(3, Number(raw.intensity) || 2)),
      seconds,
      source,
      startedAt: Date.now(),
      ...(cue ? { atEntry: cue.atEntry, when: cue.when, ...(cue.hold ? { hold: true } : {}) } : {}),
      ...(source === "agent" ? { net: cue ? this.state.log.find((e) => e.id === cue.atEntry)?.net || "" : this.defaultNet() } : {}),
    };
    this.state.effects.push(effect);
    this.delivering?.effects.push(effect.id);
    if (effect.net !== undefined) this.toNet(effect.net, { t: "effect", effect });
    else this.toPlayers({ t: "effect", effect });
    const listed = cue ? seconds + 180 : seconds;
    if (seconds > 0) this.effectTimers.set(effect.id, setTimeout(() => { this.endEffect(effect.id); this.syncDm(); }, listed * 1000));
    if (source === "agent") this.addLog("note", `Agent triggered effect: ${effect.type}${effect.text ? ` "${effect.text}"` : ""} (${seconds || "∞"}s)${cue ? ` ${cue.when} line #${cue.atEntry}` : ""}`);
  }

  findSound(ref) {
    const r = String(ref || "").trim().toLowerCase();
    return r ? this.state.sounds.find((s) => s.id === r || s.name.toLowerCase() === r) || this.state.sounds.find((s) => s.name.toLowerCase().startsWith(r)) : null;
  }
  addSound(sound) {
    this.state.sounds.push(sound);
    this.touch();
    this.syncDm();
  }

  removeSound(id) {
    const snd = this.state.sounds.find((x) => x.id === id);
    if (!snd) return null;
    this.state.sounds = this.state.sounds.filter((x) => x !== snd);
    for (const p of this.state.playing.filter((x) => x.id === id)) this.toPlayers({ t: "soundStop", pid: p.pid });
    this.state.playing = this.state.playing.filter((x) => x.id !== id);
    this.touch();
    this.syncDm();
    return snd;
  }

  stopSounds() {
    this.state.playing = [];
    this.toPlayers({ t: "soundStop", all: true });
  }

  endAllEffects() { for (const e of [...this.state.effects]) this.endEffect(e.id); }
  endEffect(id) {
    clearTimeout(this.effectTimers.get(id));
    this.effectTimers.delete(id);
    const before = this.state.effects.length;
    this.state.effects = this.state.effects.filter((e) => e.id !== id);
    if (this.state.effects.length !== before) this.toPlayers({ t: "endEffect", id });
  }

  pregenerate(lines) {
    if (!this.speaksOnScreens()) return;
    for (const l of lines) {
      const base = speakingVoice(this.state.config, l);
      if (base.engine !== "neural") continue;
      const fx = l.inPerson ? {} : voiceFor(this.state.config.voices, l)?.fx || {};
      for (const text of [l.text, ...(l.variants || []).map((v) => v.text)]) {
        for (const part of speechParts(text)) this.speech.speak(part, base, fx).catch(() => {});
      }
    }
  }

  applyCastChanges(list, step = "before") {
    const c = this.state.config;
    const withPlayers = new Set(this.screensAtTerminals().map((x) => this.roomOfSocket(x)).filter(Boolean));
    const target = (ch) => { const r = String(ch?.room ?? "").trim().toLowerCase(); return r === "none" ? "" : r.replace(/[^a-z0-9_]/g, "").slice(0, 60); };
    const leaving = (ch) => {
      const m = findCast(c.cast, String(ch?.name || ""));
      return !!m && !!String(ch?.room ?? "").trim() && withPlayers.has(m.room) && target(ch) !== m.room;
    };
    let any = false;
    for (const ch of Array.isArray(list) ? list : []) {
      if (leaving(ch) !== (step === "after")) continue;
      const { member, created } = addCast(c.cast, String(ch?.name || "").trim(), { crew: c.crew });
      if (!member) continue;
      const room = String(ch.room ?? "").trim().toLowerCase();
      const to = target(ch);
      const moved = !!room && to !== member.room;
      if (moved) member.room = to;
      const notes = String(ch.notes ?? "").trim();
      if (notes && !member.notes.includes(notes)) member.notes = `${member.notes}${member.notes ? " " : ""}${notes}`.slice(0, 1500);
      if (created) this.addLog("note", `Cast: ${member.name} joins the story${member.room ? ` (in ${member.room})` : ""}.`);
      else if (moved) this.addLog("note", `Cast: ${member.name} → ${member.room || "nowhere on the map"}.`);
      else if (notes) this.addLog("note", `Cast: ${member.name}: ${notes}`);
      const [was, now] = shiftAttitude(member, ch.attitude_change, String(ch.why ?? ""));
      if (now !== was) this.addLog("note", `Cast: ${member.name} feels ${attitudeLabel(now)} towards the players (was ${attitudeLabel(was)})${member.why ? `: ${member.why}` : ""}.`);
      const [s0, s1] = shiftStress(member, ch.stress_change);
      if (s1 !== s0) this.addLog("note", `Cast: ${member.name}: Stress ${s0} → ${s1}.`);
      if (ch.panic_check && !(this.panics ||= []).includes(member.id)) this.panics.push(member.id);
      any ||= created || moved || !!notes || now !== was;
    }
    if (any) this.sendHeader();
  }

  revealOnLine(ref) {
    const c = this.state.config;
    const n = String(ref || "").trim().toLowerCase();
    const v = c.voices.find((x) => x.adversary && !x.adversary.revealed && (x.id === n || x.name.toLowerCase() === n || (n === "???" && x.adversary)));
    if (!v) return null;
    v.adversary.revealed = true;
    this.addLog("note", `Adversary revealed: players see ${v.name}.`);
    this.sendHeader();
    const pic = v.adversary.picture;
    return { id: v.id, name: v.name, ...(pic ? { src: this.pictureSrc(pic), credit: v.adversary.credit || "" } : {}) };
  }
  pictureSrc(pic) { return PICTURE_LINK.test(pic) ? pic : `api/sessions/${this.code}/portraits/${pic}`; }

  revealAdversaries(names = []) {
    const c = this.state.config;
    let any = false;
    for (const raw of Array.isArray(names) ? names : []) {
      const n = String(raw || "").trim().toLowerCase();
      const v = c.voices.find((x) => x.adversary && !x.adversary.revealed && (x.id === n || x.name.toLowerCase() === n));
      if (!v) continue;
      v.adversary.revealed = true;
      any = true;
      this.addLog("note", `Adversary revealed: players now know ${v.name} by name.`);
    }
    if (any) this.sendHeader();
    return any;
  }

  castPanic(member, by = "agent") {
    const req = { check: PANIC, advantage: "none" };
    const result = resolve(req, member.stress ?? 2, diceFor(req));
    const fx = result.success ? null : panicEntry(result.used);
    track("Roll", { Kind: "panic", Who: "cast" });
    this.toPlayers({ t: "rollResult", result, label: "Panic", who: member.name, effect: fx?.name || "", effectText: fx?.effect || "" });
    this.addLog("roll", `${member.name}${by === "warden" ? " (the Warden called it)" : ""}: PANIC CHECK\nSTRESS ${result.target} · ROLLED ${result.used} (D20)\n${fx ? `PANIC · ${fx.name.toUpperCase()}` : "KEPT THEIR COOL"}`,
      { outcome: result.outcome, by: member.name, cast: true, ...(fx ? { panicEffect: `${fx.name}: ${fx.effect}` } : {}) });
    if (this.generating) this.rerun = true;
    else setTimeout(() => this.requestReply(), 0);
  }

  async callModel(provider, request, kind) {
    if (provider.serverKeyOnly) {
      const day = new Date().toISOString().slice(0, 10);
      if (this.freeCalls.day !== day) this.freeCalls = { day, count: 0 };
      if (this.freeCalls.count >= FREE_CALLS_PER_DAY) {
        throw new Error(`Used all ${FREE_CALLS_PER_DAY} free replies for today. Add a DeepSeek or Claude API key in Settings → Agent to continue.`);
      }
      this.freeCalls.count++;
    }
    const t = Date.now();
    const fields = { Kind: kind, Provider: provider.id, Model: request.model };
    try {
      const out = await provider.generate(request);
      track("AgentCall", { ...fields, Outcome: "ok", LatencyMs: Date.now() - t });
      return out;
    } catch (err) {
      track("AgentCall", { ...fields, Outcome: "error", LatencyMs: Date.now() - t });
      throw err;
    }
  }

  modelAccess(noKey = "No API key. Add one in Settings → Agent.") {
    const id = this.state.config.provider;
    const provider = getProvider(id);
    if (!provider) throw new Error(`Unknown provider "${id}".`);
    const apiKey = keyFor(id, this.keys);
    if (!apiKey) throw new Error(noKey);
    return { provider, apiKey };
  }

  async ask(request, kind = "reply") {
    const s = this.state;
    const { provider, apiKey } = this.modelAccess();
    for (let attempt = 1; ; attempt++) {
      const text = await this.callModel(provider, { apiKey, model: s.config.model, effort: s.config.effort, ...request }, kind);
      try {
        return JSON.parse(String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
      } catch {
        if (attempt >= 2) throw new Error("The model didn't return valid JSON. Try again.");
      }
    }
  }

  async builderTurn(kind) {
    const b = this.state.builder;
    this.builderBusy = kind;
    this.syncDm();
    try {
      if (kind === "chat") {
        const r = await this.ask(chatRequest(b), "builder");
        b.messages.push({ role: "agent", text: String(r?.reply || "…").slice(0, 6000), ready: !!r?.ready });
      } else {
        b.draft = normalizeDraft(await this.ask(draftRequest(b), "builder"));
        b.messages.push({ role: "agent", text: `Draft ready: "${b.draft.title}". Look it over, ask me for changes, or apply it.`, draft: true });
      }
    } catch (err) {
      console.error(`[${this.code}] story builder failed:`, err?.message || err);
      b.messages.push({ role: "agent", text: `(Something went wrong: ${err?.message || err})`, error: true });
    }
    b.messages = b.messages.slice(-60);
    this.builderBusy = "";
    this.touch();
    this.syncDm();
  }

  async writeSynopsis(kind) {
    const s = this.state;
    this.synopsisBusy = kind;
    this.syncDm();
    try {
      const { started, request } = synopsisRequest(s, this.screens(), kind);
      const sections = normalizeSynopsis(await this.ask(request, "synopsis"));
      (s.synopses ||= {})[kind] = { sections, started, at: Date.now(), logId: s.log.at(-1)?.id ?? 0 };
    } catch (err) {
      console.error(`[${this.code}] synopsis failed:`, err?.message || err);
      this.send("dm", { t: "toast", level: "error", text: `Couldn't write the synopsis: ${err?.message || err}` });
    }
    this.synopsisBusy = "";
    this.touch();
    this.syncDm();
  }

  async draftRoom(msg) {
    const s = this.state;
    const room = {
      id: roomId(msg.room),
      label: String(msg.label || msg.room || "").slice(0, 60),
      deck: String(msg.deck || "the station").slice(0, 80),
    };
    if (!room.id) return;
    this.roomBusy = room.id;
    this.syncDm();
    try {
      const rows = sanitizeRows((await this.ask(roomDraftRequest(s, room), "room"))?.rows);
      if (!rows) throw new Error("The model returned an empty plan. Try again.");
      s.config.rooms[room.id] = { rows };
    } catch (err) {
      console.error(`[${this.code}] room plan failed:`, err?.message || err);
      this.send("dm", { t: "toast", level: "error", text: `Couldn't draw ${room.label}: ${err?.message || err}` });
    }
    this.roomBusy = "";
    this.touch();
    this.syncDm();
  }

  async campaignPlay(id) {
    const s = this.state, p = s.campaign, c = campaignById(p?.id);
    const story = c?.stories.find((x) => x.id === id);
    if (!story) return;
    this.campaignBusy = id;
    this.syncDm();
    try {
      await this.buildCampaignStory(c, story, p);
    } catch (err) {
      console.error(`[${this.code}] campaign story failed:`, err?.message || err);
      this.send("dm", { t: "toast", level: "error", text: `Couldn't build ${story.title}: ${err?.message || err}` });
    }
    this.campaignBusy = "";
    this.touch();
    this.syncDm();
  }

  // The cold open: 4-6 beats of the last finished story, written while the new story builds. The first story gets the campaign's tagline.
  async writeRecap(c, story, p) {
    const last = p.done.filter((d) => d.id !== story.id).sort((a, b) => b.at - a.at)[0];
    if (!last) return introRecap(c, story);
    try {
      return normalizeColdOpen(await this.ask(coldOpenRequest(c, last, story, p), "builder"), last.recap, story);
    } catch (err) {
      console.error(`[${this.code}] cold open failed:`, err?.message || err);
      return null;
    }
  }

  async playRecap(r) {
    const s = this.state, c = s.config, camp = campaignById(s.campaign?.id), story = camp?.stories.find((x) => x.id === r?.for);
    if (!story) return;
    const nv = voiceFor(c.voices, { kind: "entity", entity: BUILTIN.narrator });
    const talk = this.speaksOnScreens();
    const texts = [...r.beats.map((b) => b.line), r.hook].filter(Boolean);
    const clips = await Promise.all(texts.map((t) => (talk ? this.speech.speak(t, nv.voice, nv.fx).catch(() => null) : null)));
    const GAP = 600;
    let at = Date.now() + 1500;
    const slot = (text, clip, min = 0) => {
      const dur = Math.max(min, clip ? Math.round(clip.seconds * 1000) : Math.min(7000, 800 + text.length * 40));
      const out = { at, dur, ...(clip ? { wav: clip.wav.toString("base64"), ...(clip.composed ? { composed: true } : {}) } : {}) };
      at += dur + GAP;
      return out;
    };
    const src = (b) => (!b.pic ? "" : b.kind === "adv" ? this.pictureSrc(b.pic) : b.pic.startsWith("kit/") ? `portraits/${b.pic.slice(4)}` : PICTURE_LINK.test(b.pic) ? b.pic : `api/sessions/${this.code}/portraits/${b.pic}`);
    const cards = r.beats.map((b, i) => ({ text: b.line, who: b.who, src: src(b), credit: b.credit, ...slot(b.line, clips[i]) }));
    const title = { line: `${camp.title} · STORY ${story.n} · ${story.title}`.toUpperCase(), hook: r.hook, ...(r.hook ? slot(r.hook, clips[cards.length], 3500) : { at, dur: 3500 }) };
    const end = title.at + title.dur + 1500;
    this.toPlayers({ t: "coldopen", id: newId("co", 4), campaign: camp.title.toUpperCase(), cards, title, end, fx: nv.fx || {} });
    this.playhead = Math.max(this.playhead, end + 500);
    const secs = Math.round((end - Date.now()) / 1000);
    this.addLog("note", cards.length ? `Cold open: "Previously on ${camp.title}" plays on every screen (${secs} seconds).` : `Cold open: the title card plays on every screen (${secs} seconds). There is nothing to recap before the first story.`);
  }

  async buildCampaignStory(c, story, p) {
    const recapJob = this.writeRecap(c, story, p);
    let raw;
    for (let attempt = 1; ; attempt++) {
      try {
        raw = await this.ask(campaignRequest(c, story, p), "builder");
        if (!raw?.lore || !raw?.computer) throw Object.assign(new Error("the story came back incomplete"), { incomplete: true });
        break;
      } catch (err) {
        if (attempt >= 2 || (!err.incomplete && !/cut off|valid JSON|empty/i.test(err?.message || ""))) throw err;
        console.warn(`[${this.code}] campaign story retry: ${err.message}`);
      }
    }
    if (this.state.campaign !== p) throw new Error("the campaign was left while the story was being built");
    let carried;
    this.applyStory(normalizeDraft(composeDraft(c, story, p, raw)), (config, station) => { carried = carryInto(config, c, story, p, station); }, true);
    const left = p.current && p.current !== story.id && c.stories.find((x) => x.id === p.current);
    if (left) p.abandoned = [...(p.abandoned || []), { id: left.id, at: Date.now() }].slice(-50);
    p.current = story.id;
    if (left) this.addLog("note", `${left.title} was abandoned unfinished: no fee, no faction change, and it does not count as finished (house rule).`);
    const up = payUpfront(p, c, story);
    p.offered = (p.offered || []).filter((x) => x !== story.id);
    this.sectorVotes.clear();
    this.sectorShown = false;
    this.sectorSync();
    this.addLog("note", `${c.title}, story ${story.n}: ${story.title} (${placeOf(c, story)}). The arc is in the standing orders.`);
    if (carried?.lane) this.addLog("note", `The lane ${carried.lane.name} (${carried.lane.days} days) burns ${carried.burned} fuel (house rule); the rig has ${p.resources.fuel} left.${p.resources.fuel <= 0 ? " The rig is out of fuel: stranded." : ""}`);
    for (const line of up.lines) this.addLog("note", line);
    for (const e of up.entries) this.addLog("note", ledgerLine(p, e));
    if (up.entries.length) this.moneySync();
    this.syncHazards();
    this.sendHeader();
    p.recap = await recapJob;
    if (p.recap && this.state.campaign === p && this.state.config.coldOpen !== false) await this.playRecap(p.recap);
  }

  applyStory(draft, patch, keepClaims = false) {
    this.clearClocks();
    const s = this.state;
    const { config, station } = applyDraft(draft);
    this.genCounter++;
    this.playhead = 0;
    Object.assign(s.config, config, { rooms: {}, startDocs: config.startDocs || [] });
    patch?.(s.config, station);
    s.config.roomDocs = sanitizeRoomDocs(config.roomDocs);
    Object.assign(s, { station, storyStart: null, log: [], handouts: structuredClone(s.config.startDocs), found: [], pending: null, whisper: "", roll: null, outcomeCheck: null, offers: [], synopses: {}, shipFight: null });
    this.endAllEffects();
    this.stopSounds();
    this.hazardUnits = [];
    this.hazardNeeds = [];
    this.syncHazards();
    for (const ws of this.sockets) if (ws.role === "player" && !(keepClaims && this.state.config.crew.some((c) => c.id === ws.character && playable(c)))) ws.character = null;
    if (this.usesNeural()) warmNeural();
    this.addLog("note", `New story applied: "${draft.title}".`);
    this.initPlayers();
    this.setBusy(false);
  }

  async aside(text) {
    const s = this.state;
    this.addLog("aside", text);
    this.syncDm();
    try {
      const { provider, apiKey } = this.modelAccess("No API key, so the agent can't read notes. Add one in Settings → Agent.");
      const request = { apiKey, model: s.config.model, effort: s.config.effort, ...buildRequest(s, "", { aside: true }) };
      let reply;
      for (let attempt = 1; ; attempt++) {
        try {
          reply = parseReply(await this.callModel(provider, request, "note"), s.config.voices, s.config.talk);
          break;
        } catch (err) {
          if (!err.malformed || attempt >= 2) throw err;
        }
      }
      const changes = reply.station_changes.filter((c) => c.path);
      for (const c of changes) setPath(s.station, c.path, c.value);
      const mapChanges = this.mapChanges(reply);
      this.addLog("aside_reply", reply.dm_note.trim() || "Noted.", { changes: changes.map(({ path, value }) => ({ path, value })), ...mapChanges });
      this.applyMapChanges(mapChanges);
      if (changes.length) this.sendHeader();
    } catch (err) {
      console.error(`[${this.code}] note failed:`, err?.message || err);
      this.addLog("note", `The agent didn't get that note: ${err?.message || err}`);
    }
    this.touch();
    this.syncDm();
  }

  publicRoll() {
    const r = this.state.roll;
    if (!r || r.status !== "waiting") return null;
    return {
      id: r.id, check: r.check, label: checkLabel(r), skill: skillLabel(r), skillName: r.skill, bonus: r.bonus, reason: r.reason, advantage: r.advantage,
      panic: r.check === PANIC, all: r.all, stakes: r.stakes || null, ship: r.ship ? { stat: r.ship.stat, label: r.ship.label, value: r.ship.value } : null,
      pcs: r.pcs.map((p) => {
        const pc = this.crewById(p.id);
        const plus = !!pc && r.check === PANIC && this.plusAvailable(pc);
        return { ...p, done: !!r.results[p.id], advantage: pc ? effectiveAdvantage(r, pc, this.advOpts(pc, r)) : r.advantage, why: pc ? this.advWhy(pc, r) : [], plus, autoPlus: plus && r.plus };
      }),
    };
  }

  resolveRoll(ws, msg) {
    const r = this.state.roll;
    const pc = this.characterOf(ws);
    if (!r || r.status !== "waiting" || msg.id !== r.id || !pc || !r.pcs.some((p) => p.id === pc.id) || r.results[pc.id]) return;
    this.lastNet = this.netOfSocket(ws);
    try {
      this.rollFor(pc, msg.manual ? manualDice(msg.dice) : null, { manual: !!msg.manual, by: "player", plus: !!msg.plus });
    } catch (err) {
      ws.send(JSON.stringify({ t: "rollError", text: err.message }));
    }
  }

  rollFor(pc, dice, { manual = false, by = "player", plus = false } = {}) {
    const s = this.state;
    const r = s.roll;
    const usePlus = r.check === PANIC && (plus || r.plus) && this.plusAvailable(pc);
    const req = { ...r, advantage: effectiveAdvantage(r, pc, this.advOpts(pc, r, usePlus)) };
    const { stat, bonus } = rollTarget(r, pc);
    const result = resolve(req, r.check === PANIC || r.check === "ship" ? stat : stat - (pc.cond?.rad || 0), dice ?? diceFor(req), bonus);
    track("Roll", { Kind: r.check === PANIC ? "panic" : r.check === "ship" ? "ship" : CHECKS[r.check].kind === "Save" ? "save" : "stat", Who: r.all ? "all" : "one" });
    r.results[pc.id] = { result, manual, by };
    if (usePlus) {
      s.panicPlus[pc.id] = true;
      this.addLog("note", `Teamster trauma response: ${pc.name} takes [+] on this Panic Check (once per session, now used).`);
    }
    const fx = result.panic && !result.success ? panicEntry(result.used) : null;
    this.toPlayers({ t: "rollResult", result, label: checkLabel(req), who: pc.name, effect: fx?.name || "", effectText: fx?.effect || "" });
    if (fx) this.panicScreens(pc, result.used, fx.name);
    this.addLog("roll", `${pc.name}${by === "warden" ? " (rolled by the Warden)" : ""}: ${resultText(req, result)}${fx ? `: ${fx.name.toUpperCase()}` : ""}`, { outcome: result.outcome, by: pc.name, ...(fx ? { panicEffect: `${fx.name}: ${fx.effect}` } : {}) });
    const dt = r.downtime?.[pc.id], dtOut = dt && this.settleDowntime(pc, dt, result);
    this.afterRoll(pc, req, result, fx, !!dtOut?.ownStress);
    if (r.hazard?.[pc.id]) this.settleHazard(pc, r.hazard[pc.id], result);
    if (r.pcs.every((p) => r.results[p.id])) this.finishRoll();
    else {
      this.toPlayers({ t: "roll", roll: this.publicRoll() });
      this.syncDm();
    }
  }

  // The panicking player's own screen panics with them (presentation only). Close crew see a flash if the result was Jumpy.
  panicScreens(pc, used, name, { force = false } = {}) {
    if (this.state.config.panicScreens === false && !force) return;
    const pics = this.state.config.voices.filter((v) => v.adversary?.picture).map((v) => v.adversary.picture);
    const picture = pics.length ? this.pictureSrc(pics[Math.floor(Math.random() * pics.length)]) : "";
    const own = panicMessage({ used, name, android: pc.className === "Android", picture });
    if (!own) return;
    const near = nearMessage(own.seq), nearIds = near ? new Set(this.closeTo(pc).map((x) => x.id)) : null;
    for (const ws of this.sockets) {
      if (ws.role !== "player" || ws.readyState !== 1 || !ws.character) continue;
      if (ws.character === pc.id) ws.send(JSON.stringify(own));
      else if (near && nearIds.has(ws.character)) ws.send(JSON.stringify(near));
    }
  }

  afterRoll(pc, req, result, fx, ownStress = false) {
    if (req.check === "ship") return; // a ship check's consequences go to the whole crew when its step resolves (shipfight.js)
    if (result.stress && !ownStress) this.stressFromRoll(pc, result.stress, "failed roll", req.check);
    if (fx?.minStress) {
      const [was, now] = raiseMinStress(pc, fx.minStress);
      this.addLog("note", `${pc.name}: Minimum Stress ${was} → ${now} (${fx.name}).`);
      this.crewChanged();
    }
    if (fx?.fx) this.panicEffects(pc, fx);
    if (result.panicCheck) this.offerRoll(`Panic check for ${pc.name} (critical failure)`, { pc: pc.id, check: PANIC, reason: "Critical failure" });
    const near = this.closeTo(pc);
    if (req.check === "sanity" && !result.success && pc.className === "Scientist") {
      for (const c of near) {
        this.addLog("note", `Scientist trauma response: ${pc.name} failed a Sanity Save, so ${c.name} gains 1 Stress.`);
        this.stressFromRoll(c, 1, "Scientist trauma response");
      }
    }
    if (result.panic && !result.success && pc.className === "Marine") {
      this.addLog("note", `Marine trauma response: every Close friendly player makes a Fear Save (${pc.name} panicked).`);
      if (near.length) this.offerRoll(`Fear Save for ${near.map((c) => c.name).join(", ")} (Marine trauma response)`, { pc: near.map((c) => c.id), check: "fear", reason: "Marine trauma response" });
    }
  }

  // The Panic Table results the app can apply (PSG 21): Stress, Stress to the crew, Stress dropped, Maximum Wounds, Retire. A failed Panic Check adds no Stress of its own.
  panicEffects(pc, entry) {
    const f = entry.fx, crew = this.state.config.crew;
    const gain = (c, n, why) => {
      const g = gainStress(c, n);
      this.addLog("note", `${c.name}: Stress ${g.from} → ${g.to} (${why}).`);
      this.stressOver(c, g.over);
    };
    if (f.stress) gain(pc, f.stress, entry.name);
    if (f.close) for (const c of this.closeTo(pc).filter(playable)) gain(c, f.close, `${pc.name}: ${entry.name}`);
    if (f.all) for (const c of crew.filter(playable)) gain(c, f.all, `${pc.name}: ${entry.name}`);
    for (const expr of f.drop || []) {
      const n = rollDice(expr).total, [was, now] = setVital(pc, "stress", pc.stress - n);
      this.addLog("note", `${pc.name}: Stress ${was} → ${now} (${entry.name}: ${expr} rolled ${n}${was - now < n ? `, Stress never goes below Minimum Stress ${pc.minStress ?? 0}` : ""}).`);
    }
    if (f.maxWounds) {
      const was = pc.wounds.max;
      pc.wounds.max = Math.max(1, was + f.maxWounds);
      this.addLog("note", `${pc.name}: Maximum Wounds ${was} → ${pc.wounds.max} (${entry.name}).`);
      if (pc.wounds.current >= pc.wounds.max && !isDead(pc)) {
        pc.wounds.current = pc.wounds.max;
        this.addLog("note", `${pc.name} is now at Maximum Wounds. The Panic Table doesn't say so: this is the app's reading of "on reaching Maximum Wounds: Death Save" (PSG 29).`);
        this.callDeathSave(pc, "at Maximum Wounds");
      }
    }
    if (f.retire) {
      this.addLog("note", `${pc.name} retires (${entry.name}): their player rolls up a new character.`);
      setCrewState(this, pc.id, "retired");
    }
    this.crewChanged();
  }

  offerRoll(label, roll) {
    const offers = this.state.offers;
    if (!offers.some((o) => o.label === label)) offers.push({ id: newId("of", 3), label, roll });
  }

  runOffer() {
    const s = this.state;
    if (s.roll?.status === "waiting" || !s.offers.length) return false;
    this.soloCall(s.offers.shift().roll);
    return true;
  }

  finishRoll() {
    const r = this.state.roll;
    Object.assign(r, { status: "done", finishedAt: Date.now() });
    this.toPlayers({ t: "roll", roll: null });
    this.syncDm();
    if (r.ship) {
      shipRollDone(this, r);
      if (this.state.roll !== r && this.state.roll?.status === "waiting") return;
    }
    if (r.downtime) {
      this.nextDowntime();
      return;
    }
    if (this.state.solo && this.runOffer()) return;
    if (this.state.solo) this.soloNoCheck = true;
    if (r.hazard) {
      this.pumpHazards();
      if (this.state.roll?.status === "waiting") return;
    }
    if (this.hasKey()) this.generate();
  }

  playerTerminal(ws, id, by) {
    const t = this.state.config.terminals.find((x) => x.id === id);
    if (!t || ws.terminal === id) return;
    const canReach = reachable(t, this.state.station);
    if (by === "player" && ws.terminal && (!this.state.config.playerTerminals || !canReach)) return;
    if (by === "player" && !ws.terminal && !canReach) return;
    const had = ws.terminal;
    const wasNet = this.netOfSocket(ws);
    ws.terminal = id;
    if (by !== "player") ws.send(JSON.stringify({ t: "terminalSet", id }));
    if (by !== "player" && !canReach) {
      Object.assign(t, { open: true, openedInPlay: true });
      this.addLog("note", `${t.name} is now reachable.`);
      this.sendHeader();
    }
    if (netOf(t) !== wasNet) ws.send(JSON.stringify({ t: "init", ...this.playerView(ws) }));
    if (had) this.lastNet = netOf(t);
    rememberTerminal(this, ws);
    const pc = this.characterOf(ws);
    if (had && pc) this.addLog("note", `${pc.name} ${by === "player" ? "moved" : "was moved"} to the ${t.name}.`);
    this.syncDm();
  }

  screens() {
    return [...this.sockets].filter((ws) => ws.role === "player" && ws.terminal).map((ws) => ({ character: this.characterOf(ws)?.name || null, characterId: ws.character, terminal: ws.terminal }));
  }

  playerVitals(ws, msg) {
    const pc = this.characterOf(ws);
    if (!pc || !this.state.config.playerVitals) return;
    const ch = setVital(pc, msg.field, msg.value);
    if (!ch || ch[0] === ch[1]) return;
    const last = this.state.log.at(-1);
    const vital = { pc: pc.id, field: msg.field };
    if (last?.kind === "note" && last.vital?.pc === pc.id && last.vital.field === msg.field && Date.now() - last.ts < 20_000) {
      last.text = `${pc.name}: ${label(msg.field)} ${last.vital.from} → ${ch[1]} (set by the player).`;
      last.ts = Date.now();
    } else {
      this.addLog("note", `${pc.name}: ${label(msg.field)} ${ch[0]} → ${ch[1]} (set by the player).`, { vital: { ...vital, from: ch[0] } });
    }
    this.crewChanged();
  }

  selfRoll(ws, msg) {
    const pc = this.characterOf(ws);
    if (!pc || !this.state.config.playerRolls || !CHECKS[msg.check]) return;
    const now = Date.now();
    if (now - (ws.lastRoll || 0) < 1500) return;
    ws.lastRoll = now;
    let r;
    try {
      r = sanitizeRequest({ pc: pc.id, check: msg.check, skill: msg.skill, advantage: msg.advantage }, [pc]);
    } catch (err) {
      return ws.send(JSON.stringify({ t: "rollError", text: err.message }));
    }
    const req = { ...r, advantage: effectiveAdvantage(r, pc, this.advOpts(pc, r)) };
    const dice = msg.manual ? manualDice(msg.dice) : diceFor(req);
    let result;
    try {
      result = resolve(req, (pc.stats[msg.check] ?? pc.saves[msg.check]) - (pc.cond?.rad || 0), dice, r.bonus);
    } catch (err) {
      ws.send(JSON.stringify({ t: "rollError", text: req.advantage !== r.advantage ? `${err.message} An Android is close, so this Fear Save is at [-].` : err.message }));
      return;
    }
    track("Roll", { Kind: CHECKS[r.check].kind === "Save" ? "save" : "stat", Who: "self" });
    ws.send(JSON.stringify({ t: "rollResult", result, label: checkLabel(req) }));
    this.addLog("roll", `${pc.name} rolled: ${resultText(req, result)}`, { outcome: result.outcome, by: pc.name, self: true });
    this.afterRoll(pc, req, result, null);
    if (this.state.solo) this.runOffer();
    this.syncDm();
  }
  stressFromRoll(pc, n, why = "failed roll", check = "") {
    const { from, to, over } = gainStress(pc, n);
    this.addLog("note", `${pc.name}: Stress ${from} → ${to} (${why}).`);
    this.stressOver(pc, over, check);
    this.crewChanged();
  }

  adversaryNamed(name) {
    const norm = (s) => keyOf(String(s || "").replace(/^the\s+/i, ""));
    const want = norm(name);
    if (!want) return null;
    const advs = this.state.config.voices.filter((v) => v.adversary?.stats);
    return advs.find((v) => v.id === String(name)) || advs.find((v) => norm(v.name) === want) || advs.find((v) => want.length >= 3 && (norm(v.name).includes(want) || want.includes(norm(v.name)))) || null;
  }

  // What happened to a character in a hit, in the log's words.
  hitLines(pc, r, before, head) {
    const armor = pc.armor;
    const out = [head];
    out.push(`${r.raw} DAMAGE${r.dr ? ` · DR ${r.dr}` : ""}`);
    if (r.armorIgnored) out.push(`${armor.name.toUpperCase()} AP ${armor.ap}: ${r.raw - r.dr} IS UNDER IT AND IGNORED`);
    else if (r.armorDestroyed) out.push(`${armor.name.toUpperCase()} AP ${armor.ap} DESTROYED${r.aa ? " (ANTI-ARMOR)" : ""}`);
    out.push(`${r.dealt} THROUGH · ${pc.name.toUpperCase()} HEALTH ${before} → ${pc.health.current}/${pc.health.max}`);
    for (const w of r.wounds) out.push(`WOUND ${w.n}/${pc.wounds.max}${w.carryover ? ` (${w.carryover} carried over)` : ""}: ${woundText(w)}${w.applied.length ? ` [${w.applied.join("; ")}]` : ""}`);
    if (r.dead) out.push(`${pc.name.toUpperCase()} IS DEAD`);
    else if (r.deathSave) out.push("DEATH SAVE");
    return out;
  }

  hurtCrew(pc, amount, opts, head) {
    const before = pc.health.current;
    const r = applyDamage(pc, amount, opts);
    r.aa = !!opts.aa;
    return this.logHit(pc, r, before, head);
  }
  logHit(pc, r, before, head) {
    if (r.skipped) { this.addLog("note", `${pc.name} is already dead.`); return r; }
    this.addLog("roll", this.hitLines(pc, r, before, head).join("\n"), { combat: true, by: pc.name });
    if (r.deathSave) this.callDeathSave(pc, "at Maximum Wounds or a fatal injury");
    this.crewChanged();
    return r;
  }

  // The one Death Save: rolled in secret (1d10, 0-9), kept out of every view, revealed with the Reveal button or the agent's reveal_death_save.
  callDeathSave(pc, why = "") {
    if ((this.state.deathSaves ||= {})[pc.id] !== undefined) return;
    this.state.deathSaves[pc.id] = rollDeathSave();
    this.addLog("note", `Death Save rolled (hidden) for ${pc.name}${why ? ` (${why})` : ""}. Reveal it when someone spends a turn checking their vitals.`, { secret: true });
  }

  revealDeathSave(pc) {
    const roll = this.state.deathSaves?.[pc.id];
    if (roll === undefined) return false;
    delete this.state.deathSaves[pc.id];
    const o = applyDeathSave(pc, roll);
    this.addLog("roll", `${pc.name.toUpperCase()}: DEATH SAVE REVEALED · ROLLED ${String(roll).padStart(2, "0")}\n${deathSaveText(o).toUpperCase()}`, { combat: true, by: pc.name });
    this.crewChanged();
    return true;
  }

  creatureAttack({ by, attack, target }) {
    const adv = this.adversaryNamed(by);
    const pc = this.state.config.crew.find((c) => c.id === crewTargets(target, this.state.config.crew)[0]);
    const st = adv?.adversary.stats;
    if (!adv || !pc) return this.addLog("note", `Attack not made: ${!adv ? `no adversary named "${by}" with combat numbers` : `no crew member "${target}"`}.`);
    if (st.dead) return this.addLog("note", `Attack not made: ${adv.name} is dead or destroyed.`);
    const atk = st.attacks.find((a) => keyOf(a.name) === keyOf(attack)) || st.attacks.find((a) => keyOf(attack) && keyOf(a.name).includes(keyOf(attack))) || st.attacks[0];
    if (!atk) return this.addLog("note", `${adv.name} has no attacks listed.`);
    const chk = combatCheck(st.combat);
    const who = shownName(adv).toUpperCase();
    const head = `${who} ATTACKS ${pc.name.toUpperCase()} WITH ${atk.name.toUpperCase()}${atk.aa ? " (ANTI-ARMOR)" : ""}${atk.special ? ` (${atk.special.toUpperCase()})` : ""}\nCOMBAT ${st.combat} · ROLLED ${String(chk.d).padStart(2, "0")} · ${chk.success ? (chk.critical ? "CRITICAL SUCCESS" : "HIT") : chk.critical ? "CRITICAL FAILURE" : "MISS"}`;
    if (!chk.success) return this.addLog("roll", head, { combat: true, by: pc.name });
    const dmg = rollWithAdv(atk.damage, "");
    this.hurtCrew(pc, dmg.total, { type: atk.woundType, woundAdv: atk.woundAdv, aa: !!atk.aa }, `${head}\n${atk.damage}: ${dmg.rolls.join(" + ") || dmg.total}`);
  }

  crewAttack({ pc, weapon, target, damageAdv = "", range = "" }) {
    const adv = this.adversaryNamed(target);
    const st = adv?.adversary.stats;
    if (!pc || !adv) return this.addLog("note", `Attack not made: ${!pc ? "no such crew member" : `no adversary named "${target}" with combat numbers`}.`);
    if (isDead(pc)) return this.addLog("note", `Attack not made: ${pc.name} is dead.`);
    if (st.dead) return this.addLog("note", `Attack not made: ${adv.name} is already dead or destroyed.`);
    const w = this.crewWeapon(pc, weapon);
    if (!spendShot(pc, w)) return this.addLog("note", `Attack not made: ${pc.name}'s ${w.name} is out of shots (0/${w.shots}). Reloading is an action.`);
    range = rangeOf(range);
    const expr = weaponDamage(w, pc.stats.strength, range);
    const farShot = expr !== weaponDamage(w, pc.stats.strength);
    const d = rollWithAdv(expr, cancelAdv(damageAdv));
    const was = st.wounds;
    const m = damageAdversary(st, d.total, { aa: w.aa });
    const who = shownName(adv).toUpperCase();
    const dice = /d/i.test(expr) ? `${expr}: ${d.rolls.join(" + ")}${d.all.length > 1 ? ` (${d.all.join(" / ")}, kept the ${damageAdv === "+" ? "higher" : "lower"})` : ""} = ` : "";
    const lines = [`${pc.name.toUpperCase()} HITS ${who} WITH ${w.name.toUpperCase()}${range ? ` AT ${RANGE_LABELS[range].toUpperCase()} RANGE` : ""}${farShot ? ` (${expr.toUpperCase()} AT LONG RANGE OR FURTHER)` : ""}`,`${dice}${d.total} DAMAGE${m.dr ? ` · DR ${m.dr}` : ""}`];
    if (m.armorIgnored) lines.push(`ITS ARMOR ABSORBS IT`);
    if (m.armorDestroyed) lines.push(`ITS ARMOR IS DESTROYED${w.aa ? " (ANTI-ARMOR)" : ""}`);
    lines.push(m.dead ? `${who} IS DEAD OR DESTROYED` : m.woundsLost ? `${who} LOSES ${m.woundsLost === 1 ? "A WOUND" : `${m.woundsLost} WOUNDS`}` : `${m.dealt} THROUGH`);
    if (w.effect) lines.push(`${w.name.toUpperCase()} (PSG): ${w.effect.toUpperCase()}`);
    if (w.shots) lines.push(`${w.name.toUpperCase()}: ${loaded(pc, w)} OF ${w.shots} SHOTS LEFT${loaded(pc, w) ? "" : ", RELOAD NEEDED"}`);
    this.addLog("roll", lines.join("\n"), { combat: true, by: pc.name });
    this.addLog("note", `${adv.name}: ${statsLine(st)} (was ${was} Wounds).`);
    this.crewChanged();
  }

  crewWeapon(pc, weapon) {
    return weaponsOf(pc.items).find((x) => keyOf(x.name) === keyOf(weapon)) || weaponByName(weapon) || weaponsOf(pc.items)[0];
  }

  // Reloading is an action (PSG): swap in a spare magazine.
  reloadWeapon(pc, weapon) {
    if (!pc || isDead(pc)) return;
    const w = this.crewWeapon(pc, weapon);
    const r = reload(pc, w);
    this.addLog("note", r.ok ? `${pc.name} reloads the ${w.name}: ${r.left}/${w.shots} shots, ${r.spare} spare magazine${r.spare === 1 ? "" : "s"} left.` : `${pc.name} can't reload: ${r.why}`);
    this.crewChanged();
  }

  syncHazards() {
    const s = this.state;
    const raw = s.station?.hazards;
    const hz = normalizeHazards(raw);
    for (const [room, h] of Object.entries(hz)) if (h.type === "oxygen" && raw[room]?.supply === undefined) h.supply = this.oxygenStart();
    if (Object.keys(hz).length) s.station.hazards = hz;
    else if (s.station) delete s.station.hazards;
    this.syncLifeSupport();
  }
  oxygenStart() { return oxygenStart(this.state.config.shipCrew || this.state.config.crew.length || 1); }

  hazardsFor(pc) {
    const hz = this.state.station.hazards || {};
    return [hz[roomId(this.roomOfPc(pc.id))], this.onRig(pc) && hz[RIG]].filter(Boolean);
  }
  // The rig's own life support is a hazard keyed "rig": it reaches everyone aboard (the whole rig in transit, the rig's rooms when docked).
  onRig(pc) {
    const p = this.state.campaign, c = campaignById(p?.id), story = c?.stories.find((x) => x.id === p?.current);
    return !!story && (isTransit(story) || c.ship.rooms.includes(roomId(this.roomOfPc(pc.id))));
  }
  syncLifeSupport() {
    const s = this.state, rig = s.station?.rig;
    if (!s.campaign || !rig) return;
    const off = /offline/i.test(String(rig.life_support ?? ""));
    const on = s.station.hazards?.[RIG]?.type === "oxygen";
    if (off && !on) this.setHazard(RIG, "oxygen");
    else if (!off && on) this.setHazard(RIG, "none");
  }
  thinAir(pc) {
    const live = breathing(this.state.config.crew).length;
    return this.hazardsFor(pc).some((h) => h.type === "oxygen" && oxygenState(h.supply, live).low) && !protection(pc, "oxygen");
  }
  condWhy(pc, req) { return req.check === PANIC ? [] : penalties(pc, { thinAir: this.thinAir(pc) }); }
  // A weapon's range effect on the Combat check (Smart Rifle [-] at Close), when the Warden named the weapon and range on the roll.
  weaponCheckAdv(pc, req) {
    if (req.check !== "combat" || !req.range || !req.weapon) return "";
    const w = weaponsOf(pc.items).find((x) => keyOf(x.name) === keyOf(req.weapon)) || weaponByName(req.weapon);
    const a = checkAdvantage(w, req.range);
    return a ? { adv: a === "-" ? "disadvantage" : "advantage", why: `${w.name} at ${RANGE_LABELS[req.range]} Range ([${a}])` } : "";
  }
  advOpts(pc, req, plus = false) { return { close: this.closeTo(pc), plus, more: [...(this.condWhy(pc, req).length ? ["disadvantage"] : []), ...(pc.cond?.boost > 0 ? ["advantage"] : []), ...[this.weaponCheckAdv(pc, req).adv].filter(Boolean)] }; }
  advWhy(pc, req) { return [...(req.check === "fear" && this.closeTo(pc).some((c) => c.className === "Android") ? ["an Android is close"] : []), ...this.condWhy(pc, req), ...(pc.cond?.boost > 0 ? ["a stimpak ([+])"] : []), ...[this.weaponCheckAdv(pc, req).why].filter(Boolean)]; }
  condMap() { return Object.fromEntries(this.state.config.crew.map((pc) => [pc.id, conditionText(pc)])); }
  hazardWork() { return this.hazardUnits.length + this.hazardNeeds.length; }

  setHazard(rawRoom, rawType, level, supply) {
    const s = this.state;
    const room = roomId(rawRoom), type = String(rawType ?? "").toLowerCase().trim();
    if (!room) return false;
    const hz = s.station.hazards ||= {};
    const was = hz[room];
    if (!type || type === "none") {
      if (!was) return false;
      delete hz[room];
      if (!Object.keys(hz).length) delete s.station.hazards;
      this.addLog("note", `Hazard ended in ${this.roomName(room)}:${HAZARDS[was.type].name}.`);
    } else {
      if (!HAZARDS[type]) return false;
      const same = was?.type === type;
      const next = normalizeHazards({ [room]: { type, level, since: same ? was.since : undefined, rounds: same ? was.rounds : 0, hours: same ? was.hours : 0, supply: Number.isFinite(Number(supply)) && supply !== "" && supply !== null ? supply : same ? was.supply : this.oxygenStart() } })[room];
      hz[room] = next;
      const info = HAZARDS[type];
      if (same && was.level === next.level && was.supply === next.supply) return false;
      this.addLog("note", `Hazard in ${this.roomName(room)}: ${info.name}${next.level ? ` level ${next.level}` : ""} (${hazardTag(info)}). ${info.rule}`);
      if (!same && ["event", "exposure"].includes(info.per)) this.hazardUnits.push({ u: "event", room, type });
    }
    this.sendHeader();
    this.pumpHazards();
    return true;
  }
  applyHazardChanges(list) {
    for (const h of list || []) this.setHazard(h.room, h.type, h.level);
  }

  hazardDamage(pc, n, type, why = "", opts = {}) {
    const before = pc.health.current;
    const res = hazardDamage(pc, n, type, opts);
    if (!res.n) return;
    this.logHit(pc, res.result, before, `${pc.name.toUpperCase()} TAKES ${res.n} DAMAGE${why ? ` (${why.toUpperCase()})` : ""}`);
  }

  advanceRound() {
    this.hazardUnits.push({ u: "round" });
    this.pumpHazards();
  }
  passTime(hours) {
    const n = Math.max(0, Math.min(72, Math.round(Number(hours) || 0)));
    if (!n) return;
    this.addLog("note", `${n} hour${n > 1 ? "s" : ""} pass.`);
    for (let i = 0; i < n; i++) this.hazardUnits.push({ u: "hour" });
    this.pumpHazards();
  }

  pumpHazards() {
    const s = this.state;
    for (let guard = 0; guard < 2000; guard++) {
      if (s.roll?.status === "waiting") break;
      if (this.hazardNeeds.length) { this.startHazardRoll(); break; }
      const unit = this.hazardUnits.shift();
      if (!unit) break;
      this.runUnit(unit);
    }
    this.crewChanged();
  }

  runUnit(unit) {
    const s = this.state, crew = s.config.crew, hz = s.station.hazards || {};
    const note = (pc, text) => this.addLog("note", `${pc.name}: ${text}.`);
    if (unit.u === "event") {
      const h = hz[unit.room];
      if (!h || h.type !== unit.type) return;
      const who = h.type === "breach" ? crew : crew.filter((pc) => roomId(this.roomOfPc(pc.id)) === unit.room);
      for (const pc of who) this.hazardNeeds.push(...eventNeeds(pc, h));
      if (!who.length) this.addLog("note", `${HAZARDS[h.type].name} in ${unit.room}: nobody is there.`);
      return;
    }
    const hour = unit.u === "hour";
    for (const pc of crew) {
      const res = hour ? hourTick(pc, this.hazardsFor(pc), undefined, { food: !this.state.campaign || this.state.rationing }) : roundTick(pc, this.hazardsFor(pc));
      for (const e of res.events) note(pc, e);
      for (const t of res.skipped || []) note(pc, `${HAZARDS[t].name} is a per-round hazard and wasn't run for the hour: use Next round, or rule it`);
      for (const d of res.damage) this.hazardDamage(pc, d.n, d.type, d.why, d.armor ? { direct: false } : {});
      if (hour) this.hourOfRounds(pc);
      else if (deathSaveCountdown(pc)) this.callDeathSave(pc, "a Lethal Injury was not dealt with");
      this.hazardNeeds.push(...res.needs);
    }
    for (const [room, h] of Object.entries(hz)) {
      if (hour) {
        h.hours++;
        if (h.type === "oxygen" && h.hours % 24 === 0) this.oxygenDay(room, h);
      } else h.rounds++;
    }
    if (hour) this.sendHeader();
  }

  // An hour is 360 rounds: Bleeding and burning run until stopped (RULES.md Bleeding, Wounds Table), and a Lethal Injury's Death Save (1d10 rounds) falls due.
  hourOfRounds(pc) {
    const c = pc.cond;
    if (c.bleeding > 0 || c.fire) this.addLog("note", `${pc.name}: ${[c.bleeding > 0 && `Bleeding ${c.bleeding}`, c.fire && "on fire"].filter(Boolean).join(" and ")} for a whole hour, round by round.`);
    for (let r = 0; r < 3600 / ROUND_SECONDS && !isDead(pc) && this.state.deathSaves?.[pc.id] === undefined && (c.bleeding > 0 || c.fire); r++) {
      if (c.bleeding > 0) this.hazardDamage(pc, c.bleeding, "bleeding", `Bleeding ${c.bleeding}`);
      if (c.fire && !isDead(pc) && this.state.deathSaves?.[pc.id] === undefined) this.hazardDamage(pc, rollDice(`${c.burn || 2}d10`).total, "fire", "on fire", { direct: false });
    }
    if (pc.deathSaveIn > 0 && !isDead(pc)) { delete pc.deathSaveIn; this.callDeathSave(pc, "a Lethal Injury was not dealt with"); }
  }

  oxygenDay(room, h) {
    const crew = this.state.config.crew;
    const r = oxygenDay(h.supply, crew);
    h.supply = r.supply;
    this.addLog("note", `Life support offline in ${room}: oxygen supply ${r.supply} after 24 hours (${r.breathing} breathing, ${r.use} used).${r.gone ? " Supply gone: as no oxygen." : r.save ? " Under the breathing crew: Body Save or Death Save." : r.low ? " Under twice the breathing crew: [-] on all rolls." : ""}`);
    if (!r.save) return;
    for (const pc of breathing(crew)) if (this.hazardsFor(pc).includes(h) && !protection(pc, "oxygen")) this.hazardNeeds.push(oxygenNeed(pc));
  }

  startHazardRoll() {
    const s = this.state;
    const key = (n) => `${n.kind}|${n.check}|${n.advantage}|${n.reason}`;
    const first = this.hazardNeeds[0];
    const group = this.hazardNeeds.filter((n) => key(n) === key(first));
    this.hazardNeeds = this.hazardNeeds.filter((n) => key(n) !== key(first));
    const who = group.map((n) => this.crewById(n.pc)).filter((pc) => pc && playable(pc));
    if (!who.length) return;
    const req = sanitizeRequest({ pc: "all", check: first.check, advantage: first.advantage, reason: first.reason }, who);
    req.hazard = Object.fromEntries(group.map((n) => [n.pc, n]));
    s.roll = req;
    this.addLog("note", `Roll called for ${who.map((p) => p.name).join(", ")}: ${[checkLabel(req), req.reason].filter(Boolean).join(" · ")}`);
    this.toPlayers({ t: "roll", roll: this.publicRoll() });
  }

  settleHazard(pc, n, result) {
    const out = settle(pc, n, result);
    if (out.text) this.addLog("note", `${pc.name}: ${out.text}.`);
    if (out.stress) this.stressFromRoll(pc, out.stress, "infohazard");
    if (out.damage) this.hazardDamage(pc, out.damage, out.dtype, n.reason.toLowerCase());
    if (out.wounds) {
      const w = hazardWound(pc, out.dtype);
      this.addLog("roll", `${pc.name.toUpperCase()} TAKES A WOUND (${n.reason})\nWOUND ${pc.wounds.current}/${pc.wounds.max}: ${woundText(w.wound)}${w.wound.applied.length ? ` [${w.wound.applied.join("; ")}]` : ""}`, { combat: true, by: pc.name });
      if (w.wound.dead) this.addLog("note", `${pc.name} is dead.`);
      else if (w.atMax || w.wound.deathSave) this.callDeathSave(pc, "at Maximum Wounds");
    }
    if (out.deathSave) this.callDeathSave(pc, n.reason.toLowerCase());
  }

  rollAllHazard() {
    for (let guard = 0; guard < 500; guard++) {
      const r = this.state.roll;
      if (!r || r.status !== "waiting" || !r.hazard) break;
      for (const p of r.pcs) {
        const pc = this.crewById(p.id);
        if (pc && !r.results[p.id]) this.rollFor(pc, null, { by: "warden" });
      }
    }
  }

  crewCondition(id, action, value) {
    const pc = this.crewById(id);
    if (!pc) return;
    const c = pc.cond;
    const say = (t) => this.addLog("note", `${pc.name}: ${t}.`);
    switch (action) {
      case "puncture": say(`suit punctured: decompresses in ${puncture(c)} round${c.puncture > 1 ? "s" : ""}`); break;
      case "patch": patch(c); say("suit patched (Patch Kit; a patched vaccsuit is AP 1)"); break;
      case "air": airRestored(c); say("breathing again"); break;
      case "putout": c.fire = false; c.burn = 0; say("fire put out"); break;
      case "bleed": c.bleeding = Math.min(99, c.bleeding + (Number(value) || 1)); say(`Bleeding ${c.bleeding}`); break;
      case "stopbleed": c.bleeding = 0; say("bleeding stopped (First Aid Kit)"); break;
      case "ate": {
        const rig = this.state.station.rig;
        if (this.state.campaign && this.state.rationing && rig) {
          if (!(Number(rig.rations) > 0)) { this.send("dm", { t: "toast", level: "error", text: "The rig has no rations (MREs) left." }); break; }
          rig.rations = Number(rig.rations) - 1;
          this.sendHeader();
        }
        c.fed = 0;
        say("has eaten");
        break;
      }
      case "thirst": c.thirsty = !c.thirsty; say(c.thirsty ? "water at the minimum" : "has water"); break;
      case "rest": rest(c, 8); say("rested 8 hours"); break;
      case "strenuous": c.strenuous = !c.strenuous; say(c.strenuous ? "strenuous activity" : "not strenuous"); break;
      case "strenuouscheck": if (c.thirsty) { this.hazardNeeds.push(strenuousNeed(pc)); this.pumpHazards(); } break;
      case "cryosleep": c.cryosleep = true; say("goes into cryosleep"); break;
      case "wake": if (!c.cryosleep) return; wake(c); say("wakes from cryosleep: [-] on all rolls for a week (cryosickness)"); break;
      case "stimpak": if (changeItem(pc, "use", "stimpak")) this.takeStimpak(pc); else this.send("dm", { t: "toast", level: "error", text: `${pc.name} has no stimpak.` }); break;
      case "tankout": {
        if (!changeItem(pc, "use", "oxygen tank")) { this.send("dm", { t: "toast", level: "error", text: `${pc.name} has no oxygen tank.` }); break; }
        const more = pc.items.some((x) => /oxygen tank/i.test(x));
        if (more) c.air = 0;
        say(more ? "swaps to a fresh oxygen tank" : "the last oxygen tank is used up");
        break;
      }
      case "pills": { const n = takePills(c); say("takes Radiation Pills: Radiation Level -1 for 2d10 minutes"); this.hazardDamage(pc, n, "pills", "Radiation Pills"); break; }
      case "clearrad": c.rad = 0; say("radiation penalty cleared"); break;
      case "cleartags": c.tags = []; say("conditions cleared"); break;
      default: return;
    }
    this.crewChanged();
  }

  // The PSG stimpak effect and the overdose roll for a dose whose item has already been used up.
  takeStimpak(pc) {
    if (isDead(pc)) return;
    const r = useStimpak(pc);
    this.addLog("note", `${pc.name} uses a stimpak: Stress ${r.stress}, +${r.heal} Health (1d10 rolled ${r.rolled}), [+] on all rolls for ${r.minutes} minute${r.minutes > 1 ? "s" : ""}, cryosickness cured.`);
    if (r.overdose) {
      this.addLog("note", `Stimpak overdose roll (dose ${r.doses} in 24 hours): 1d10 rolled ${r.overdose.roll}, ${r.overdose.deathSave ? `under ${r.doses}: Death Save` : `not under ${r.doses}: no effect`}.`);
      if (r.overdose.deathSave) this.callDeathSave(pc, "a stimpak overdose");
    }
    this.crewChanged();
  }

  applyAttacks(reply) {
    const s = this.state, crew = s.config.crew;
    for (const a of reply?.crew_attacks || []) {
      const pc = crew.find((c) => c.id === crewTargets(a.by, crew)[0]);
      const got = pc && s.roll?.check === "combat" && s.roll.results?.[pc.id];
      if (!got?.result.success || got.attacked) { this.addLog("note", `${pc?.name || a.by}'s attack was not applied: no successful, unspent Combat check.`); continue; }
      const w = this.crewWeapon(pc, a.weapon);
      if (w.shots && loaded(pc, w) <= 0) { this.addLog("note", `${pc.name}'s attack was not applied: the ${w.name} is out of shots (0/${w.shots}); reloading is an action.`); continue; }
      got.attacked = true;
      this.crewAttack({ pc, weapon: a.weapon, target: a.target, range: a.range || s.roll.range });
    }
    for (const r of reply?.reloads || []) this.reloadWeapon(crew.find((c) => c.id === crewTargets(r.by, crew)[0]), r.weapon);
    for (const a of reply?.attacks || []) this.creatureAttack(a);
    for (const name of reply?.reveal_death_save || []) {
      const pc = crew.find((c) => c.id === crewTargets(name, crew)[0]);
      if (pc) this.revealDeathSave(pc);
    }
    if (reply?.round) this.advanceRound();
  }

  // Stress gained above 20 reduces the most relevant Stat or Save by that much (PSG 20.1). After a failed check that is the Stat or Save just rolled; otherwise the Warden picks.
  stressOver(pc, over, check = "") {
    if (!over) return;
    const group = pc.stats[check] !== undefined ? pc.stats : pc.saves[check] !== undefined ? pc.saves : null;
    if (!group) return this.addLog("note", `${pc.name}: Stress over 20: reduce the most relevant Stat or Save by ${over} (PSG 20.1). Edit it on the Crew tab.`);
    const was = group[check];
    group[check] = Math.max(1, was - over);
    this.addLog("note", `${pc.name}: Stress over 20 by ${over}, so ${CHECKS[check].label}${CHECKS[check].kind === "Save" ? " Save" : ""} ${was} → ${group[check]} (PSG 20.1 says "the most relevant Stat or Save"; taking the one just rolled is the app's reading).`);
  }

  applyCrewChanges(changes) {
    if (!this.state.config.agentCrew) return;
    let any = false;
    for (const c of changes || []) {
      for (const id of crewTargets(c.for, this.state.config.crew)) {
        const pc = this.state.config.crew.find((x) => x.id === id);
        if (c.stat === "health" && c.change < 0) {
          this.hurtCrew(pc, -c.change, { direct: true }, `${pc.name.toUpperCase()} IS HURT${c.why ? `: ${c.why.toUpperCase()}` : ""}`);
          continue;
        }
        const cur = c.stat === "stress" ? pc.stress : pc[c.stat]?.current;
        const gain = c.stat === "stress" && c.change > 0 ? gainStress(pc, c.change) : null;
        const ch = gain ? [gain.from, gain.to] : cur === undefined ? null : setVital(pc, c.stat, cur + c.change);
        if (!ch || ch[0] === ch[1]) { if (gain) this.stressOver(pc, gain.over); continue; }
        this.addLog("note", `${pc.name}: ${label(c.stat)} ${ch[0]} → ${ch[1]}${c.why ? ` (${c.why})` : ""}.`);
        if (gain) this.stressOver(pc, gain.over);
        if (c.stat === "wounds" && ch[1] >= pc.wounds.max && ch[0] < pc.wounds.max) this.callDeathSave(pc);
        any = true;
      }
    }
    if (any) this.crewChanged();
  }

  applyMoves(moves) {
    const terms = this.state.config.terminals;
    const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\bterminal\b/g, "").trim();
    for (const m of moves || []) {
      const want = norm(m.terminal);
      const t = terms.find((x) => x.id === m.terminal || norm(x.name) === want) || terms.find((x) => want && (norm(x.name).includes(want) || want.includes(norm(x.name))))
        || terms.find((x) => x.look.includes("portable")) || terms.find((x) => x.id === "portable");
      if (!t) continue;
      const everyone = /^(all|everyone|everybody|the crew|crew)$/i.test(String(m.for).trim());
      const ids = everyone ? null : new Set(crewTargets(m.for, this.state.config.crew));
      for (const ws of this.sockets) {
        if (ws.role !== "player" || !ws.terminal || ws.terminal === t.id) continue;
        if (everyone || ids.has(ws.character)) {
          const was = ws.terminal;
          this.playerTerminal(ws, t.id, "agent");
          if (ws.terminal !== was) this.delivering?.moved.push([ws, was]);
        }
      }
    }
  }

  applyItemChanges(changes) {
    if (!this.state.config.agentCrew) return;
    let any = false;
    for (const c of changes || []) {
      for (const id of crewTargets(c.for, this.state.config.crew).slice(0, 1)) {
        const pc = this.state.config.crew.find((x) => x.id === id);
        const did = changeItem(pc, c.action, c.item);
        if (!did) continue;
        this.addLog("note", `${pc.name} ${did}${c.why ? ` (${c.why})` : ""}.`);
        if (c.action !== "add" && /first aid kit/i.test(did)) this.crewCondition(pc.id, "stopbleed");
        if (c.action === "use" && /stimpak/i.test(did)) this.takeStimpak(pc);
        any = true;
      }
    }
    if (any) this.crewChanged();
  }

  logDirectives(directives = []) {
    for (const d of directives) this.addLog("warden", d);
  }

  undoSnapshot() {
    return { entries: [], effects: [], station: structuredClone(this.state.station), crew: structuredClone(this.state.config.crew), cast: structuredClone(this.state.config.cast), revealed: this.state.config.voices.filter(isAdversary).map((v) => [v.id, v.adversary.revealed]), outcome: this.state.outcomeCheck, map: this.state.config.map, rooms: structuredClone(this.state.config.rooms), deathSaves: structuredClone(this.state.deathSaves || {}), adversaries: this.state.config.voices.filter((v) => v.adversary?.stats).map((v) => [v.id, structuredClone(v.adversary.stats)]), roll: this.state.roll && structuredClone(this.state.roll), hazardUnits: structuredClone(this.hazardUnits), hazardNeeds: structuredClone(this.hazardNeeds), offers: structuredClone(this.state.offers || []), clocks: structuredClone(this.state.clocks || []), handouts: [], found: [], moved: [], altered: [], ship: shipSnapshot(this) };
  }

  deliver(reply, source) {
    this.delivering = this.undoSnapshot();
    try {
      this.deliverReply(reply, source);
    } finally {
      const undo = this.delivering;
      this.delivering = null;
      if (source === "agent" && (undo.entries.length || undo.altered.length)) this.undoStack = [...this.undoStack, undo].slice(-UNDO_CAP);
    }
  }

  retcon() {
    const undo = this.undoStack.pop();
    if (!undo) return;
    const s = this.state;
    this.dropReply();
    s.log = s.log.filter((e) => !undo.entries.includes(e.id));
    for (const id of undo.effects) this.endEffect(id);
    s.station = undo.station;
    if (undo.cast) s.config.cast = undo.cast;
    for (const [id, revealed] of undo.revealed || []) { const v = s.config.voices.find((x) => x.id === id); if (v?.adversary) v.adversary.revealed = revealed; }
    if (undo.map !== undefined) Object.assign(s.config, { map: undo.map, rooms: undo.rooms });
    for (const pc of s.config.crew) {
      const was = undo.crew.find((x) => x.id === pc.id);
      if (!was) continue;
      for (const k of ["status", "statusNote", "deathSaveIn"]) if (k in was) pc[k] = was[k]; else delete pc[k];
      Object.assign(pc, { health: was.health, wounds: was.wounds, stress: was.stress, minStress: was.minStress, items: was.items, ammo: was.ammo, cond: was.cond, stats: was.stats, saves: was.saves, armor: was.armor });
    }
    s.deathSaves = undo.deathSaves;
    for (const [id, stats] of undo.adversaries || []) { const v = s.config.voices.find((x) => x.id === id); if (v?.adversary) v.adversary.stats = stats; }
    if (s.roll && undo.roll && s.roll.id === undo.roll.id) s.roll.results = undo.roll.results;
    else if ((s.roll?.id ?? null) !== (undo.roll?.id ?? null)) { s.roll = undo.roll || null; this.toPlayers({ t: "roll", roll: s.roll ? this.publicRoll() : null }); }
    this.hazardUnits = undo.hazardUnits || [];
    this.hazardNeeds = undo.hazardNeeds || [];
    s.offers = undo.offers || [];
    s.outcomeCheck = undo.outcome;
    this.undoDelivered(undo);
    restoreShip(this, undo.ship);
    if (undo.ended && ["ended", "play"].includes(s.solo?.phase)) {
      s.solo = undo.solo;
      s.campaign = undo.campaign;
      this.moneySync();
      this.soloChanged();
    }
    this.playhead = 0;
    this.addLog("note", "↶ Retconned the agent's last reply.");
    this.initPlayers();
    this.crewChanged();
  }

  // The parts of an agent reply that are not in the saved state: clocks, handouts and found files given out, screens moved.
  undoDelivered(undo) {
    const s = this.state;
    const now = Date.now();
    for (const c of [...s.clocks]) if (!undo.clocks.some((x) => x.id === c.id)) this.removeClock(c);
    for (const c of undo.clocks) {
      if (s.clocks.some((x) => x.id === c.id) || (!c.paused && c.ends <= now)) continue;
      const back = structuredClone(c);
      s.clocks.push(back);
      this.scheduleClock(back);
    }
    this.clocksChanged();
    const gone = new Set(undo.handouts);
    if (gone.size) {
      s.handouts = s.handouts.filter((h) => !gone.has(h.id));
      for (const id of gone) this.toPlayers({ t: "handoutGone", id });
    }
    s.found = (s.found || []).filter((id) => !undo.found.includes(id));
    restoreAltered(this, undo.altered || []);
    for (const [ws, terminal] of undo.moved) if (this.sockets.has(ws) && ws.terminal !== terminal) this.playerTerminal(ws, terminal, "agent");
  }

  deliverReply(reply, source) {
    const oc = reply?.outcome_check;
    if (oc?.needed && !this.state.solo) {
      this.state.outcomeCheck = { ...oc, id: Date.now().toString(36), at: Date.now() };
      this.addLog("note", `⚖ Outcome needed: ${oc.attempt || "(unspecified)"}${suggestion(oc)}`);
    }
    const voices = this.state.config.voices;
    const lines = splitVoiceTags(
      (reply?.lines || []).map((l) => ({ voice: resolveVoice(l.voice, voices) ?? BUILTIN.terminal, character: String(l.character ?? "").slice(0, 60), inPerson: !!(l.inPerson ?? l.in_person), system: String(l.system ?? ""), reveal: String(l.reveal ?? "").slice(0, 60), text: String(l.text ?? "").slice(0, 8000), effects: l.effects, variants: l.variants })),
      voices,
    );
    if (source === "agent") this.applyMoves(reply?.moves);
    if (source === "agent") this.applyCastChanges(reply?.cast_changes);
    const here = this.defaultNet();
    const split = this.occupiedNets().size > 1;
    const useEffects = this.state.config.agentEffects;
    const changes = (reply?.station_changes || []).filter((c) => c && typeof c.path === "string" && c.path);
    const effects = useEffects ? (reply?.effects || []) : [];
    const mapChanges = this.mapChanges(reply);
    let meta = { changes: changes.map(({ path, value }) => ({ path, value })), effects: effects.map(({ type, text, seconds }) => ({ type, text, seconds })), crewChanges: this.state.config.agentCrew ? (reply?.crew_changes || []) : [], itemChanges: this.state.config.agentCrew ? (reply?.item_changes || []) : [], moves: reply?.moves || [], castChanges: reply?.cast_changes || [], clockChanges: reply?.clocks || [], handouts: reply?.handouts || [], hazardChanges: reply?.hazards || [], timePasses: reply?.time_passes?.hours || 0, ...mapChanges };
    let waiting = [];
    let lastEntry = null;
    const config = this.state.config;
    const channel = channelOf(config);
    let prev = null;
    for (let { voice, character, system, reveal, text, effects: lineFx, variants: rawVariants } of lines) {
      if (voice === BUILTIN.narrator && source === "agent" && config.narrator === false) continue;
      if (source === "agent" && character && !findCast(config.cast, character) && isCrew(config.crew, character)) continue;
      let member = character && voice === channel ? findCast(config.cast, character) : null;
      if (!member && character && voice === channel) {
        member = addCast(config.cast, character, { crew: config.crew }).member;
        if (member) this.addLog("note", `Cast: ${member.name} joins the story.`);
      }
      character = member?.name || "";
      if (member || this.speaksBySentence(voice)) { text = sentenceLines(text); for (const v of rawVariants || []) v.text = sentenceLines(v.text); }
      const variants = source === "agent" && !this.state.config.agentVariants ? [] : resolveVariants(rawVariants, this.state.config.crew);
      const cues = useEffects ? [...waiting, ...normalizeEffects(lineFx)] : [];
      if (!text && !variants.length) { waiting = cues.map((c) => ({ ...c, hold: c.type !== "sound" })); continue; }
      for (const c of cues) if (c.type === "blackout") c.hold = true;
      waiting = [];
      const named = netNamed(config, system);
      const asked = named === ALL_NET || (split && named !== null) ? named : here;
      let net, inPerson = false, room = "";
      if (member) ({ voice, net, inPerson, room } = this.castDelivery(member, asked));
      else {
        net = this.routeLine(voice, asked);
        if (net !== asked) this.addLog("note", `${voices.find((v) => v.id === voice)?.name || voice} ${asked === ALL_NET ? "isn't on every system" : `isn't on ${systemName(config, asked)}`}: its line went to ${systemName(config, net)}.`);
      }
      const kind = kindOf(voice);
      const shown = source === "agent" && reveal ? this.revealOnLine(reveal) : null;
      this.introduce(voice, net, { inPerson, done: prev === BUILTIN.narrator });
      prev = voice;
      const entry = this.addLog(kind, text, { source, net, ...(kind === "entity" ? { entity: voice } : {}), ...(character ? { character } : {}), ...(inPerson ? { inPerson: true, room } : {}), ...(variants.length ? { variants } : {}), ...(shown ? { reveal: shown } : {}), ...meta, ...(cues.length ? { cues } : {}) });
      meta = {};
      lastEntry = entry;
      for (const c of cues) this.startEffect(c, "agent", { atEntry: entry.id, when: "before", hold: c.hold });
    }
    for (const c of waiting) this.startEffect(c, "agent", lastEntry ? { atEntry: lastEntry.id, when: "after" } : null);
    if (source === "agent") this.applyCastChanges(reply?.cast_changes, "after");
    if (source === "agent") this.revealAdversaries(reply?.reveal);
    for (const id of this.panics?.splice(0) || []) {
      const member = this.state.config.cast.find((m) => m.id === id);
      if (member) this.castPanic(member);
    }
    for (const c of changes) {
      setPath(this.state.station, c.path, c.value);
      this.addLog("note", `Station: ${c.path} → ${c.value}`);
    }
    if (changes.length) { this.syncHazards(); this.sendHeader(); }
    this.applyMapChanges(mapChanges);
    if (source === "agent") {
      this.applyHazardChanges(reply?.hazards);
      if (reply?.time_passes?.hours > 0) this.passTime(reply.time_passes.hours);
      applyShipFight(this, reply?.ship_fight);
    }
    for (const e of effects) this.startEffect(e, "agent");
    this.applyCrewChanges(reply?.crew_changes);
    this.applyItemChanges(reply?.item_changes);
    if (source === "agent" && this.state.config.agentCrew) this.applyAttacks(reply);
    if (reply?.story_end?.ended && this.state.solo?.phase === "play") {
      // Retcon can take the ending back: the undo entry keeps the story and campaign as they were, and soloEnd records what it does into it.
      const undo = this.delivering;
      if (undo) Object.assign(undo, { ended: true, solo: structuredClone(this.state.solo), campaign: structuredClone(this.state.campaign ?? null) });
      setTimeout(() => this.soloEnd(reply.story_end.how, undo), 0);
    }
    for (const c of reply?.clocks || []) c.action === "stop" ? this.stopClock(c.label) : this.startClock(c.label, c.seconds, "agent");
    for (const f of reply?.found_docs || []) {
      const to = findCharacterId(this.state.config.crew, f.for);
      this.findRoomDoc(f.id, to, to ? this.crewById(to)?.name : "The crew");
    }
    if (source === "agent") applyCrewMessage(this, reply?.crew_message);
    for (const h of reply?.handouts || []) {
      const member = h.voice && findCast(this.state.config.cast, h.voice), vid = h.voice && !member && resolveVoice(h.voice, this.state.config.voices);
      this.giveHandout({ title: h.title, text: h.text, to: findCharacterId(this.state.config.crew, h.for), voice: member ? `cast:${member.id}` : vid || "" });
    }
  }

  mapChanges(reply) {
    const out = {};
    const layout = String(reply?.layout || "").trim();
    if (layout && layout !== this.state.config.map.trim()) out.layout = layout.slice(0, 4000);
    const plans = (reply?.room_plans || []).map((p) => ({ room: p.room, rows: sanitizeRows(p.rows) })).filter((p) => p.room && p.rows);
    if (plans.length) out.roomPlans = plans;
    return out;
  }

  applyMapChanges({ layout, roomPlans = [] }) {
    const c = this.state.config;
    if (layout) {
      c.map = layout;
      this.addLog("note", "Map: the agent changed the layout.");
    }
    for (const p of roomPlans) {
      c.rooms[p.room] = { rows: p.rows };
      this.addLog("note", `Map: the agent redrew the floor plan of ${p.room}.`);
    }
  }

  requestReply() {
    if (!this.hasKey()) { this.state.pending = null; this.syncDm(); return; }
    if (this.generating) this.rerun = true;
    else this.generate();
  }
  hasKey() { return !!keyFor(this.state.config.provider, this.keys); }

  async generate(steer) {
    const s = this.state;
    this.storyBegins();
    const myGen = ++this.genCounter;
    const forEntry = s.log.filter((e) => e.kind === "player").at(-1)?.id ?? null;
    const { model, effort } = s.config;
    const directives = currentDirectives(s, steer);
    const noCheck = !!s.solo && this.soloNoCheck;
    this.soloNoCheck = false;
    s.pending = { status: "generating", forEntry, steer: steer || "", model, directives };
    this.rerun = false;
    this.setBusy(true);
    this.syncDm();

    try {
      const { provider, apiKey } = this.modelAccess();
      const latest = s.log.findLast((e) => ["player", "warden", "roll", "aside"].includes(e.kind));
      if (s.config.checkFirst !== false && latest?.kind === "player" && !steer && !directives.length) {
        let oc = null;
        try { oc = await this.ask(buildPrecheck(s), "precheck"); } catch (err) { console.warn(`[${this.code}] check-first skipped: ${err?.message || err}`); }
        if (myGen !== this.genCounter) return;
        if (oc?.needed) return this.holdForWarden(oc, "");
      }
      const request = { apiKey, model, effort, ...buildRequest({ ...s, screens: this.screens(), defaultNet: this.defaultNet(), unheard: this.unheard() }, steer) };
      let reply;
      for (let attempt = 1; ; attempt++) {
        try {
          reply = parseReply(await this.callModel(provider, request, "reply"), s.config.voices, s.config.talk);
          break;
        } catch (err) {
          if (!err.malformed || attempt >= (provider.serverKeyOnly ? 3 : 2) || myGen !== this.genCounter) throw err;
          console.warn(`[${this.code}] retrying after malformed reply: ${err.message}`);
        }
      }
      if (myGen !== this.genCounter) return;

      s.whisper = "";
      if (reply.outcome_check.needed && s.config.checkFirst !== false && !noCheck) {
        this.logDirectives(directives);
        return this.holdForWarden(reply.outcome_check, reply.dm_note);
      } else if (s.config.mode === "auto") {
        this.logDirectives(directives);
        this.deliver(reply, "agent");
        if (reply.dm_note) this.addLog("note", `Agent: ${reply.dm_note}`);
        s.pending = null;
        this.setBusy(false);
      } else {
        s.pending = { status: "ready", forEntry, reply, model, directives };
        this.pregenerate(reply.lines.map((l) => ({ ...l, kind: kindOf(l.voice), entity: l.voice })));
      }
    } catch (err) {
      if (myGen !== this.genCounter) return;
      console.error(`[${this.code}] generation failed:`, err?.message || err);
      s.pending = { status: "error", forEntry, error: err?.message || String(err), model, directives };
      if (s.solo) {
        s.pending = null;
        this.setBusy(false);
        this.toPlayers({ t: "notice", text: `LINK ERROR: ${err?.message || err}` });
      }
    }
    this.touch();
    this.syncDm();
    if (this.rerun) this.generate();
  }

  soloView() {
    const x = this.state.solo;
    return x ? { phase: x.phase, pitches: x.pitches, busy: x.busy || "", error: x.error || "", notice: x.notice || "", title: x.title || "", ending: x.ending || "", recap: x.recap || null, after: x.after || null, ...(x.campaign ? { jobs: this.soloJobs() } : {}) } : null;
  }
  soloChanged() {
    this.toPlayers({ t: "solo", solo: this.soloView() });
    this.touch();
  }
  startSolo() {
    this.state.solo = { phase: "pick", pitches: [KESTREL_PITCH, CAMPAIGN_PITCH], busy: "", error: "", opened: false };
    Object.assign(this.state.config, { mode: "auto", checkFirst: true, agentCrew: true, agentEffects: true });
    this.soloPitches();
  }

  async soloPitches() {
    const x = this.state.solo;
    if (!x || x.busy || x.phase !== "pick") return;
    Object.assign(x, { busy: "pitches", error: "" });
    this.soloChanged();
    try {
      const fresh = normalizePitches(await this.ask(pitchesRequest(x.pitches.filter((p) => !p.builtin).map((p) => p.title)), "builder"));
      if (!fresh.length) throw new Error("no stories came back");
      x.pitches = [KESTREL_PITCH, CAMPAIGN_PITCH, ...fresh];
    } catch (err) {
      x.error = `Couldn't get stories: ${err?.message || err}. Try again, or play KESTREL-9.`;
    }
    x.busy = "";
    this.soloChanged();
  }

  async soloBuild(i) {
    const x = this.state.solo;
    const p = x?.pitches?.[i];
    if (!p || x.busy || x.phase !== "pick" || x.campaign) return;
    if (p.campaign) return this.soloCampaign(p.campaign);
    Object.assign(x, { title: p.title, error: "", opened: false });
    if (p.builtin) {
      const s = this.state, keep = { provider: s.config.provider, model: s.config.model, effort: s.config.effort };
      this.freshGame({ solo: x });
      Object.assign(this.state.config, keep, { mode: "auto", checkFirst: true });
      for (const ws of this.sockets) if (ws.role === "player") ws.character = null;
      x.phase = "play";
      this.addLog("note", "Story: KESTREL-9 (no Warden).");
      this.initPlayers();
      this.soloChanged();
      return this.syncDm();
    }
    Object.assign(x, { phase: "building", busy: "build", notice: "" });
    this.soloChanged();
    try {
      const build = async () => {
        const d = normalizeDraft(await this.ask(draftRequest(pitchBuilder(p)), "builder"));
        if (!d.crew?.length || !d.stationName || !d.map) throw Object.assign(new Error("the story came back incomplete"), { incomplete: true });
        return d;
      };
      let draft;
      try {
        draft = await build();
      } catch (err) {
        if (!err.incomplete && !/cut off|valid JSON|empty/i.test(err?.message || "")) throw err;
        console.warn(`[${this.code}] story build retry: ${err.message}`);
        draft = await build();
      }
      if (x.phase !== "building") return;
      x.phase = "play";
      this.applyStory(draft);
      Object.assign(this.state.config, { mode: "auto", checkFirst: true });
    } catch (err) {
      x.phase = "pick";
      x.error = `Couldn't build "${p.title}": ${err?.message || err}. Try again, or pick another.`;
    }
    x.busy = "";
    this.soloChanged();
    this.syncDm();
  }

  soloJobs() {
    const p = this.state.campaign, c = campaignById(p?.id);
    return c && !p.current ? jobsAt(c, p) : null;
  }

  soloCampaign(id) {
    const x = this.state.solo, c = campaignById(id);
    if (!c) return;
    this.state.campaign = newProgress(c);
    Object.assign(x, { campaign: true, error: "", after: null });
    this.addLog("note", `Campaign started: ${c.title} (no Warden). The pilot picks the jobs.`);
    for (const e of this.state.campaign.ledger) this.addLog("note", ledgerLine(this.state.campaign, e));
    this.addLog("note", `The rig carries a ${exact(this.state.campaign.debt)} note to Gallow-Mercer Finance, ${exact(DEBT_PAYMENT)} due every ${DEBT_EVERY} finished stories (house rule).`);
    this.moneySync();
    this.soloChanged();
    this.syncDm();
  }

  async soloJob(id) {
    const x = this.state.solo, s = this.state, p = s.campaign, c = campaignById(p?.id);
    const story = c && this.soloJobs()?.jobs.some((j) => j.id === id) && c.stories.find((t) => t.id === id);
    if (!story || x.busy || x.phase !== "pick") return;
    if (this.soloJobs().jobs.find((j) => j.id === id).short) {
      x.error = "NOT ENOUGH FUEL for that lane. Refuel first, or take another job.";
      return this.soloChanged();
    }
    Object.assign(x, { phase: "building", busy: "build", title: story.title, error: "", notice: "", opened: false, after: null });
    this.soloChanged();
    try {
      await this.buildCampaignStory(c, story, p);
      x.phase = "play";
      Object.assign(s.config, { mode: "auto", checkFirst: true, agentCrew: true, agentEffects: true });
    } catch (err) {
      console.error(`[${this.code}] campaign job failed:`, err?.message || err);
      x.phase = "pick";
      x.error = `Couldn't build "${story.title}": ${err?.message || err}. Try again, or pick another.`;
    }
    x.busy = "";
    this.soloChanged();
    this.syncDm();
  }

  // The story is over: record it in the campaign (the recap's verdict is the outcome; only the faction stakes the AI judged clearly earned count), then the crew's downtime.
  // A lane story is the trip itself: finishing it passes the lane's days, as campaignTravel does (once: finishInto only runs for the current story).
  transitDays(c, story) {
    const lane = isTransit(story) && laneBetween(c, story.from, story.to);
    if (!lane) return;
    const p = this.state.campaign;
    for (const l of passDays(p, [this.state.config.crew, p.crew], lane.days).concat(`${lane.days} days pass on ${lane.name} (day ${p.downtime.day}).`)) this.addLog("note", l);
  }

  soloFinish() {
    const x = this.state.solo, s = this.state, p = s.campaign, c = campaignById(p?.id);
    const story = c?.stories.find((t) => t.id === p.current);
    if (!story) return;
    const earned = (x.earned || []).filter((i) => Number.isInteger(i) && i >= 0 && i < (story.affinity || []).length);
    const done = finishInto(p, c, s.config, x.recap?.verdict || x.ending, earned, s.station, snapshotStory(s));
    if (!done) return;
    this.addLog("note", `Campaign story finished: ${story.title}.${p.done.at(-1).outcome ? ` ${p.done.at(-1).outcome}` : ""}`);
    const factions = done.changes.map((ch) => `${ch.name}: ${standingLabel(ch.from)} to ${standingLabel(ch.to)}${ch.why ? ` (${ch.why})` : ""}.`);
    if (!x.delivery) this.addLog("note", "The recap failed; paid as delivered in full: the Warden or pilot can adjust.");
    const paid = settleStory(p, c, story, { delivery: x.delivery?.delivery ?? "full", late: !!x.delivery?.late });
    factions.push(...paid.changes.map((ch) => `${ch.name}: ${standingLabel(ch.from)} to ${standingLabel(ch.to)}${ch.why ? ` (${ch.why})` : ""}.`));
    for (const l of factions) this.addLog("note", `Faction standing (house rule): ${l}`);
    for (const line of paid.lines) this.addLog("note", line);
    for (const e of paid.entries) this.addLog("note", ledgerLine(p, e));
    if (paid.handout) this.giveHandout(paid.handout);
    this.moneySync();
    this.transitDays(c, story);
    const results = restAndRecover(p.crew);
    for (const r of results) { if (r.recovery) markRested(p, r.id, "recovery"); if (r.rest) markRested(p, r.id, "rest"); }
    const rest = downtimeLines(results);
    crewFromCampaign(p, s.config.crew);
    this.addLog("note", `Downtime between stories (short-term recovery and a Rest Save for each, rolled for them):\n${rest.join("\n")}`);
    for (const r of results) for (const why of r.panics) this.soloPanic(this.crewById(r.id), why);
    x.after = { factions, rest, pay: paid.lines };
  }

  // A Critical Failure in the downtime rolls needs a Panic Check (PSG 14): nobody is at a roll prompt on the ending screen, so the dice roll it for them.
  soloPanic(pc, why) {
    if (!pc || !playable(pc)) return;
    const base = { check: PANIC, advantage: "none" }, req = { ...base, advantage: effectiveAdvantage(base, pc, this.advOpts(pc, base, false)) };
    const result = resolve(req, pc.stress, diceFor(req));
    const fx = result.success ? null : panicEntry(result.used);
    this.addLog("roll", `${pc.name} (downtime, ${why}): ${resultText(req, result)}${fx ? `: ${fx.name.toUpperCase()}` : ""}`, { outcome: result.outcome, by: pc.name, ...(fx ? { panicEffect: `${fx.name}: ${fx.effect}` } : {}) });
    if (fx) this.panicEffects(pc, fx);
  }

  // undo: the agent reply's Retcon entry when the agent ended the story, so its log notes, handouts and campaign changes are taken back with it.
  async soloEnd(how, undo = null) {
    const x = this.state.solo;
    if (!x || x.phase !== "play") return;
    const track = (fn) => {
      if (!undo || this.delivering) return fn();
      this.delivering = undo;
      try { return fn(); } finally { this.delivering = null; }
    };
    track(() => {
      Object.assign(x, { phase: "ended", ending: String(how || "").slice(0, 300), recap: null, earned: [], delivery: null, after: null, busy: "recap", error: "" });
      this.dropReply();
      for (const c of [...this.state.clocks]) this.stopClock(c.id, true);
      this.clocksChanged();
      this.addLog("note", `The story ended${x.ending ? `: ${x.ending}` : "."}`);
    });
    this.soloChanged();
    try {
      const p = this.state.campaign, c = campaignById(p?.id), story = x.campaign && c?.stories.find((t) => t.id === p.current);
      const stakes = story ? (story.affinity || []).map((a) => ({ ...a, name: c.factions.find((f) => f.id === a.faction)?.name || a.faction })) : [];
      const raw = await this.ask(recapRequest(this.state, x.ending, story && { stakes, job: story.job, late: !!story.late }), "synopsis");
      x.recap = normalizeRecap(raw);
      x.earned = Array.isArray(raw?.earned) ? raw.earned.map(Number) : [];
      x.delivery = { delivery: raw?.delivery, late: raw?.late === true };
    } catch (err) {
      x.error = `Couldn't write the recap (${err?.message || err}).`;
    }
    if (this.state.solo !== x || x.phase !== "ended") return; // retconned (or moved on) while the recap was written
    if (x.campaign) track(() => this.soloFinish());
    x.busy = "";
    this.soloChanged();
  }

  soloOpen() {
    this.state.solo.opened = true;
    this.touch();
    this.soloNoCheck = true;
    this.generate("OPENING: there is no Warden, so you start the game. Set the opening scene for the players at their terminal in a few short lines: where they are, what they see and hear, and something that gives them a reason to act. End on a moment that invites them to type.");
  }

  soloCall(roll, fromOutcome = false) {
    const s = this.state;
    this.handleDm({ t: "rollRequest", fromOutcome, roll });
    const r = s.roll;
    if (r?.status !== "waiting") return;
    const claimed = this.claims();
    for (const p of [...r.pcs]) {
      const who = this.crewById(p.id);
      if (who && !claimed[who.id] && s.roll === r && r.status === "waiting" && !r.results[who.id]) this.rollFor(who, null, { by: "warden" });
    }
  }

  soloRule(oc) {
    const s = this.state;
    if (!oc) return;
    const crew = s.config.crew;
    const by = s.log.findLast((e) => e.kind === "player")?.by;
    const pc = crew.find((c) => c.name === by);
    if (oc.suggested_check !== "none" && crew.length) {
      this.soloCall({ pc: pc?.id ?? "all", check: oc.suggested_check, advantage: oc.advantage, reason: oc.attempt }, true);
      return;
    }
    s.outcomeCheck = null;
    const stakes = [oc.on_success && `if it works, ${oc.on_success}`, oc.on_failure && `if it fails, ${oc.on_failure}`].filter(Boolean).join("; ");
    this.soloNoCheck = true;
    this.addLog("warden", `No Warden is running this game, so you rule on it: decide fairly, by the fiction and the odds, whether "${oc.attempt || "their attempt"}" works${stakes ? ` (the stakes: ${stakes})` : ""}, then narrate what happens. If it fails, fail forward: the story still moves on (see FAIL FORWARD).`);
    this.generate();
  }

  pilotAuth(ws, token) {
    if (!this.state.solo || !this.checkToken(token)) return;
    ws.pilot = true;
    this.sendPilot(ws);
  }
  sendPilot(ws) {
    const c = this.state.config;
    ws.send(JSON.stringify({ t: "pilotInfo", providers: catalog(this.keys), config: { provider: c.provider, model: c.model, effort: c.effort }, chargen: this.state.newChars }));
  }
  handlePilot(ws, msg) {
    const x = this.state.solo;
    if (!x) return;
    switch (msg.t) {
      case "pilotConfig": {
        const patch = Object.fromEntries(Object.entries(msg.patch || {}).filter(([k]) => ["provider", "model", "effort"].includes(k)));
        this.handleDm({ t: "config", patch });
        break;
      }
      case "pilotKey":
        this.handleDm({ t: "apiKey", provider: msg.provider, key: msg.key });
        break;
      case "pilotPitches":
        this.soloPitches();
        break;
      case "pilotBuild":
        this.soloBuild(Number(msg.i));
        break;
      case "pilotJob":
        this.soloJob(String(msg.id || ""));
        break;
      case "pilotTravel":
      case "pilotRefuel":
      case "pilotDispatch": {
        const p = this.state.campaign, c = campaignById(p?.id);
        if (!c || x.phase !== "pick" || x.busy) break;
        const r = msg.t === "pilotTravel" ? travelTo(p, c, String(msg.to || "")) : msg.t === "pilotDispatch" ? callDispatch(p, c) : refuel(p, c);
        if (!r) break;
        if (!r.ok) Object.assign(x, { error: r.error, notice: "" });
        else {
          x.error = "";
          const at = (id) => c.locations.find((l) => l.id === id).name;
          if (r.lane) {
            for (const l of passDays(p, [this.state.config.crew, p.crew], r.lane.days)) this.addLog("note", l);
            this.crewChanged();
          }
          this.addLog("note", r.lane
            ? `${c.ship.name} noses out of ${at(r.from)} and runs ${r.lane.name} (${r.lane.days} days) to ${at(p.at)}: ${r.cost} fuel (house rule), ${r.left} left.`
            : msg.t === "pilotDispatch"
            ? `Stuck at ${r.at}, the rig calls Local 1312 dispatch, who advance ${r.units} units of fuel (house rule): ${exact(r.cost)} added to the Gallow-Mercer note. Union standing is unchanged.`
            : `${c.ship.name} takes on ${r.added} units of fuel at ${r.at} (house rule: 500cr a unit, times the port's multiplier). Total ${exact(r.total)}.`);
          for (const e of r.entries || []) this.addLog("note", ledgerLine(p, e));
          if (r.entries) this.moneySync();
          x.notice = r.lane
            ? `Travelled to ${at(p.at)}: ${r.lane.days} days, ${r.cost} fuel. ${r.left} left.`
            : msg.t === "pilotDispatch"
            ? `Dispatch advanced ${r.units} unit${r.units === 1 ? "" : "s"} of fuel: ${exact(r.cost)} added to the note. The note is ${exact(p.debt)}. Fuel ${p.resources.fuel}.`
            : `Refuelled ${r.added} unit${r.added === 1 ? "" : "s"} for ${exact(r.total)}. Rig account ${exact(p.money)}. Fuel ${p.resources.fuel}.`;
        }
        this.soloChanged();
        this.syncDm();
        this.sendHeader();
        break;
      }
      case "pilotLeaveCampaign":
        if (x.phase === "pick" && !x.busy && x.campaign) {
          this.state.campaign = null;
          Object.assign(x, { campaign: false, after: null, error: "" });
          this.soloChanged();
          this.syncDm();
        }
        break;
      case "pilotWrapUp":
        this.soloEnd(String(msg.how || "The crew called it a night."));
        break;
      case "pilotNewStory":
        this.dropReply();
        Object.assign(x, { phase: "pick", busy: "", error: "", notice: "", opened: false, ending: "", recap: null });
        this.soloChanged();
        if (x.pitches.length < 3 && !x.campaign) this.soloPitches();
        break;
      case "pilotCgAccept":
      case "pilotCgReject": {
        const bad = decideCharacter(this, msg.t === "pilotCgAccept", String(msg.id), msg.note);
        if (bad) ws.send(JSON.stringify({ t: "notice", text: bad }));
        break;
      }
      case "pilotEnd":
        console.log(`  - session ${this.code} ended by its pilot`);
        this.onEnd?.(this);
        return;
      default:
        return;
    }
    for (const c of this.sockets) if (c.pilot && c.readyState === 1) this.sendPilot(c);
  }

  storyBegins() {
    const s = this.state;
    if (s.storyStart || s.solo && s.solo.phase !== "play") return;
    const config = Object.fromEntries(Object.entries(s.config).filter(([k]) => !SESSION_SETTINGS.has(k)));
    s.storyStart = structuredClone({ config, station: s.station, synopses: { prebrief: s.synopses?.prebrief }, panicPlus: { ...s.panicPlus }, at: Date.now() });
    this.touch();
  }

  isSpeaker(voiceId) {
    const c = this.state.config;
    const v = c.voices.find((x) => x.id === voiceId);
    if (!v || voiceId === BUILTIN.terminal || voiceId === BUILTIN.narrator || v.style === "plain") return false;
    return !systemsOf(c).some((s) => netKey(s.name) === netKey(v.name));
  }
  introduce(voice, net, { inPerson = false, done = false } = {}) {
    const s = this.state;
    if (inPerson || !this.isSpeaker(voice)) return;
    const nets = net === ALL_NET ? systemsOf(s.config).map((x) => x.net) : [net || ""];
    const keys = nets.map((n) => `${voice}@${n}`).filter((k) => !(s.introduced ||= []).includes(k));
    if (!keys.length) return;
    s.introduced.push(...keys);
    if (done || s.config.narrator === false || !s.config.voices.some((x) => x.id === BUILTIN.narrator)) return;
    const comms = voice === BUILTIN.broadcast || COMMS_PRESETS.has(s.config.voices.find((x) => x.id === voice)?.preset);
    if (!comms) return;
    const lines = INTROS[voice === BUILTIN.broadcast ? "broadcast" : "comms"];
    this.addLog(kindOf(BUILTIN.narrator), lines[Math.floor(Math.random() * lines.length)], { source: "auto", net, entity: BUILTIN.narrator });
  }
  unheard() {
    const s = this.state;
    const nets = this.occupiedNets();
    if (!nets.size) nets.add(this.defaultNet());
    return s.config.voices.filter((v) => this.isSpeaker(v.id) && [...nets].some((n) => this.voiceReaches(v.id, n) && !(s.introduced || []).includes(`${v.id}@${n}`))).map((v) => v.name);
  }
  speaksBySentence(voiceId) {
    const v = this.state.config.voices.find((x) => x.id === voiceId);
    return !!v && v.style !== "plain" && v.voice?.engine === "neural";
  }

  restartStory() {
    const s = this.state;
    const snap = s.storyStart;
    this.genCounter++;
    this.rerun = false;
    this.playhead = 0;
    this.undoStack = [];
    this.lastNet = "";
    this.hazardUnits = [];
    this.hazardNeeds = [];
    this.clearClocks();
    this.endAllEffects();
    this.stopSounds();
    if (snap) {
      const pics = new Map([...s.config.cast, ...s.config.crew].map((m) => [m.id, m.portrait]));
      const now = s.config.crew;
      Object.assign(s.config, structuredClone(snap.config));
      s.config.voices = sanitizeVoices(s.config.voices);
      s.station = structuredClone(snap.station);
      s.config.cast = sanitizeCast(s.config.cast);
      // The sheets come back as they were when play began (dead, retired, items, ammo, conditions). A replacement accepted since stays, and so does the character it replaced.
      const joined = now.filter((c) => c.replacedBy || !s.config.crew.some((x) => x.id === c.id));
      for (const c of joined) {
        const was = s.config.crew.findIndex((x) => x.id === c.id);
        const sheet = was < 0 && s.campaign?.crew.find((x) => x.id === c.id) || c;
        if (was < 0) s.config.crew.push(structuredClone(sheet));
        else s.config.crew[was] = structuredClone(sheet);
      }
      s.config.crew = sanitizeCrew(s.config.crew);
      for (const m of [...s.config.cast, ...s.config.crew]) if (pics.has(m.id)) m.portrait = pics.get(m.id);
      s.synopses = structuredClone(savedSynopses(snap));
      delete s.synopses.sofar;
      delete s.synopses.wrapup;
    } else {
      if (!s.campaign) for (const pc of s.config.crew) if (playable(pc)) freshen(pc);
      if (s.config.stationName === "KESTREL-9") {
        s.station = structuredClone(DEFAULT_STATION);
        for (const m of s.config.cast) m.room = findCast(DEFAULT_CAST, m.name)?.room ?? m.room;
      }
      s.synopses = {};
    }
    for (const t of s.config.terminals) Object.assign(t, { open: t.startOpen, openedInPlay: false });
    s.station.access_level = DEFAULT_STATION.access_level;
    delete s.station.hazards;
    if (s.campaign) for (const pc of s.config.crew) pc.credits = s.campaign.crew.find((x) => x.id === pc.id)?.credits ?? pc.credits;
    Object.assign(s, { log: [], introduced: [], handouts: structuredClone(s.config.startDocs || []), found: [], pending: null, whisper: "", roll: null, outcomeCheck: null, offers: [], panicPlus: snap ? { ...(snap.panicPlus || {}) } : s.panicPlus, storyStart: null, deathSaves: {}, shipFight: null });
    if (s.solo) Object.assign(s.solo, { phase: s.solo.phase === "ended" ? "play" : s.solo.phase, opened: false, ending: "", recap: null, busy: "", error: "" });
    this.setBusy(false);
    this.toPlayers({ t: "roomPlan", rows: null });
    this.toPlayers({ t: "roll", roll: null });
    this.sendHeader();
    this.crewChanged();
    this.addLog("note", snap ? `Story restarted from when play began (${new Date(snap.at).toLocaleString()}).` : "Story restarted.");
    this.initPlayers();
    if (s.solo) this.soloChanged();
  }

  giveHandout({ title, text, to = "", voice = "" }, note = "") {
    const clean = (v, n) => String(v ?? "").replace(/\r/g, "").trim().slice(0, n);
    const h = { id: newId("doc", 4), title: clean(title, 120), text: clean(text, 6000), to: this.state.config.crew.some((c) => c.id === to) ? to : "", at: Date.now() };
    if (voice && this.logVoice(voice)) h.voice = String(voice);
    if (!h.title || !h.text) return;
    this.state.handouts.push(h);
    this.delivering?.handouts.push(h.id);
    if (this.state.handouts.length > 60) this.state.handouts.shift();
    const who = h.to ? this.crewById(h.to)?.name : "everyone";
    this.addLog("note", note || `${who} received "${h.title}"`);
    this.showHandout(h);
    this.touch();
  }
  async writeHandout(brief, title, voice = "") {
    if (!brief.trim() && !title.trim()) return;
    this.handoutBusy = true;
    this.send("dm", { t: "handoutWriting", busy: true });
    try {
      const h = normalizeHandout(await this.ask(handoutRequest(this.state, brief || title, title, this.logVoice(voice)?.name || ""), "handout"));
      this.send("dm", { t: "handoutDraft", ...h });
    } catch (err) {
      console.error(`[${this.code}] handout failed:`, err?.message || err);
      this.send("dm", { t: "toast", level: "error", text: `Couldn't write the handout: ${err?.message || err}` });
    }
    this.handoutBusy = false;
    this.send("dm", { t: "handoutWriting", busy: false });
  }
  showHandout(h) {
    this.toPlayersIf((c) => c.stream || !h.to || c.character === h.to, { t: "handout", handout: this.handoutView(h) });
  }
  handoutsFor(ws) {
    return (this.state.handouts || []).filter((h) => ws?.stream || !h.to || h.to === ws?.character).map((h) => this.handoutView(h));
  }
  logVoice(ref) {
    const c = this.state.config, r = String(ref || "");
    if (r.startsWith("cast:")) {
      const m = (c.cast || []).find((x) => x.id === r.slice(5));
      if (!m) return null;
      return { base: castVoice(m), fx: c.voices.find((v) => v.id === channelOf(c))?.fx || {}, name: m.name };
    }
    const v = c.voices.find((x) => x.id === r);
    return v ? { base: v.voice, fx: v.fx, name: shownName(v) } : null;
  }
  logParts(h) {
    const main = this.logVoice(h.voice);
    if (!main) return [];
    let cur = main;
    return speechParts(h.text).flatMap((line) => {
      const cue = line.match(/^\[\s*(?:SOUND|SFX)\s*:\s*(.+?)\s*\]$/i);
      if (cue) {
        const snd = this.findSound(cue[1]);
        return snd ? [{ who: "", text: "", sound: { id: snd.id, name: snd.name, seconds: snd.seconds, volume: snd.volume ?? 0.8 } }] : [];
      }
      const m = line.match(/^([A-Z][A-Z .'-]{0,38}[A-Z.]):\s+(.+)$/);
      const sp = m && this.speakerNamed(m[1], main);
      if (sp) cur = sp;
      return [{ who: sp ? m[1] : "", text: sp ? m[2] : line, base: cur.base, fx: cur.fx }];
    });
  }
  speakerNamed(name, main) {
    const c = this.state.config;
    const member = findCast(c.cast, name);
    if (member) return this.logVoice(`cast:${member.id}`);
    const vid = resolveVoice(name, c.voices);
    if (vid) return this.logVoice(vid);
    if (name.trim().split(/\s+/).length > 3) return null;
    const taken = new Set((c.cast || []).map((m) => castVoice(m).speaker));
    const free = Object.keys(SPEAKERS).filter((k) => !taken.has(k)), keys = free.length ? free : Object.keys(SPEAKERS);
    let n = 0;
    for (const ch of name.toUpperCase()) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
    return { base: { engine: "neural", speaker: keys[n % keys.length], pace: 1 }, fx: main.fx, name };
  }
  handoutView(h) {
    const { voice, ...rest } = h, lv = voice && this.logVoice(voice);
    return lv ? { ...rest, audio: { speaker: lv.name, lines: this.logParts(h).map(({ who, text, fx, sound }) => (sound ? { sound } : { who, text, fx })) } } : rest;
  }
  handoutAudio(id, part) {
    const h = (this.state.handouts || []).find((x) => x.id === id);
    const p = h?.voice && this.logParts(h)[part];
    return p && !p.sound ? this.speech.speak(p.text, p.base, p.fx) : Promise.resolve(null);
  }

  roomName(id) {
    const m = String(this.state.config.map || "").match(new RegExp(`\\b${id}\\s*=\\s*([^,\\n@]+)`));
    return m ? m[1].trim() : String(id).replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
  }

  findRoomDoc(id, to = "", finder = "") {
    const d = (this.state.config.roomDocs || []).find((x) => x.id === id);
    if (!d || (this.state.found ||= []).includes(id)) return;
    this.state.found.push(id);
    this.delivering?.found.push(id);
    this.giveHandout({ title: d.title, text: d.text, voice: d.voice, to }, finder ? `${finder} found "${d.title}" in ${this.roomName(d.room)}` : "");
  }

  publicClocks() {
    return this.state.clocks.map(({ id, label, ends, paused, left }) => ({ id, label, ends, paused: !!paused, left: left ?? null }));
  }
  clockLeft(c) {
    return c.paused ? c.left : Math.max(0, Math.round((c.ends - Date.now()) / 1000));
  }
  clearClocks() {
    for (const t of this.clockTimers.values()) clearTimeout(t);
    this.clockTimers.clear();
    this.state.clocks = [];
    this.clocksChanged();
  }
  clocksChanged() {
    this.toPlayers({ t: "clocks", clocks: this.publicClocks() });
    this.touch();
  }
  startClock(rawLabel, seconds, source) {
    const label = String(rawLabel || "").replace(/\s+/g, " ").trim().toUpperCase().slice(0, 40);
    const secs = Math.max(10, Math.min(7200, Math.round(Number(seconds) || 0)));
    if (!label || !Number(seconds)) return;
    this.stopClock(label, true);
    const clock = { id: newId("clk", 4), label, ends: Date.now() + secs * 1000, seconds: secs };
    this.state.clocks.push(clock);
    this.scheduleClock(clock);
    this.addLog("note", `⏱ Clock started${source === "agent" ? " by the agent" : ""}: ${label} (${clockText(secs)})`);
    this.clocksChanged();
  }
  scheduleClock(c) {
    clearTimeout(this.clockTimers.get(c.id));
    if (c.paused) return;
    this.clockTimers.set(c.id, setTimeout(() => this.clockRanOut(c.id), Math.max(0, c.ends - Date.now())));
  }
  stopClock(ref, quiet = false) {
    const key = String(ref || "").trim();
    const c = this.state.clocks.find((x) => x.id === key || x.label === key.toUpperCase());
    if (!c) return;
    this.removeClock(c);
    if (quiet) return;
    this.addLog("note", `⏱ Clock stopped: ${c.label}`);
    this.clocksChanged();
  }
  pauseClock(id, pause) {
    const c = this.state.clocks.find((x) => x.id === id);
    if (!c || !!c.paused === !!pause) return;
    if (pause) {
      Object.assign(c, { paused: true, left: this.clockLeft(c), ends: null });
      clearTimeout(this.clockTimers.get(c.id));
    } else {
      Object.assign(c, { paused: false, ends: Date.now() + c.left * 1000, left: null });
      this.scheduleClock(c);
    }
    this.addLog("note", `⏱ ${c.label} ${pause ? "paused" : "running again"} (${clockText(this.clockLeft(c))} left)`);
    this.clocksChanged();
  }
  shiftClock(id, seconds) {
    const c = this.state.clocks.find((x) => x.id === id);
    const delta = Math.round(Number(seconds) || 0);
    if (!c || !delta) return;
    const left = Math.max(0, Math.min(7200, this.clockLeft(c) + delta));
    if (c.paused) c.left = left;
    else { c.ends = Date.now() + left * 1000; this.scheduleClock(c); }
    this.addLog("note", `⏱ ${c.label} ${delta < 0 ? "advanced" : "given more time"}: ${clockText(left)} left`);
    if (!left && !c.paused) return this.clockRanOut(c.id);
    this.clocksChanged();
  }
  removeClock(c) {
    clearTimeout(this.clockTimers.get(c.id));
    this.clockTimers.delete(c.id);
    this.state.clocks = this.state.clocks.filter((x) => x !== c);
  }
  clockRanOut(id) {
    const c = this.state.clocks.find((x) => x.id === id);
    if (!c) return;
    this.removeClock(c);
    this.clocksChanged();
    if (shipClockRan(this, c)) return;
    this.addLog("warden", `CLOCK RAN OUT: ${c.label}. Make it happen now, in the fiction, with real consequences.`);
    this.syncDm();
    this.requestReply();
  }

  hearTable({ text, speaker = "", playing = "", warden = false }) {
    text = String(text || "").replace(/\s+/g, " ").trim().slice(0, 2000);
    if (!text) return;
    if (warden) this.storyBegins();
    const kind = warden ? "heard" : "table";
    speaker = String(speaker || "").replace(/\s+/g, " ").trim().slice(0, 40);
    playing = String(playing || "").slice(0, 80);
    const last = this.state.log.at(-1);
    if (last?.kind === kind && (last.speaker || "") === speaker && (last.playing || "") === playing && last.text.length + text.length < 4000) {
      last.text += ` ${text}`;
      last.ts = Date.now();
      this.touch();
    } else this.addLog(kind, text, { ...(speaker ? { speaker } : {}), ...(playing ? { playing } : {}) });
    this.syncDm();
  }

  discordView() {
    const d = discordStatus(this.code);
    if (!d) return { enabled: false };
    const players = Object.entries(this.state.discordPlayers || {}).map(([, p]) => ({ name: p.name, crew: p.crew, as: this.crewById(p.crew)?.name }))
      .filter((p) => p.as);
    return { enabled: true, ...d, players, sttKey: !!this.sttKey };
  }

  talking(userId, on, warden = false) {
    if (userId === null) this.talkers.clear();
    else if (on) this.talkers.set(userId, warden);
    else this.talkers.delete(userId);
    const ids = [...new Set([...this.talkers.keys()].map((u) => this.state.discordPlayers?.[u]?.crew).filter(Boolean))];
    const wardenTalking = [...this.talkers.values()].some(Boolean);
    const sent = `${ids.join()}|${wardenTalking}`;
    if (sent === this.talkingSent) return;
    this.talkingSent = sent;
    this.toPlayersIf((c) => c.stream, { t: "talking", ids, warden: wardenTalking });
  }
  playerOf(userId) {
    const id = this.state.discordPlayers?.[userId]?.crew;
    return (id && this.crewById(id)) || null;
  }

  assignPlayer(userId, crewId, name = "") {
    const map = (this.state.discordPlayers ||= {});
    for (const [u, p] of Object.entries(map)) if (u === userId || (crewId && p.crew === crewId)) delete map[u];
    if (crewId) map[userId] = { crew: crewId, name: String(name).slice(0, 40) };
    this.touch();
    this.crewChanged();
  }

  sttPrompt() {
    const c = this.state.config;
    const names = [c.stationName, ...c.crew.map((m) => m.name), ...(c.cast || []).map((m) => m.name)].filter(Boolean);
    return names.length ? `Mothership RPG session aboard ${names.join(", ")}.`.slice(0, 600) : "";
  }

  close() {
    stopListening(this.code);
    for (const t of this.clockTimers.values()) clearTimeout(t);
    for (const t of this.effectTimers.values()) clearTimeout(t);
    for (const ws of this.sockets) ws.close(4004, "session ended");
  }
}
