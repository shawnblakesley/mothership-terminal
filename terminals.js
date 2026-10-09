import { keyOf, slug, roomId } from "./clean.js";

export const LOOKS = ["blood", "goo", "crack", "flicker", "dim", "grime", "portable"];
export const LOOK_LABELS = {
  blood: "blood on the screen", goo: "goo on the screen", crack: "cracked screen", flicker: "flickering",
  dim: "dim, failing backlight", grime: "grimy, stained", portable: "portable handheld unit",
};
const THEMES = ["", "green", "amber", "cyan", "white", "red"];
export const MAX_TERMINALS = 64;

export const SHIP_SYSTEM = { system: "SECOND-CHANCE", os: "TUG-CORE OS v2.7" };

const SHIP_NOTES_V1 = "Aboard the prison tug SECOND CHANCE, through the docking collar from Airlock A. NOT on the station network: answered only by the SECOND CHANCE voice (the tug's flight computer), never by HV-CORE or anyone on the station intercom. It can't see or work anything on the station. The tug sits under a departure lock, waiting for HV-CORE's clearance code.";
const AIRLOCK_NOTES_V1 = "Inside Airlock A, by the sealed inner door. Clean, bright, recently serviced. The crew start here; opening the inner door is their first job.";
export const SHIP_TERMINAL = { id: "ship", name: "SECOND CHANCE TERMINAL", ...SHIP_SYSTEM, room: "second_chance", look: ["grime"], theme: "cyan", open: true, requires: "", notes: "Aboard the prison tug SECOND CHANCE, through the docking collar from Airlock A. The crew start here, just docked. Its own system, not the station network: the tug's flight computer (the SECOND CHANCE voice) answers commands here, not HV-CORE. The station's intercom and broadcasts reach it through the collar. The tug's computer can't see or work anything on the station. The tug sits under a departure lock, waiting for HV-CORE's clearance code." };
export const OLD_SHIP_NOTES = "Aboard the prison tug SECOND CHANCE, through the docking collar from Airlock A. The crew start here, just docked. NOT on the station network: answered only by the SECOND CHANCE voice (the tug's flight computer), never by HV-CORE or anyone on the station intercom. It can't see or work anything on the station. The tug sits under a departure lock, waiting for HV-CORE's clearance code.";

const AIRLOCK_NOTES = "Inside Airlock A, by the sealed inner door, through the docking collar from the SECOND CHANCE. Clean, bright, recently serviced. Opening the inner door is the crew's first job.";

export function startAboardShip(terminals) {
  const ship = terminals.find((t) => t.id === "ship");
  const airlock = terminals.find((t) => t.id === "airlock");
  if (!ship) return terminals;
  if (ship.notes === SHIP_NOTES_V1) ship.notes = SHIP_TERMINAL.notes;
  if (airlock?.notes === AIRLOCK_NOTES_V1) airlock.notes = AIRLOCK_NOTES;
  return [ship, ...terminals.filter((t) => t !== ship)];
}

export const DEFAULT_TERMINALS = [
  SHIP_TERMINAL,
  { id: "airlock", name: "AIRLOCK A TERMINAL", room: "airlock_a", look: [], theme: "", open: false, requires: "", notes: AIRLOCK_NOTES },
  { id: "medbay", name: "MED BAY TERMINAL", room: "med_bay", look: ["grime", "flicker"], theme: "", open: false, requires: "doors.airlock_a", notes: "Salk's terminal. The keys are sticky with something; the screen flickers." },
  { id: "command", name: "COMMAND DECK TERMINAL", room: "command_deck", look: ["dim"], theme: "amber", open: false, requires: "doors.command_deck", notes: "Okonkwo's deck, sealed. Full system access if anyone gets in." },
  { id: "cargo", name: "CARGO BAY TERMINAL", room: "cargo_bay_deck3", look: ["crack", "blood"], theme: "", open: false, requires: "doors.cargo_bay_deck3", notes: "Behind the locked cargo door. The screen is cracked and smeared with blood; something happened right here." },
  { id: "reactor", name: "REACTOR ACCESS TERMINAL", room: "reactor_access", look: ["flicker", "dim"], theme: "red", open: false, requires: "doors.reactor_access", notes: "Petrov's hiding place. Running on emergency power. Where the reactor service is done: shows the efficiency readout, the drain on the Deck 3 trunk, and the junction that can cut it." },
  { id: "portable", name: "PORTABLE TERMINAL", room: "", look: ["portable"], theme: "", open: true, notes: "A handheld maintenance unit from the crew's kit. Weak signal: it can read the station network, but can't work doors or cameras without a hard link at a wall terminal." },
];

