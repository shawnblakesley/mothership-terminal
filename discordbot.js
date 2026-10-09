import { Client, GatewayIntentBits, Events, MessageFlags, ActivityType } from "discord.js";
import { joinVoiceChannel, EndBehaviorType, VoiceConnectionStatus, entersState, createAudioPlayer, createAudioResource, StreamType, NoSubscriberBehavior, AudioPlayerStatus } from "@discordjs/voice";
import prism from "prism-media";
import { Readable } from "stream";
import { renderVoice } from "./voicefx.js";
import { wavSeconds, synthesize } from "./tts.js";

const TOKEN = process.env.DISCORD_BOT_TOKEN || "";
export const discordEnabled = !!TOKEN;

const STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const STT_MODEL = process.env.DISCORD_STT_MODEL || "whisper-large-v3-turbo";
const STT_LANGUAGE = process.env.DISCORD_STT_LANGUAGE ?? "en";
const SILENCE_MS = 900;
const BYTES_PER_SEC = 48000 * 2 * 2;
const MIN_BYTES = BYTES_PER_SEC * 0.5;
const MAX_BYTES = BYTES_PER_SEC * 30;
const EMPTY_LEAVE_MS = 15_000;
const PERMISSIONS = 1024 + 1048576 + 2097152;
const HALLUCINATIONS = /^(thank you( (so much|very much))?|thanks( for watching)?|you|bye|okay|oh|um+|uh+|hmm+|so|\.+|subtitles by.*|please subscribe.*)[.!?]*$/i;

let client = null;
let getSession = () => null;
let inviteUrl = "";
const links = new Map();

export function discordStatus(sessionCode) {
  if (!discordEnabled) return null;
  const link = linkOf(sessionCode);
  return { invite: inviteUrl, listening: link ? { guild: link.guildName, channel: link.channelName, warden: link.wardenName } : null };
}

export function stopListening(sessionCode, why = "") {
  for (const [guildId, l] of links) if (l.session === sessionCode) leave(guildId, why);
}

function showPresence() {
  if (!client?.user) return;
  const n = links.size;
  client.user.setPresence(n
    ? { status: "online", activities: [{ type: ActivityType.Listening, name: "the comms", state: n === 1 ? "1 crew on the line" : `${n} crews on the line` }] }
    : { status: "idle", activities: [{ type: ActivityType.Watching, name: "the station", state: "/terminal listen to open a channel" }] });
}

function leave(guildId, why = "") {
  const l = links.get(guildId);
  if (!l) return;
  links.delete(guildId);
  showPresence();
  clearTimeout(l.emptyTimer);
  l.mixer?.cut();
  try { l.player?.stop(true); } catch {}
  try { l.connection.destroy(); } catch {}
  const s = getSession(l.session);
  if (s) {
    if (why) s.send("dm", { t: "toast", level: "info", text: why });
    s.discordMoved();
  }
}

const FRAME = 960;
const GRACE = 48000 * 1.5;
class Mixer extends Readable {
  constructor() {
    super();
    this.clips = [];
    this.pos = 0;
    this.start = Date.now();
    this.busyUntil = 0;
    this.lastSound = 0;
  }
  add(pcm, at, voice) {
    const due = Math.round((at - this.start) * 48);
    const from = Math.max(this.pos, due, this.busyUntil);
    if (from - due > 24000) console.warn(`[discord] a line started ${Math.round((from - due) / 48)} ms late`);
    const data = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
    this.clips.push({ data, from });
    this.busyUntil = from + voice;
    this.lastSound = Math.max(this.lastSound, from + data.length / 2);
  }
  cut() { this.clips = []; this.lastSound = 0; }
  _read() {
    if (!this.clips.length && this.pos >= this.lastSound + GRACE) { this.ended = true; return this.push(null); }
    const mix = new Float32Array(FRAME * 2), end = this.pos + FRAME;
    for (const c of this.clips) {
      const a = Math.max(this.pos, c.from), b = Math.min(end, c.from + c.data.length / 2);
      for (let t = a; t < b; t++) {
        const o = (t - c.from) * 2, m = (t - this.pos) * 2;
        mix[m] += c.data[o];
        mix[m + 1] += c.data[o + 1];
      }
    }
    this.clips = this.clips.filter((c) => c.from + c.data.length / 2 > end);
    this.pos = end;
    const out = Buffer.alloc(FRAME * 4);
    for (let k = 0; k < FRAME * 2; k++) out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(mix[k]))), k * 2);
    this.push(out);
  }
}

