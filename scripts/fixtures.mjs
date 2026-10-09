// Fixed game states for measuring and checking the agent's prompts (test/steering.test.js, scripts/measure-prompt.mjs, scripts/eval-steering.mjs).
// Nothing here calls a model.
import { defaultGame } from "../session.js";
import { CAMPAIGNS, newProgress, composeDraft, carryInto } from "../campaign.js";
import { normalizeDraft, applyDraft } from "../builder.js";

const LOG = [
  { id: "e1", kind: "player", by: "Marlowe", at: "SHIP", text: "Computer, status report on the cargo bay." },
  { id: "e2", kind: "terminal", text: "CARGO BAY DECK 3: DOOR LOCKED. AIR: NOMINAL. CAMERA: OFFLINE.\nDRAIN ON REACTOR: 18%." },
  { id: "e3", kind: "player", by: "Marlowe", at: "SHIP", text: "Who locked it, and can you open it?" },
];

function withScreens(state) {
  const t = state.config.terminals;
  return { ...state, found: [], clocks: [], screens: [{ character: state.config.crew?.[0]?.name || null, terminal: t[0].id }], defaultNet: "", unheard: [] };
}

export function kestrelState() {
  const g = defaultGame();
  return withScreens({ ...g, log: structuredClone(LOG), solo: null });
}

// A Rim Haulers story built the way the app builds one, from a canned (but realistically sized) agent draft.
export function haulersState(storyIndex = 0) {
  const c = CAMPAIGNS[0];
  const story = c.stories[storyIndex];
  const p = newProgress(c);
  p.current = story.id;
  const raw = {
    lore: "STATION: the gallery port, a rimward freight stop.\nJOB: haul the sealed container to the next port on the bill of lading.\nWHO'S HERE: dockhands, a customs clerk, a union rep.\nRECENT EVENTS: a dock strike ended last week; a customs audit is pending.\nFACTIONS: the union hall runs the docks; company men watch the manifests.",
    secrets: "- The container was sealed at the origin port by a man who never boarded.\n- The dock computer was told to log the seal as routine.",
    standingOrders: "Keep the dock busy and noisy; slow reveals.",
    station: [{ path: "access_level", value: "GUEST" }, { path: "doors.dock_office", value: "OPEN" }, { path: "lights.deck_1", value: "ONLINE" }, { path: "comms", value: "NORMAL" }],
    computer: { name: "DOCK-LINK", persona: "You are DOCK-LINK, the port's dispatch computer. Terse, bureaucratic, prints in caps on a green CRT. You know the docking schedule and the public manifests. Commands above GUEST clearance are refused." },
    broadcastPersona: "The dock's public-address voice. Flat, cheerful, bureaucratic. Announces, never converses.",
    voices: [{ id: "intercom", name: "INTERCOM", preset: "intercom", color: "", persona: "The dock intercom. People sound tinny and hurried.", systems: ["ALL"] }],
    cast: [{ name: "Dock Boss Teller", sex: "f", voice: "af_sky", room: "", notes: "Runs the dock for the union. Blunt, overworked, owes the crew a favour." }],
    terminals: [],
    documents: [{ title: "BILL OF LADING 2207", text: "# BILL OF LADING 2207\nOne sealed container, 4 tons, bonded. Deliver unopened." }],
  };
  const draft = normalizeDraft(composeDraft(c, story, p, raw));
  const { config, station } = applyDraft(draft);
  carryInto(config, c, story, p);
  const g = defaultGame();
  const state = { ...g, config: { ...g.config, ...config }, station, campaign: p, log: structuredClone(LOG), solo: null };
  return withScreens(state);
}
