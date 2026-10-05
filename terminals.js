// Terminals: the physical screens around the station that players can use (plus
// a portable one). Each player screen is "at" one; its look (blood, a cracked
// screen, flicker...) is drawn on that screen, and the agent knows where
// everyone is, so what they see depends on where they are.

// blood, goo, crack: the screen effects, left on permanently. The rest are
// screen styles (public/player.css .look-*). portable: a handheld unit.
export const LOOKS = ["blood", "goo", "crack", "flicker", "dim", "grime", "portable"];
export const LOOK_LABELS = {
  blood: "blood on the screen", goo: "goo on the screen", crack: "cracked screen", flicker: "flickering",
  dim: "dim, failing backlight", grime: "grimy, stained", portable: "portable handheld unit",
};
const THEMES = ["", "green", "amber", "cyan", "white", "red"];
export const MAX_TERMINALS = 16;

// system: the computer system a terminal is on, and os: what its header calls
// the operating system. Blank = the station's (its name, the terminal voice's OS).
// Terminals on another system (the crew's tug) keep their own log on the
// players' screens: going between systems swaps the screen to that one's log.
export const SHIP_SYSTEM = { system: "SECOND-CHANCE", os: "TUG-CORE OS v2.7" };

// The crew's own tug, docked at Airlock A: its terminal is a separate machine.
export const SHIP_TERMINAL = { id: "ship", name: "SECOND CHANCE TERMINAL", ...SHIP_SYSTEM, room: "second_chance", look: ["grime"], theme: "amber", open: true, requires: "", notes: "Aboard the prison tug SECOND CHANCE, through the docking collar from Airlock A. NOT on the station network: answered only by the SECOND CHANCE voice (the tug's flight computer), never by HV-CORE or anyone on the station intercom. It can't see or work anything on the station. The tug sits under a departure lock, waiting for HV-CORE's clearance code." };

// requires: a station state path (a door) that makes the terminal reachable
// once it reads OPEN or UNLOCKED, e.g. the med bay once the airlock is open.
export const DEFAULT_TERMINALS = [
  { id: "airlock", name: "AIRLOCK A TERMINAL", room: "airlock_a", look: [], theme: "", open: true, requires: "", notes: "Inside Airlock A, by the sealed inner door. Clean, bright, recently serviced. The crew start here; opening the inner door is their first job." },
  SHIP_TERMINAL,
  { id: "medbay", name: "MED BAY TERMINAL", room: "med_bay", look: ["grime", "flicker"], theme: "", open: false, requires: "doors.airlock_a", notes: "Salk's terminal. The keys are sticky with something; the screen flickers." },
  { id: "command", name: "COMMAND DECK TERMINAL", room: "command_deck", look: ["dim"], theme: "amber", open: false, requires: "doors.command_deck", notes: "Okonkwo's deck, sealed. Full system access if anyone gets in." },
  { id: "cargo", name: "CARGO BAY TERMINAL", room: "cargo_bay_deck3", look: ["crack", "blood"], theme: "", open: false, requires: "doors.cargo_bay_deck3", notes: "Behind the locked cargo door. The screen is cracked and smeared with blood; something happened right here." },
  { id: "reactor", name: "REACTOR ACCESS TERMINAL", room: "reactor_access", look: ["flicker", "dim"], theme: "red", open: false, requires: "doors.reactor_access", notes: "Petrov's hiding place. Running on emergency power. Where the reactor service is done: shows the efficiency readout, the drain on the Deck 3 trunk, and the junction that can cut it." },
  { id: "portable", name: "PORTABLE TERMINAL", room: "", look: ["portable"], theme: "", open: true, notes: "A handheld maintenance unit from the crew's kit. Weak signal: it can read the station network, but can't work doors or cameras without a hard link at a wall terminal." },
];

const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);

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
      room: String(t.room || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 60),
      look: [...new Set((Array.isArray(t.look) ? t.look : []).filter((l) => LOOKS.includes(l)))],
      theme: THEMES.includes(t.theme) ? t.theme : "",
      open: t.open !== false,
      requires: String(t.requires || "").replace(/[^A-Za-z0-9_.]/g, "").slice(0, 80),
      system: String(t.system || "").replace(/\s+/g, " ").trim().slice(0, 40),
      os: String(t.os || "").replace(/\s+/g, " ").trim().slice(0, 40),
      notes: String(t.notes || "").slice(0, 600),
    });
    if (out.length >= MAX_TERMINALS) break;
  }
  return out;
}

// Which system a terminal is on, as a key: "" for the station's network.
export const netOf = (t) => (t?.system ? t.system.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "");

// Can players get to it: marked reachable, or its door (requires) is open.
export function reachable(t, station) {
  if (t.open) return true;
  if (!t.requires) return false;
  let v = station;
  for (const k of t.requires.split(".")) v = v?.[k];
  return /^(OPEN|OPENED|UNLOCKED)$/i.test(String(v ?? "").trim());
}

// The first default terminals (before the sealed-airlock start): upgraded when unedited.
const V1 = JSON.stringify(sanitizeTerminals([
  { id: "airlock", name: "AIRLOCK A TERMINAL", room: "airlock_a", look: [], open: true, notes: "Where the crew docked. Clean, bright, recently serviced." },
  { id: "medbay", name: "MED BAY TERMINAL", room: "med_bay", look: ["grime", "flicker"], open: true, notes: "Salk's terminal. The keys are sticky with something; the screen flickers." },
  { id: "command", name: "COMMAND DECK TERMINAL", room: "command_deck", look: ["dim"], theme: "amber", open: false, notes: "Okonkwo's deck, sealed. Full system access if anyone gets in." },
  { id: "cargo", name: "CARGO BAY TERMINAL", room: "cargo_bay_deck3", look: ["crack", "blood"], open: false, notes: "Behind the locked cargo door. The screen is cracked and smeared with blood; something happened right here." },
  { id: "reactor", name: "REACTOR ACCESS TERMINAL", room: "reactor_access", look: ["flicker", "dim"], theme: "red", open: false, notes: "Petrov's hiding place. Running on emergency power." },
  { id: "portable", name: "PORTABLE TERMINAL", room: "", look: ["portable"], open: true, notes: "A handheld maintenance unit from the crew's kit. Weak signal: it can read the station network, but can't work doors or cameras without a hard link at a wall terminal." },
]));
export const upgradeTerminals = (list) => (JSON.stringify(list) === V1 ? sanitizeTerminals(DEFAULT_TERMINALS) : list);

// For the agent: every terminal, and who is at which.
export function terminalsBrief(terminals) {
  return terminals.map((t) => `- ${t.name}${t.room ? ` (room: ${t.room})` : ""}${t.look.length ? ` · looks: ${t.look.map((l) => LOOK_LABELS[l]).join(", ")}` : " · clean"}${t.system ? ` · on its own system, ${t.system}${t.os ? ` (${t.os})` : ""}, not the station network: players there see only what was said on it` : ""}${t.open ? "" : t.requires ? ` · reachable once ${t.requires} is open` : " · not reachable yet"}${t.notes ? ` · ${t.notes}` : ""}`).join("\n");
}