const linkOf = (sessionCode) => [...links.values()].find((l) => l.session === sessionCode);

export const discordLinked = (sessionCode) => !!linkOf(sessionCode);

export async function discordSay(sessionCode, wav, fx, at) {
  const pcm = await renderVoice(wav, fx).catch(() => null);
  const l = linkOf(sessionCode);
  if (!pcm || !l || !l.talk) return;
  play(l, pcm, wav, fx, at);
}

function play(l, pcm, wav, fx, at) {
  if (!l.player) {
    l.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    l.connection.subscribe(l.player);
    l.player.on("error", (err) => console.warn(`[discord] speaking failed: ${err.message}`));
    l.player.on(AudioPlayerStatus.Idle, () => { if (l.mixer?.ended) { l.mixer = null; settleMute(l); } });
  }
  const voice = Math.round((wavSeconds(wav) / (fx.rate || 1)) * 48000);
  if (l.mixer && !l.mixer.ended) return l.mixer.add(pcm, at, voice);
  l.mixer = new Mixer();
  l.mixer.add(pcm, at, voice);
  l.player.play(createAudioResource(l.mixer, { inputType: StreamType.Raw }));
}

async function announce(l, session) {
  const voices = session.state.config.voices || [];
  const v = voices[Math.floor(Math.random() * voices.length)];
  const wav = v ? await synthesize("NOW RECORDING", v.voice).catch(() => null) : null;
  const fx = v?.fx || {};
  const pcm = wav ? await renderVoice(wav, fx).catch(() => null) : null;
  if (!pcm || links.get(l.guildId) !== l || l.mixer) return settleMute(l);
  play(l, pcm, wav, fx, Date.now());
}

function settleMute(l) {
  const mute = !l.talk && !l.mixer;
  if (links.get(l.guildId) !== l || l.connection.joinConfig.selfMute === mute) return;
  try { l.connection.rejoin({ ...l.connection.joinConfig, selfMute: mute }); } catch {}
}

export function discordCut(sessionCode) {
  const l = linkOf(sessionCode);
  if (!l?.mixer) return;
  l.mixer.cut();
  l.mixer = null;
  try { l.player?.stop(true); } catch {}
  settleMute(l);
}

export function setDiscordTalk(sessionCode, on) {
  const l = linkOf(sessionCode);
  if (!l || l.talk === !!on) return;
  l.talk = !!on;
  if (!on) discordCut(sessionCode);
  settleMute(l);
}

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

const warned = new Map();
function warnOnce(session, what, text) {
  const k = `${session.code}:${what}`;
  if (Date.now() - (warned.get(k) || 0) < 120_000) return;
  warned.set(k, Date.now());
  session.send("dm", { t: "toast", level: "error", text });
}

