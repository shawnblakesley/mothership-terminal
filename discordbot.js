// Discord: a bot that sits in a voice channel and writes down what everyone at
// the (virtual) table says, into a session's log, like the Warden's Listen
// button does for one microphone. One bot serves every session; it's on when
// the server sets DISCORD_BOT_TOKEN.
//
// Linking: the Warden console asks for a one-time code (linkCode); in Discord
// the Warden, in a voice channel, types /terminal listen code:<it>. The bot joins
// that channel. Whoever linked it is the Warden: their speech is logged like the
// Listen button's (fact, for the agent). Everyone else's is table talk, under the
// character they play once the Warden says (/terminal player), else their name.
//
// Speech-to-text: each speaker's audio, cut at pauses, goes to Groq's Whisper on
// the session's own Groq key (memory only, like its LLM key).
import { Client, GatewayIntentBits, Events, MessageFlags } from "discord.js";
import { joinVoiceChannel, EndBehaviorType, VoiceConnectionStatus, entersState } from "@discordjs/voice";
import prism from "prism-media";
import crypto from "crypto";

const TOKEN = process.env.DISCORD_BOT_TOKEN || "";
export const discordEnabled = !!TOKEN;

const STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const STT_MODEL = process.env.DISCORD_STT_MODEL || "whisper-large-v3-turbo";
const STT_LANGUAGE = process.env.DISCORD_STT_LANGUAGE ?? "en"; // "" = Whisper guesses
const LINK_TTL_MS = 15 * 60_000;
const SILENCE_MS = 900; // a pause this long ends a phrase
const BYTES_PER_SEC = 48000 * 2 * 2; // what Discord decodes to: 48 kHz, stereo, 16-bit
const MIN_BYTES = BYTES_PER_SEC * 0.5; // shorter is a cough or a click
const MAX_BYTES = BYTES_PER_SEC * 30; // someone talking on and on: send it in pieces
const EMPTY_LEAVE_MS = 5 * 60_000; // nobody left in the channel: go after this long
// Connect + Speak + View Channel. (It only listens; Speak keeps clients from flagging it.)
const PERMISSIONS = 1024 + 1048576 + 2097152;
// Whisper fills silence and noise with these; on their own they're never real.
const HALLUCINATIONS = /^(thank you( (so much|very much))?|thanks( for watching)?|you|bye|okay|oh|um+|uh+|hmm+|so|\.+|subtitles by.*|please subscribe.*)[.!?]*$/i;

let client = null;
let getSession = () => null;
let inviteUrl = "";
const codes = new Map(); // link code -> { session, expires }
const links = new Map(); // guild id -> { session, guildName, channelId, channelName, wardenId, wardenName, connection, chain, names, emptyTimer }

// No 0/O/1/I/L, like session codes: it gets typed from one screen into another.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// A fresh one-time code for a session (any older one for it stops working).
export function linkCode(sessionCode) {
  for (const [c, v] of codes) if (v.session === sessionCode || v.expires < Date.now()) codes.delete(c);
  let code;
  do code = [...crypto.randomBytes(6)].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  while (codes.has(code));
  codes.set(code, { session: sessionCode, expires: Date.now() + LINK_TTL_MS });
  return code;
}

// For the Warden console: whether the bot is on, how to invite it, and where it's listening.
export function discordStatus(sessionCode) {
  if (!discordEnabled) return null;
  const link = [...links.values()].find((l) => l.session === sessionCode);
  return { invite: inviteUrl, listening: link ? { guild: link.guildName, channel: link.channelName, warden: link.wardenName } : null };
}

export function stopListening(sessionCode) {
  for (const [guildId, l] of links) if (l.session === sessionCode) leave(guildId);
}

function leave(guildId, why = "") {
  const l = links.get(guildId);
  if (!l) return;
  links.delete(guildId);
  clearTimeout(l.emptyTimer);
  try { l.connection.destroy(); } catch {}
  const s = getSession(l.session);
  if (s) {
    if (why) s.send("dm", { t: "toast", level: "info", text: why });
    s.syncDm();
  }
}

// ---------------------------------------------------------------- audio

// 48 kHz stereo -> 16 kHz mono WAV (what Whisper wants; a third the upload).
function toWav(pcm) {
  const frames = Math.floor(pcm.length / 4 / 3);
  const out = Buffer.alloc(44 + frames * 2);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let j = 0; j < 3; j++) {
      const o = (i * 3 + j) * 4;
      sum += pcm.readInt16LE(o) + pcm.readInt16LE(o + 2);
    }
    out.writeInt16LE(Math.round(sum / 6), 44 + i * 2);
  }
  out.write("RIFF", 0); out.writeUInt32LE(36 + frames * 2, 4); out.write("WAVE", 8);
  out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(16000, 24); out.writeUInt32LE(32000, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write("data", 36); out.writeUInt32LE(frames * 2, 40);
  return out;
}

