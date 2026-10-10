import { playable } from "./crew.js";

// Crew-to-crew messages (ticket 15). A message is a log entry of kind "msg", seen on the Warden's console and in the agent's history, and sent only to
// the sender (an echo) and the recipient. Forged and altered ones look exactly like real ones to the players; only the Warden's log says so.
const MAX_TEXT = 500;
export const clean = (t) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);

export function crewNamed(crew, name) {
  const n = String(name ?? "").trim().toLowerCase();
  return n ? crew.find((c) => c.name.toLowerCase() === n) || crew.find((c) => c.name.toLowerCase().includes(n)) || null : null;
}

const screenOf = (s, id) => [...s.sockets].find((c) => c.role === "player" && !c.stream && c.character === id && c.terminal && c.readyState === 1);

// Where a crew member's messages come from: the terminal they are at, else the last one they used.
function terminalNameOf(s, id) {
  const terms = s.state.config.terminals;
  const ws = [...s.sockets].find((c) => c.role === "player" && c.character === id && c.terminal);
  const t = terms.find((x) => x.id === (ws?.terminal || s.lastTerm?.get(id)));
  return (t || terms.find((x) => x.look.includes("portable")) || terms[0])?.name || "TERMINAL";
}
export function rememberTerminal(s, ws) {
  if (!ws.character || !ws.terminal) return;
  (s.lastTerm ||= new Map()).set(ws.character, ws.terminal);
}

// What one player's screen gets of an entry: the recipient the message as delivered, the sender (of a real one) their own words.
export function msgView(e, ws) {
  if (e.cut || e.hidden || !ws?.character || ws.stream) return null;
  const base = { id: e.id, kind: "msg", ts: e.ts };
  if (e.toId === ws.character && e.state === "sent") return { ...base, dir: "in", peer: e.from, at: e.at, text: e.text };
  if (e.fromId === ws.character && e.by === "player") return { ...base, dir: "out", peer: e.to, text: e.sent };
  return null;
}
function push(s, e, dir) {
  for (const c of s.sockets) {
    if (c.role !== "player" || c.readyState !== 1) continue;
    const v = msgView(e, c);
    if (v && v.dir === dir) c.send(JSON.stringify({ t: "msg", entry: v }));
  }
}

function arrive(s, e) {
  e.state = "sent";
  push(s, e, "in");
  s.touch();
  s.syncDm();
}

export function sendCrewMessage(s, ws, toName, rawText) {
  const fail = (text) => ws.send(JSON.stringify({ t: "msgFail", text }));
  const from = s.characterOf(ws);
  const text = clean(rawText);
  if (!from) return fail("NO CREW FILE");
  const to = crewNamed(s.state.config.crew, toName);
  if (!to || to.id === from.id) return fail("NO SUCH CREWMEMBER (USE A FIRST NAME OR NICKNAME FROM THE CREW LIST)");
  if (!text) return fail("NOTHING TO SEND");
  if (!ws.terminal || s.isLockedOut()) return fail("TERMINAL UNAVAILABLE");
  const dest = playable(to) && screenOf(s, to.id);
  if (!dest) return fail("NO SIGNAL (THEY ARE NOT AT A TERMINAL ON THIS SYSTEM)");
  if (s.netOfSocket(dest) !== s.netOfSocket(ws)) return fail("NO ROUTE (THEY ARE AT A TERMINAL ON ANOTHER SYSTEM)");
  const holds = (s.state.msgHolds ||= {});
  const hold = holds[from.id];
  delete holds[from.id];
  const e = s.addLog("msg", text, {
    net: s.netOfSocket(ws), fromId: from.id, from: from.name, toId: to.id, to: to.name, at: terminalNameOf(s, from.id), sent: text, by: "player",
    state: hold ? (hold.never ? "dropped" : "held") : "sent",
    ...(hold && !hold.never && hold.seconds > 0 ? { releaseAt: Date.now() + hold.seconds * 1000 } : {}),
  });
  push(s, e, "out");
  if (e.state === "sent") push(s, e, "in");
  else if (e.releaseAt) scheduleRelease(s, e);
  s.syncDm();
}