async function transcribe(session, pcm) {
  const key = session.sttKey;
  if (!key) {
    warnOnce(session, "nokey", "Discord speech isn't being transcribed: no Groq key. Add one in Settings → Discord.");
    return "";
  }
  const form = new FormData();
  form.append("file", new Blob([toWav(pcm)], { type: "audio/wav" }), "speech.wav");
  form.append("model", STT_MODEL);
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  if (STT_LANGUAGE) form.append("language", STT_LANGUAGE);
  const prompt = session.sttPrompt();
  if (prompt) form.append("prompt", prompt);
  let r;
  try {
    r = await fetch(STT_URL, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    warnOnce(session, "net", `Couldn't reach Groq to transcribe Discord speech: ${err.message}`);
    return "";
  }
  if (r.status === 401) { warnOnce(session, "401", "Groq rejected the key, so Discord speech isn't being transcribed. Check it in Settings → Discord."); return ""; }
  if (r.status === 429) { warnOnce(session, "429", "Groq rate limit hit: some Discord speech was missed."); return ""; }
  if (!r.ok) { warnOnce(session, "http", `Groq couldn't transcribe Discord speech (HTTP ${r.status}).`); return ""; }
  const data = await r.json().catch(() => ({}));
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
  pcm.on("error", end);
  opus.on("error", end);
}

const COMMANDS = [{
  name: "terminal",
  description: "Mothership terminal: transcribe this voice channel",
  contexts: [0],
  integration_types: [0],
  options: [
    { type: 1, name: "listen", description: "Join your voice channel and transcribe it into a session", options: [
      { type: 3, name: "code", description: "The session code players join with", required: true },
    ] },
    { type: 1, name: "player", description: "Set which crew member you play (the Warden can set anyone's)", options: [
      { type: 3, name: "character", description: "A crew member, Nobody, or Warden (Warden only)", required: true, autocomplete: true },
      { type: 6, name: "user", description: "Who plays them (default: you; Warden only for others)", required: false },
    ] },
    { type: 1, name: "stop", description: "Stop listening and leave the voice channel" },
  ],
}];

async function onListen(i) {
  const code = String(i.options.getString("code") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const session = getSession(code);
  if (!session) return i.reply({ content: "No game with that code. The code is at the top of the Warden console.", flags: MessageFlags.Ephemeral });
  const channel = i.member?.voice?.channel;
  if (!channel) return i.reply({ content: "Join a voice channel first, then run this again.", flags: MessageFlags.Ephemeral });
  if (!channel.joinable) return i.reply({ content: `Can't join ${channel.name}. Give the bot Connect and View Channel there.`, flags: MessageFlags.Ephemeral });
  await i.deferReply();

  leave(i.guildId);
  stopListening(code);
  const talk = !!session.state.config.discordTalk;
  const connection = joinVoiceChannel({ channelId: channel.id, guildId: i.guildId, adapterCreator: i.guild.voiceAdapterCreator, selfDeaf: false, selfMute: false });
  const link = { session: code, guildId: i.guildId, guildName: i.guild.name, channelId: channel.id, channelName: channel.name, wardenId: i.user.id, wardenName: i.member?.displayName || i.user.username, connection, talk, player: null, mixer: null, chain: Promise.resolve(), names: new Map(), emptyTimer: null };
  links.set(i.guildId, link);
  showPresence();
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch {
    leave(i.guildId);
    return i.editReply("Couldn't connect to the voice channel. Try again.");
  }
  connection.receiver.speaking.on("start", (userId) => links.get(i.guildId) === link && capture(i.guild, link, userId));
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([entersState(connection, VoiceConnectionStatus.Signalling, 5_000), entersState(connection, VoiceConnectionStatus.Connecting, 5_000)]);
    } catch {
      if (links.get(i.guildId) === link) leave(i.guildId, "Discord: the bot was disconnected from the voice channel.");
    }
  });
  connection.on(VoiceConnectionStatus.Destroyed, () => links.get(i.guildId) === link && leave(i.guildId));
  announce(link, session).catch((err) => { console.warn(`[discord] announcing failed: ${err.message}`); settleMute(link); });
  session.discordMoved();
  session.send("dm", { t: "toast", level: "info", text: `Discord: listening in ${channel.name} (${i.guild.name}).` });
  const keyNote = session.sttKey ? "" : "\nNo Groq key yet: nothing is transcribed until the Warden adds one in Settings → Discord.";
  await i.editReply(`Listening in **${channel.name}**. Speech here is transcribed for the Warden. Anyone can stop it with \`/terminal stop\`.${keyNote}`);
}

const WARDEN = "Warden", NOBODY = "Nobody";
const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function findCrew(crew, ref) {
  const r = norm(ref);
  if (!r) return null;
  const exact = crew.find((c) => norm(c.name) === r || c.id === ref);
  if (exact) return exact;
  const some = crew.filter((c) => norm(c.name).split(" ").includes(r) || norm(c.name).includes(r));
  return some.length === 1 ? some[0] : null;
}

async function onAutocomplete(i) {
  const link = links.get(i.guildId);
  const s = getSession(link?.session);
  const typed = norm(i.options.getFocused());
  const names = [...(s?.state.config.crew || []).map((c) => c.name), ...(i.user.id === link?.wardenId ? [WARDEN] : []), NOBODY];
  await i.respond(names.filter((n) => !typed || norm(n).includes(typed)).slice(0, 25).map((n) => ({ name: n.slice(0, 100), value: n.slice(0, 100) })));
}