const warned = new Map(); // session code + problem -> when the Warden was last told
function warnOnce(session, what, text) {
  const k = `${session.code}:${what}`;
  if (Date.now() - (warned.get(k) || 0) < 120_000) return;
  warned.set(k, Date.now());
  session.send("dm", { t: "toast", level: "error", text });
}

async function transcribe(session, pcm) {
  const key = session.sttKey;
  if (!key) {
    warnOnce(session, "nokey", "Discord is hearing people talk, but there's no Groq key to write it down: add one under Settings, Discord.");
    return "";
  }
  const form = new FormData();
  form.append("file", new Blob([toWav(pcm)], { type: "audio/wav" }), "speech.wav");
  form.append("model", STT_MODEL);
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  if (STT_LANGUAGE) form.append("language", STT_LANGUAGE);
  const prompt = session.sttPrompt(); // (names it should spell right)
  if (prompt) form.append("prompt", prompt);
  let r;
  try {
    r = await fetch(STT_URL, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    warnOnce(session, "net", `Couldn't reach Groq to write down Discord speech: ${err.message}`);
    return "";
  }
  if (r.status === 401) { warnOnce(session, "401", "Groq turned down this session's key, so Discord speech isn't being written down. Check it under Settings, Discord."); return ""; }
  if (r.status === 429) { warnOnce(session, "429", "Groq's rate limit was hit: some Discord speech wasn't written down."); return ""; }
  if (!r.ok) { warnOnce(session, "http", `Groq couldn't write down Discord speech (HTTP ${r.status}).`); return ""; }
  const data = await r.json().catch(() => ({}));
  // Segments Whisper itself thinks are silence, or is guessing at, are left out.
  const segs = Array.isArray(data.segments) ? data.segments : null;
  const text = (segs ? segs.filter((g) => !(g.no_speech_prob > 0.6 && g.avg_logprob < -0.5) && g.avg_logprob > -1.2).map((g) => g.text).join(" ") : data.text || "")
    .replace(/\s+/g, " ").trim();
  return HALLUCINATIONS.test(text) ? "" : text;
}

async function speakerName(guild, link, userId) {
  if (link.names.has(userId)) return link.names.get(userId);
  const m = await guild.members.fetch(userId).catch(() => null);
  const name = m ? { name: m.displayName, bot: m.user.bot } : { name: "Someone", bot: false };
  link.names.set(userId, name);
  return name;
}

// One phrase from one person: decode it, and when it ends (a pause), write it down.
function capture(guild, link, userId) {
  const receiver = link.connection.receiver;
  if (receiver.subscriptions.has(userId)) return;
  const opus = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_MS } });
  const pcm = opus.pipe(new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 }));
  let chunks = [], bytes = 0, done = false;
  const flush = () => {
    const audio = Buffer.concat(chunks);
    chunks = []; bytes = 0;
    if (audio.length < MIN_BYTES) return;
    const s = getSession(link.session);
    if (!s) return;
    // Started now (in parallel), delivered in the order people spoke.
    const job = Promise.all([transcribe(s, audio), speakerName(guild, link, userId)]);
    link.chain = link.chain.then(() => job).then(([text, who]) => {
      if (!text || who.bot || links.get(guild.id) !== link) return;
      const s = getSession(link.session);
      const warden = userId === link.wardenId;
      s?.hearTable({ text, speaker: who.name, playing: warden ? "" : s.playerOf(userId)?.name, warden });
    }).catch((err) => console.warn(`[discord] transcription failed: ${err.message}`));
  };
  pcm.on("data", (c) => { chunks.push(c); bytes += c.length; if (bytes >= MAX_BYTES) flush(); });
  const end = () => { if (!done) { done = true; flush(); } };
  pcm.on("end", end);
  pcm.on("error", end); // (a corrupt packet: keep what came before it)
  opus.on("error", end);
}

// ---------------------------------------------------------------- commands

const COMMANDS = [{
  name: "terminal",
  description: "Mothership terminal: write down what's said in this voice channel",
  contexts: [0], // servers only
  options: [
    { type: 1, name: "listen", description: "Join your voice channel and write down what's said, into a session's log", options: [
      { type: 3, name: "code", description: "The link code from the Warden console (Settings, Discord)", required: true },
    ] },
    { type: 1, name: "player", description: "Warden only: say which crew member someone plays (or hand them the Warden role)", options: [
      { type: 3, name: "character", description: "A crew member's name, Warden, or Nobody", required: true, autocomplete: true },
      { type: 6, name: "user", description: "Who plays them", required: true },
    ] },
    { type: 1, name: "stop", description: "Stop listening and leave the voice channel" },
  ],
}];