function scheduleRelease(s, e) {
  const timers = (s.msgTimers ||= new Map());
  clearTimeout(timers.get(e.id));
  timers.set(e.id, setTimeout(() => { timers.delete(e.id); releaseMessage(s, e.id); }, Math.max(0, e.releaseAt - Date.now())));
}
export function resumeMessages(s) {
  for (const e of s.state.log) if (e.kind === "msg" && e.state === "held" && e.releaseAt) scheduleRelease(s, e);
}
const find = (s, id) => s.state.log.find((e) => e.kind === "msg" && e.id === Number(id) && !e.cut);
const settle = (s, e) => { clearTimeout(s.msgTimers?.get(e.id)); s.msgTimers?.delete(e.id); delete e.releaseAt; };

export function releaseMessage(s, id) {
  const e = find(s, id);
  if (!e || e.state !== "held") return;
  settle(s, e);
  arrive(s, e);
}
export function discardMessage(s, id) {
  const e = find(s, id);
  if (!e || e.state !== "held") return;
  settle(s, e);
  e.state = "dropped";
  s.touch();
  s.syncDm();
}
export function holdNext(s, pcId, seconds, never) {
  const holds = (s.state.msgHolds ||= {});
  if (seconds === null) delete holds[pcId];
  else holds[pcId] = { seconds: Math.max(0, Math.min(3600, Math.round(Number(seconds) || 0))), never: !!never };
  s.touch();
  s.syncDm();
}

// Rewrites what the recipient gets, before it arrives or, if it already did, in place. The sender's echo keeps their own words. Returns whether it changed.
export function alterMessage(s, id, rawText, by) {
  const e = find(s, id), text = clean(rawText);
  if (!e || !text || text === e.text || e.state === "dropped") return false;
  s.delivering?.altered.push([e.id, e.text, e.edited || ""]);
  e.text = text;
  e.edited = by;
  if (e.state === "sent") for (const c of s.sockets) if (c.role === "player" && c.readyState === 1 && c.character === e.toId) c.send(JSON.stringify({ t: "msgEdit", id: e.id, text }));
  s.touch();
  s.syncDm();
  return true;
}
export function restoreAltered(s, altered) {
  for (const [id, text, edited] of [...altered].reverse()) {
    const e = s.state.log.find((x) => x.kind === "msg" && x.id === id);
    if (e) { e.text = text; if (edited) e.edited = edited; else delete e.edited; }
  }
}

// A message that appears to come from `as`, though they never sent it. Returns why it could not be sent, else "".
export function forgeMessage(s, { as, to, text: raw }, by) {
  const crew = s.state.config.crew;
  const from = crewNamed(crew, as), dest = crewNamed(crew, to), text = clean(raw);
  if (!from || !dest || from.id === dest.id) return "Pick two different crew members.";
  if (!text) return "Write the message.";
  if (!playable(dest) || !screenOf(s, dest.id)) return `${dest.name} is not at a terminal.`;
  const e = s.addLog("msg", text, { net: s.netOfSocket(screenOf(s, dest.id)), fromId: from.id, from: from.name, toId: dest.id, to: dest.name, at: terminalNameOf(s, from.id), sent: "", by, state: "sent" });
  push(s, e, "in");
  s.syncDm();
  return "";
}

export function applyCrewMessage(s, m, by = "agent") {
  if (!m) return;
  if (m.alter) alterMessage(s, m.alter, m.text, by);
  else if (m.as && m.to && m.text) forgeMessage(s, m, by);
}

export const normalizeCrewMessage = (m) => ({
  as: String(m?.as ?? "").trim().slice(0, 60),
  to: String(m?.to ?? "").trim().slice(0, 60),
  text: clean(m?.text),
  alter: Math.max(0, Math.round(Number(m?.alter) || 0)),
});
export const hasCrewMessage = (m) => !!m && !!m.text && (!!m.alter || (!!m.as && !!m.to));
