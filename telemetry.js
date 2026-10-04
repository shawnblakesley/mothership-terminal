// Usage telemetry: what people do with the app, counted, never who they are.
//
// Each event is one CloudWatch Embedded Metric Format (EMF) record sent over
// UDP to the CloudWatch agent on this machine (deploy/update.sh sets it up),
// which turns it into metrics (namespace "Mothership") and a log line in
// /mothership/telemetry. With no agent listening (e.g. running locally), the
// packets just go nowhere.
//
// Nothing secret or identifying can get in: events and fields come from fixed
// allowlists (a provider id, a model id, a number, one of a few known words), so
// no free text is ever recorded: no keys, session codes, names, IPs or anything
// players or the Warden typed. As a last guard, a record that looks like it holds
// a key (redact.js) is dropped. Set TELEMETRY=0 to turn it off entirely.
import dgram from "dgram";
import { PROVIDERS } from "./providers/index.js";
import { looksSecret } from "./redact.js";

const ON = process.env.TELEMETRY !== "0";
const PORT = Number(process.env.TELEMETRY_PORT || 25888);
const NAMESPACE = "Mothership";
const LOG_GROUP = "/mothership/telemetry";

const oneOf = (...allowed) => (v) => (allowed.includes(v) ? v : undefined);
const count = (max) => (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Math.round(Number(v)))) : undefined);

// Every field that may be recorded, and what it may hold.
const FIELDS = {
  Provider: oneOf(...PROVIDERS.map((p) => p.id)),
  Model: oneOf(...PROVIDERS.flatMap((p) => p.models.map((m) => m.id))),
  Page: oneOf("player", "warden"),
  Outcome: oneOf("ok", "error"),
  Kind: oneOf("reply", "precheck", "note", "builder", "synopsis", "room", "stat", "save", "panic"),
  Who: oneOf("one", "all", "self"),
  Action: oneOf("direction", "speak", "note", "effect", "sound", "roll", "retcon", "synopsis", "room_show", "room_draft", "builder_chat", "builder_draft", "builder_apply", "story_restart"),
  Reason: oneOf("warden", "expired"),
  LatencyMs: count(600_000),
};

// Every event, and which fields become metric dimensions (the rest are only in the log).
// Dimensions are kept few: each combination is a separate CloudWatch metric.
const EVENTS = {
  PageView: [["Event"], ["Event", "Page"]],
  SessionCreated: [["Event"], ["Event", "Provider"]],
  SessionEnded: [["Event"]],
  PlayerJoined: [["Event"]],
  WardenJoined: [["Event"]],
  PlayerInput: [["Event"]],
  AgentCall: [["Event"], ["Event", "Provider"], ["Event", "Outcome"]],
  WardenAction: [["Event"]],
  Roll: [["Event"]],
};

let sock = null;
function send(record) {
  if (!ON) return;
  const line = JSON.stringify(record);
  if (looksSecret(line)) return; // (can't happen with the allowlists; never send it if it somehow does)
  try {
    sock ??= dgram.createSocket("udp4").on("error", () => {}).unref();
    sock.send(line, PORT, "127.0.0.1", () => {});
  } catch {}
}

const aws = (metrics, dimensions) => ({
  Timestamp: Date.now(),
  LogGroupName: LOG_GROUP,
  CloudWatchMetrics: [{ Namespace: NAMESPACE, Dimensions: dimensions, Metrics: metrics }],
});

// Something happened: track("AgentCall", { Provider: "deepseek", Outcome: "ok", LatencyMs: 2300 }).
export function track(event, fields = {}) {
  const dims = EVENTS[event];
  if (!dims) return;
  const clean = {};
  for (const [k, v] of Object.entries(fields)) {
    const ok = FIELDS[k]?.(v);
    if (ok !== undefined) clean[k] = ok;
  }
  // Only dimensions whose fields are present (CloudWatch drops records missing a dimension).
  const dimensions = dims.filter((d) => d.every((k) => k === "Event" || clean[k] !== undefined));
  const metrics = [{ Name: "Count", Unit: "Count" }];
  if (clean.LatencyMs !== undefined) metrics.push({ Name: "LatencyMs", Unit: "Milliseconds" });
  send({ _aws: aws(metrics, dimensions), Event: event, Count: 1, ...clean });
}

// How things stand right now (sent every minute by server.js).
export function gauge({ activeSessions, players, wardens, storedSessions }) {
  const values = { ActiveSessions: activeSessions, ConnectedPlayers: players, ConnectedWardens: wardens, StoredSessions: storedSessions };
  const clean = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, count(100_000)(v) ?? 0]));
  send({ _aws: aws(Object.keys(clean).map((Name) => ({ Name, Unit: "Count" })), [[]]), Event: "Gauge", ...clean });
}