async function onListen(i) {
  const code = String(i.options.getString("code") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const ticket = codes.get(code);
  if (!ticket || ticket.expires < Date.now()) {
    return i.reply({ content: "That code doesn't work. Get a new one from the Warden console: Settings, Discord, Get a link code.", flags: MessageFlags.Ephemeral });
  }
  const channel = i.member?.voice?.channel;
  if (!channel) return i.reply({ content: "Join a voice channel first, then run this again.", flags: MessageFlags.Ephemeral });
  const session = getSession(ticket.session);
  if (!session) return i.reply({ content: "That session has ended.", flags: MessageFlags.Ephemeral });
  if (!channel.joinable) return i.reply({ content: `I can't join ${channel.name}: give me Connect and View Channel there.`, flags: MessageFlags.Ephemeral });
  codes.delete(code);
  await i.deferReply();

  leave(i.guildId); // (one channel per server)
  stopListening(ticket.session); // (and one channel per session)
  const connection = joinVoiceChannel({ channelId: channel.id, guildId: i.guildId, adapterCreator: i.guild.voiceAdapterCreator, selfDeaf: false, selfMute: true });
  const link = { session: ticket.session, guildName: i.guild.name, channelId: channel.id, channelName: channel.name, wardenId: i.user.id, wardenName: i.member?.displayName || i.user.username, connection, chain: Promise.resolve(), names: new Map(), emptyTimer: null };
  links.set(i.guildId, link);
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch {
    leave(i.guildId);
    return i.editReply("Couldn't connect to the voice channel. Try again in a moment.");
  }
  connection.receiver.speaking.on("start", (userId) => links.get(i.guildId) === link && capture(i.guild, link, userId));
  // Dropped (moved, kicked, a network blip): wait for it to come back, or give up.
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([entersState(connection, VoiceConnectionStatus.Signalling, 5_000), entersState(connection, VoiceConnectionStatus.Connecting, 5_000)]);
    } catch {
      if (links.get(i.guildId) === link) leave(i.guildId, "The Discord bot was disconnected from the voice channel.");
    }
  });
  connection.on(VoiceConnectionStatus.Destroyed, () => links.get(i.guildId) === link && leave(i.guildId));
  session.syncDm();
  session.send("dm", { t: "toast", level: "info", text: `Discord: listening in ${channel.name} (${i.guild.name}).` });
  const keyNote = session.sttKey ? "" : "\nThe session has no Groq key yet, so nothing is written down until the Warden adds one (Settings, Discord).";
  // Said in the channel, for everyone: they're being transcribed.
  await i.editReply(`Listening in **${channel.name}**: what's said here is written down (speech-to-text) for the Warden's terminal. Anyone can stop it with \`/terminal stop\`.${keyNote}`);
}

const WARDEN = "Warden", NOBODY = "Nobody";
const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// A crew member by name (or a word of it: "rook", "tick"), or their id.
function findCrew(crew, ref) {
  const r = norm(ref);
  if (!r) return null;
  const exact = crew.find((c) => norm(c.name) === r || c.id === ref);
  if (exact) return exact;
  const some = crew.filter((c) => norm(c.name).split(" ").includes(r) || norm(c.name).includes(r));
  return some.length === 1 ? some[0] : null;
}

// The character box suggests the session's crew, plus Warden and Nobody.
async function onAutocomplete(i) {
  const s = getSession(links.get(i.guildId)?.session);
  const typed = norm(i.options.getFocused());
  const names = [...(s?.state.config.crew || []).map((c) => c.name), WARDEN, NOBODY];
  await i.respond(names.filter((n) => !typed || norm(n).includes(typed)).slice(0, 25).map((n) => ({ name: n.slice(0, 100), value: n.slice(0, 100) })));
}