export function sanitizeTerminals(list) {
  const out = [];
  const seen = new Set();
  for (const t of Array.isArray(list) ? list : []) {
    const name = String(t?.name || "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!name) continue;
    let id = slug(t.id || name) || `t${out.length + 1}`;
    while (seen.has(id)) id += "x";
    seen.add(id);
    out.push({
      id,
      name,
      room: roomId(t.room),
      look: [...new Set((Array.isArray(t.look) ? t.look : []).filter((l) => LOOKS.includes(l)))],
      theme: THEMES.includes(t.theme) ? t.theme : "",
      open: t.open !== false,
      openedInPlay: t.open !== false && !!t.openedInPlay,
      startOpen: typeof t.startOpen === "boolean" ? t.startOpen : DEFAULT_TERMINALS.find((d) => d.id === id)?.open ?? t.open !== false,
      requires: String(t.requires || "").replace(/[^A-Za-z0-9_.]/g, "").slice(0, 80),
      system: String(t.system || "").replace(/\s+/g, " ").trim().slice(0, 40),
      os: String(t.os || "").replace(/\s+/g, " ").trim().slice(0, 40),
      notes: String(t.notes || "").slice(0, 600),
    });
    if (out.length >= MAX_TERMINALS) break;
  }
  return out;
}

export const netKey = keyOf;
export const netOf = (t) => (t?.system ? netKey(t.system) : "");

export function systemsOf(config) {
  const out = [{ net: "", name: config.stationName }];
  for (const t of config.terminals) if (t.system && !out.some((s) => s.net === netOf(t))) out.push({ net: netOf(t), name: t.system });
  return out;
}
export const ALL_NET = "*";
export const systemName = (config, net) => (net === ALL_NET ? "ALL" : systemsOf(config).find((s) => s.net === (net || ""))?.name || config.stationName);
export const shownOn = (net, screenNet) => net === ALL_NET || (net || "") === screenNet;

export function netNamed(config, name) {
  const key = netKey(name);
  if (!key) return null;
  if (key === "all") return ALL_NET;
  if (key === netKey(config.stationName) || key === "station") return "";
  return systemsOf(config).find((s) => s.net && s.net === key)?.net ?? null;
}

export function reachable(t, station) {
  if (t.open) return true;
  if (!t.requires) return false;
  let v = station;
  for (const k of t.requires.split(".")) v = v?.[k];
  return /^(OPEN|OPENED|UNLOCKED)$/i.test(String(v ?? "").trim());
}

const V1 = JSON.stringify(sanitizeTerminals([
  { id: "airlock", name: "AIRLOCK A TERMINAL", room: "airlock_a", look: [], open: true, notes: "Where the crew docked. Clean, bright, recently serviced." },
  { id: "medbay", name: "MED BAY TERMINAL", room: "med_bay", look: ["grime", "flicker"], open: true, notes: "Salk's terminal. The keys are sticky with something; the screen flickers." },
  { id: "command", name: "COMMAND DECK TERMINAL", room: "command_deck", look: ["dim"], theme: "amber", open: false, notes: "Okonkwo's deck, sealed. Full system access if anyone gets in." },
  { id: "cargo", name: "CARGO BAY TERMINAL", room: "cargo_bay_deck3", look: ["crack", "blood"], open: false, notes: "Behind the locked cargo door. The screen is cracked and smeared with blood; something happened right here." },
  { id: "reactor", name: "REACTOR ACCESS TERMINAL", room: "reactor_access", look: ["flicker", "dim"], theme: "red", open: false, notes: "Petrov's hiding place. Running on emergency power." },
  { id: "portable", name: "PORTABLE TERMINAL", room: "", look: ["portable"], open: true, notes: "A handheld maintenance unit from the crew's kit. Weak signal: it can read the station network, but can't work doors or cameras without a hard link at a wall terminal." },
]));
export const upgradeTerminals = (list) => (JSON.stringify(list) === V1 ? sanitizeTerminals(DEFAULT_TERMINALS) : list);

export const screensBrief = (screens, terminals) => screens.map((s) => `- ${s.character || "a screen with no crew file"}: ${terminals.find((t) => t.id === s.terminal)?.name || s.terminal}`);

export function terminalsBrief(terminals) {
  return terminals.map((t) => `- ${t.name}${t.room ? ` (room: ${t.room})` : ""}${t.look.length ? ` · looks: ${t.look.map((l) => LOOK_LABELS[l]).join(", ")}` : " · clean"}${t.system ? ` · on its own system, ${t.system}${t.os ? ` (${t.os})` : ""}, not the station network: players there see only what was said on it` : ""}${t.open ? "" : t.requires ? ` · reachable once ${t.requires} is open` : " · not reachable yet"}${t.notes ? ` · ${t.notes}` : ""}`).join("\n");
}