async function onPlayer(i) {
  const link = links.get(i.guildId);
  const s = getSession(link?.session);
  if (!link || !s) return i.reply({ content: "Not listening in this server. Start with `/terminal listen`.", flags: MessageFlags.Ephemeral });
  const user = i.options.getUser("user") || i.user;
  const isWarden = i.user.id === link.wardenId;
  const self = user.id === i.user.id;
  const denied = (text) => i.reply({ content: text, flags: MessageFlags.Ephemeral });
  if (user.bot) return denied("That's a bot.");
  if (!self && !isWarden) return denied(`Only the Warden (${link.wardenName}) can set who others play. For yourself, leave out user.`);
  const name = (self ? i.member?.displayName : i.options.getMember("user")?.displayName) || user.globalName || user.username;
  link.names.set(user.id, { name, bot: false });
  const ref = i.options.getString("character");
  const quiet = { allowedMentions: { parse: [] } };

  if (norm(ref) === norm(WARDEN)) {
    if (!isWarden) return denied(`Only the Warden (${link.wardenName}) can pass on the Warden role.`);
    if (user.id === link.wardenId) return denied("You're already the Warden.");
    link.wardenId = user.id;
    link.wardenName = name;
    s.assignPlayer(user.id, null);
    s.send("dm", { t: "toast", level: "info", text: `Discord: ${name} is the Warden now.` });
    return i.reply({ content: `<@${user.id}> is the Warden now.`, ...quiet });
  }
  if (user.id === link.wardenId) {
    return denied(`${self ? "You're" : "That's"} the Warden. Pass the role on first: \`/terminal player character:Warden user:@someone\`.`);
  }
  if (norm(ref) === norm(NOBODY)) {
    s.assignPlayer(user.id, null);
    return i.reply({ content: `<@${user.id}> plays nobody now and speaks as themselves.`, ...quiet });
  }
  const crew = s.state.config.crew;
  const member = findCrew(crew, ref);
  if (!member) {
    return i.reply({ content: `No crew member called "${ref}". The crew: ${crew.map((c) => c.name).join(", ") || "(none yet)"}.`, flags: MessageFlags.Ephemeral });
  }
  const holder = Object.entries(s.state.discordPlayers || {}).find(([u, p]) => p.crew === member.id && u !== user.id);
  if (holder && !isWarden) return denied(`${holder[1].name} already plays ${member.name}. The Warden can change that.`);
  s.assignPlayer(user.id, member.id, name);
  await i.reply({ content: `<@${user.id}> plays **${member.name}**.`, ...quiet });
}

async function onStop(i) {
  if (!links.has(i.guildId)) return i.reply({ content: "Not listening in this server.", flags: MessageFlags.Ephemeral });
  leave(i.guildId, `Discord: ${i.member?.displayName || i.user.username} stopped the listening.`);
  await i.reply("Stopped listening.");
}

function onVoiceState(oldState, newState) {
  for (const id of new Set([oldState.guild.id, newState.guild.id])) {
    const l = links.get(id);
    if (!l) continue;
    if (newState.id === client.user.id && newState.channelId && newState.channelId !== l.channelId) {
      l.channelId = newState.channelId;
      l.channelName = newState.channel?.name || l.channelName;
      getSession(l.session)?.syncDm();
    }
    const ch = newState.guild.channels.cache.get(l.channelId);
    const people = ch?.members?.filter((m) => !m.user.bot).size ?? 0;
    clearTimeout(l.emptyTimer);
    l.emptyTimer = people ? null : setTimeout(() => leave(id, "Discord: everyone left, so the bot left the voice channel."), EMPTY_LEAVE_MS);
  }
}

export function startDiscord(lookup) {
  if (!discordEnabled || client) return;
  getSession = lookup;
  client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  client.once(Events.ClientReady, async (c) => {
    inviteUrl = `https://discord.com/oauth2/authorize?client_id=${c.user.id}&scope=bot+applications.commands&permissions=${PERMISSIONS}`;
    try {
      const current = await c.application.commands.fetch();
      const same = current.size === COMMANDS.length && COMMANDS.every((d) => current.find((x) => x.name === d.name)?.equals(d, true));
      if (!same) {
        await c.application.commands.set(COMMANDS);
        console.log("  Discord: /terminal registered (changed).");
      }
    } catch (err) {
      console.warn(`  ! Discord: couldn't register /terminal: ${err.message}`);
    }
    showPresence();
    console.log(`  Discord bot online as ${c.user.tag}. Invite it: ${inviteUrl}`);
  });
  client.on(Events.InteractionCreate, async (i) => {
    if (i.commandName !== "terminal") return;
    if (i.isAutocomplete()) return onAutocomplete(i).catch(() => {});
    if (!i.isChatInputCommand()) return;
    if (!i.inCachedGuild()) {
      return i.reply({ content: `The bot isn't in this server yet, only its commands are, so it can't see or join voice channels. Someone who can manage the server needs to add it with this link: ${inviteUrl}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
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