async function onPlayer(i) {
  const link = links.get(i.guildId);
  const s = getSession(link?.session);
  if (!link || !s) return i.reply({ content: "I'm not listening in this server. Start with `/terminal listen`.", flags: MessageFlags.Ephemeral });
  if (i.user.id !== link.wardenId) return i.reply({ content: `Only the Warden (${link.wardenName}) can say who plays whom.`, flags: MessageFlags.Ephemeral });
  const user = i.options.getUser("user");
  if (user.bot) return i.reply({ content: "That's a bot.", flags: MessageFlags.Ephemeral });
  const name = i.options.getMember("user")?.displayName || user.globalName || user.username;
  link.names.set(user.id, { name, bot: false }); // (their speech goes in under this name)
  const ref = i.options.getString("character");
  const quiet = { allowedMentions: { parse: [] } }; // (name them without pinging)

  if (norm(ref) === norm(WARDEN)) {
    if (user.id === link.wardenId) return i.reply({ content: "You're already the Warden.", flags: MessageFlags.Ephemeral });
    link.wardenId = user.id;
    link.wardenName = name;
    s.assignPlayer(user.id, null); // (the Warden plays nobody)
    s.send("dm", { t: "toast", level: "info", text: `Discord: ${name} is the Warden now.` });
    return i.reply({ content: `<@${user.id}> is the Warden now: what they say goes to the terminal as the Warden's word.`, ...quiet });
  }
  if (user.id === link.wardenId) {
    return i.reply({ content: "That's the Warden. To hand the role on first: `/terminal player character:Warden user:@someone`.", flags: MessageFlags.Ephemeral });
  }
  if (norm(ref) === norm(NOBODY)) {
    s.assignPlayer(user.id, null);
    return i.reply({ content: `<@${user.id}> doesn't play anyone now: they go in under their own name.`, ...quiet });
  }
  const crew = s.state.config.crew;
  const member = findCrew(crew, ref);
  if (!member) {
    return i.reply({ content: `No crew member called "${ref}". The crew: ${crew.map((c) => c.name).join(", ") || "(none yet)"}.`, flags: MessageFlags.Ephemeral });
  }
  s.assignPlayer(user.id, member.id, name);
  await i.reply({ content: `<@${user.id}> plays **${member.name}**.`, ...quiet });
}

async function onStop(i) {
  if (!links.has(i.guildId)) return i.reply({ content: "I'm not listening anywhere in this server.", flags: MessageFlags.Ephemeral });
  leave(i.guildId, `Discord: ${i.member?.displayName || i.user.username} stopped the listening.`);
  await i.reply("Stopped listening.");
}

// Leave a channel everyone else has left (after a while: people drop and rejoin).
function onVoiceState(oldState, newState) {
  for (const id of new Set([oldState.guild.id, newState.guild.id])) {
    const l = links.get(id);
    if (!l) continue;
    const ch = newState.guild.channels.cache.get(l.channelId);
    const people = ch?.members?.filter((m) => !m.user.bot).size ?? 0;
    clearTimeout(l.emptyTimer);
    l.emptyTimer = people ? null : setTimeout(() => leave(id, "Discord: everyone left the voice channel, so the bot left too."), EMPTY_LEAVE_MS);
    if (newState.id === client.user.id && newState.channelId && newState.channelId !== l.channelId) {
      l.channelId = newState.channelId; // (someone moved the bot)
      l.channelName = newState.channel?.name || l.channelName;
      getSession(l.session)?.syncDm();
    }
  }
}

// ---------------------------------------------------------------- start

export function startDiscord(lookup) {
  if (!discordEnabled || client) return;
  getSession = lookup;
  client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  client.once(Events.ClientReady, async (c) => {
    inviteUrl = `https://discord.com/oauth2/authorize?client_id=${c.user.id}&scope=bot+applications.commands&permissions=${PERMISSIONS}`;
    try { await c.application.commands.set(COMMANDS); } catch (err) { console.warn(`  ! Discord: couldn't register /terminal: ${err.message}`); }
    console.log(`  Discord bot online as ${c.user.tag}. Invite it: ${inviteUrl}`);
  });
  client.on(Events.InteractionCreate, async (i) => {
    if (i.commandName !== "terminal") return;
    if (i.isAutocomplete()) return onAutocomplete(i).catch(() => {});
    if (!i.isChatInputCommand()) return;
    try {
      const sub = i.options.getSubcommand();
      if (sub === "listen") await onListen(i);
      else if (sub === "player") await onPlayer(i);
      else await onStop(i);
    } catch (err) {
      console.error("[discord] command failed", err);
      const reply = { content: "Something went wrong.", flags: MessageFlags.Ephemeral };
      (i.deferred || i.replied ? i.editReply(reply) : i.reply(reply)).catch(() => {});
    }
  });
  client.on(Events.VoiceStateUpdate, onVoiceState);
  client.on(Events.Error, (err) => console.warn(`[discord] ${err.message}`));
  client.login(TOKEN).catch((err) => console.warn(`  ! Discord bot couldn't log in: ${err.message}`));
}
