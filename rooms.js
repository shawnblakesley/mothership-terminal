// Room floor plans: a grid of tile codes per map room (config.rooms[roomId] =
// { rows: ["####D####", ...] }). The agent drafts one the first time the Warden
// opens a room; the Warden edits it tile by tile and can show it to the players
// (the layout only: who and what is in the room stays with the Warden).
// public/roomplan.js draws them.

import { roomId } from "./clean.js";

// Keep in step with public/roomplan.js (TILES).
export const TILES = {
  " ": "outside (no room here)",
  "#": "wall",
  ".": "floor",
  D: "door",
  H: "hatch / airlock door",
  W: "window (in a wall)",
  T: "terminal / console",
  B: "bed / bunk",
  K: "table / desk",
  S: "seat",
  L: "locker / shelves",
  C: "crate / cargo",
  V: "vent / grate",
  M: "machinery",
  R: "reactor / core",
  P: "pipes / conduit",
  X: "debris / blockage",
};
export const MAX_W = 24, MAX_H = 16;

// Rows of known codes, padded to one width, within the size limits; null if empty.
export function sanitizeRows(rows) {
  const list = (Array.isArray(rows) ? rows : []).slice(0, MAX_H).map((r) => [...String(r ?? "")].slice(0, MAX_W).map((c) => (TILES[c] !== undefined ? c : ".")).join(""));
  while (list.length && !list.at(-1).trim()) list.pop();
  const w = Math.max(0, ...list.map((r) => r.length));
  return w && list.length ? list.map((r) => r.padEnd(w, " ")) : null;
}

export function sanitizeRooms(raw) {
  const out = {};
  for (const [id, r] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
    const key = roomId(id);
    const rows = sanitizeRows(r?.rows);
    if (key && rows) out[key] = { rows };
  }
  return out;
}

const DRAFT = `You draw floor plans for rooms aboard a station or ship in a Mothership (sci-fi horror TTRPG) game. A plan is a small top-down grid, one string per row, one character per tile:
${Object.entries(TILES).map(([c, d]) => `  "${c}" = ${d}`).join("\n")}

RULES
- 10-${MAX_W} tiles wide, 6-${MAX_H} tall. Every row the same length.
- Enclose the room in walls ("#"). Put doors ("D") or hatches ("H") in the outer wall where the room connects (to its corridor, and to anything listed as connected); windows ("W") only in walls.
- Furnish it for what the room is and what happened there: consoles, beds, crates, machinery, vents, pipes, debris where things went wrong. Leave walkable floor between things. It may be an irregular shape (use " " outside it).
- The players may be shown this plan, so it shows structure and furniture only: never people, bodies, creatures or clues.`;

export const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rows"],
  properties: { rows: { type: "array", items: { type: "string" } } },
};

// What the agent needs to draw one room.
export function draftRequest(state, room) {
  const c = state.config;
  const context = [
    `STATION: ${c.stationName}`,
    `LORE:\n${c.lore || "(none)"}`,
    `MAP LAYOUT (decks, rooms, connections):\n${c.map}`,
    `ROOM STATE: ${JSON.stringify(Object.fromEntries(Object.entries(state.station || {}).map(([k, v]) => [k, v?.[room.id]]).filter(([, v]) => v !== undefined)))}`,
    `TERMINALS HERE: ${(c.terminals || []).filter((t) => t.room === room.id).map((t) => `${t.name} (${t.notes})`).join("; ") || "none"}`,
  ].join("\n\n");
  return {
    system: DRAFT,
    context,
    messages: [{ role: "user", content: `Draw the floor plan of ${room.label} (room id ${room.id}, on ${room.deck}). Return rows only.` }],
    schema: DRAFT_SCHEMA,
    example: { rows: ["##########", "#T..#...L#", "#...D....#", "#B..#...C#", "####DD####"] },
  };
}

// KESTREL-9's rooms.
export const DEFAULT_ROOMS = sanitizeRooms({
  second_chance: { rows: [
    "  ####WWWW####  ",
    " ##....TT....## ",
    "##S..........S##",
    "#B.....KK.....B#",
    "#B............B#",
    "#L............L#",
    "##M..........M##",
    " ######HH###### ",
  ] },
  airlock_a: { rows: [
    "#####HH#####",
    "#..........#",
    "#L........L#",
    "#..........#",
    "#T.........#",
    "#####DD#####",
  ] },
  command_deck: { rows: [
    "####WWWWWWWW####",
    "#..TTTTTTTTTT..#",
    "#..S..S..S..S..#",
    "#..............#",
    "#L....KKKK....L#",
    "#.....S..S.....#",
    "#T.............#",
    "#######DD#######",
  ] },
  med_bay: { rows: [
    "################",
    "#B..B..B..#.L.L#",
    "#.........#....#",
    "#.........D....#",
    "#B..B.....#.T..#",
    "#.........######",
    "#K.S...........#",
    "#######DD####V##",
  ] },
  cargo_bay_deck3: { rows: [
    "##########V#####",
    "#CC..CC....CC.C#",
    "#CC..CC....CC..#",
    "#..............#",
    "#PPPPPPPPPPPPPP#",
    "#C...........M.#",
    "#CC..T..X..CCC.#",
    "#######DD#######",
  ] },
  reactor_access: { rows: [
    "################",
    "#M.....PP.....M#",
    "#M....RRRR....M#",
    "#.....RRRR.....#",
    "#PPPPPRRRRPPPPP#",
    "#.....RRRR.....#",
    "#T...L....L...H#",
    "#######DD#######",
  ] },
});
