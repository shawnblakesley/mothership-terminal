(() => {
  const params = new URLSearchParams(location.search);
  // The Warden's stream page (…/stream?s=CODE#key=…): this screen, watching from no
  // terminal, with everything in the Warden's log on it (their notes and asides too, as
  // terminal lines), and the crew being played along the bottom beside the Warden's camera.
  const stream = /\/stream$/.test(location.pathname);
  const streamKey = new URLSearchParams(location.hash.slice(1)).get("key") || "";
  const spectate = params.has("spectate") || stream;
  const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  let code = normCode(params.get("s"));

  const $ = (id) => document.getElementById(id);
  // localStorage, where the browser allows it (else nothing is remembered).
  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
    del: (k) => { try { localStorage.removeItem(k); } catch {} },
  };
  const linesEl = $("lines"), screenEl = $("screen"), input = $("in"), form = $("inputrow");
  const caret = $("caret"), busyEl = $("busy"), promptEl = $("prompt");

  let header = { stationName: "----", accessLevel: "GUEST", theme: "green" };
  let ws, busy = false;
  const send = (msg) => ws?.readyState === 1 && ws.send(JSON.stringify(msg));
  const history = [];
  let histIdx = -1;

  // ------------------------------------------------------------ boot
  const bootEl = $("boot");
  const bootText = $("boot-text"), joinForm = $("join"), joinInput = $("join-code"), joinErr = $("join-err");
  const printBoot = (lines, delay = 260) => new Promise((resolve) => {
    let i = 0;
    const iv = setInterval(() => {
      if (i >= lines.length) { clearInterval(iv); return resolve(); }
      bootText.textContent += lines[i++] + "\n";
    }, delay);
  });

  // The portrait pack's credit (its licence asks for one): on the start-up screen
  // only, not during play; and not at all once we know the story uses none of its pictures.
  function showCredit() {
    $("credit").hidden = bootEl.classList.contains("gone") || header.portraitCredit === false;
  }

  // Turn on the terminal: CRT power-on, and sound. Browsers only allow sound after a key
  // press or click, so until there's been one it waits (and the first one starts it).
  function powerOn() {
    FX.Sound.unlock();
    FX.Sound.beep(1200, 0.05);
    const wake = () => {
      FX.Sound.unlock();
      if (FX.Sound.ctx?.state !== "running") return;
      for (const ev of ["keydown", "pointerdown"]) removeEventListener(ev, wake, true);
    };
    for (const ev of ["keydown", "pointerdown"]) addEventListener(ev, wake, true);
    bootEl.classList.add("gone");
    showCredit();
    const crtEl = $("crt");
    crtEl.classList.add("power-on");
    crtEl.addEventListener("animationend", () => crtEl.classList.remove("power-on"), { once: true });
    input.focus();
  }

  async function lookup(c) {
    const r = await fetch(`api/sessions/${encodeURIComponent(c)}`).catch(() => null);
    if (r?.ok) return r.json();
    if (r?.status === 429) throw new Error("TOO MANY ATTEMPTS. WAIT A MINUTE.");
    throw new Error(r ? "NO SESSION WITH THAT CODE." : "STATION LINK DOWN. TRY AGAIN.");
  }

  // Ask for a session code (shown when the link didn't include one, or it was wrong).
  function askForCode(message) {
    joinForm.hidden = false;
    joinErr.textContent = message || "";
    joinInput.value = code;
    joinInput.focus();
  }

  joinForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const c = normCode(joinInput.value);
    if (!c) return;
    joinErr.textContent = "LINKING...";
    try {
      const info = await lookup(c);
      code = info.code;
      window.history.replaceState(null, "", `?s=${code}`); // (plain "history" is the command history below)
      joinForm.hidden = true;
      await printBoot([`STATION LINK ........... ${info.stationName}`, ""], 120);
      powerOn(); // (submitting the form is the key press browsers need for sound)
      connect();
    } catch (err) {
      joinErr.textContent = err.message;
    }
  });

  if (stream) {
    document.body.classList.add("stream");
    form.hidden = true;
    $("hdr-rules").hidden = $("hdr-rules").nextElementSibling.hidden = true;
    $("castbar").hidden = false;
    // The screen's effects (and the dice, a room's plan) stay above the crew and the camera.
    // (laid-out position, not the drawn one: the power-on animation squashes the screen for a moment)
    const fxBottom = () => document.body.style.setProperty("--fx-bottom", `${Math.max(0, innerHeight - $("crt").offsetTop - $("castbar").offsetTop)}px`);
    new ResizeObserver(fxBottom).observe($("castbar"));
    addEventListener("resize", fxBottom);
    fxBottom();
    powerOn(); // (streaming software plays sound without a click; a browser tab wakes on the first one)
  } else if (spectate) {
    bootEl.classList.add("gone");
    showCredit();
    form.hidden = true;
    FX.Sound.muted = true;
    document.querySelector(".vol").hidden = true;
  } else {
    (async () => {
      await printBoot(["TERMINAL BIOS v4.1", "MEMORY CHECK ............ 65536K OK", "NEURAL CORE ............. ONLINE"]);
      if (!code) return askForCode();
      try {
        const info = await lookup(code);
        await printBoot([`STATION LINK ........... ${info.stationName}`, ""]);
        powerOn();
        connect();
      } catch (err) {
        askForCode(err.message);
      }
    })();
  }

  // ------------------------------------------------------------ header / clock
  function applyHeader(h) {
    header = h;
    showCredit();
    applyTerminal(); // (with the names: a terminal on another system shows that system's)
    renderSide();
    if (!$("crewfile").hidden) renderFile();
    for (const el of linesEl.querySelectorAll(".line.player")) el.dataset.prompt = el.dataset.prompt || "";
    placeCaret();
  }
  setInterval(() => { $("hdr-clock").textContent = new Date().toTimeString().slice(0, 8); }, 1000);

  // ------------------------------------------------------------ lines
  // Every screen shows and speaks a line at the same moment: the server gives
  // each line (and each spoken piece of it) a start time on one timeline, in
  // server-clock ms (see Session.scheduleLine). This screen syncs its clock to
  // the server's and plays to that schedule.
  //   entry.timing = { at, speakAt, end, versions: [[{ i, at, dur, audio, last }], ...] }

  // ---- server clock
  let clockOffset = 0; // server time minus this screen's time
  let bestRtt = Infinity;
  const serverNow = () => Date.now() + clockOffset;
  const untilServer = (t) => Math.max(0, t - serverNow());
  function ping() { send({ t: "ping", c: Date.now() }); }
  function onPong({ c, s }) {
    const rtt = Date.now() - c;
    // Trust the quickest round trips (least skewed by network delay).
    if (rtt > bestRtt * 1.5 + 20) return;
    bestRtt = Math.min(bestRtt, rtt);
    clockOffset = s + rtt / 2 - Date.now();
  }
  setInterval(ping, 30_000);

  // Which voice a line belongs to: its entity, or the built-in terminal/broadcast voice.
  function voiceOf(entry) {
    const id = entry.entity || (entry.kind === "system" ? "broadcast" : "terminal");
    return header.voices?.[id];
  }

  // The speckle for portraits heard over the intercom (player.css .portrait.comms).
  try {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    const g = cv.getContext("2d"), px = g.createImageData(64, 64);
    for (let i = 0; i < px.data.length; i += 4) { const n = Math.random() * 255; px.data.set([n, n, n, Math.random() < 0.55 ? 255 : 0], i); }
    g.putImageData(px, 0, 0);
    document.documentElement.style.setProperty("--noise", `url(${cv.toDataURL()})`);
  } catch { /* (no canvas: plain flicker) */ }

  function makeLine(entry) {
    const div = document.createElement("div");
    div.className = `line ${entry.kind}`;
    div.dataset.id = entry.id;
    if (entry.kind === "player") {
      // (on the stream: who typed it, and on which system)
      if (stream) whereTag(entry); // (its prompt says where)
      div.dataset.prompt = stream ? `${entry.by ? shortName({ name: entry.by }) : "CREW"}@${sysOf(entry.net) || header.stationName}> ` : `${promptText()} `;
      return div;
    }
    if (META[entry.kind]) { // (the Warden's own entries, on the stream)
      div.classList.add("meta", "style-label");
      div.dataset.kind = entry.kind;
      div.dataset.label = entry.kind === "note" ? "> " : `${META[entry.kind](entry)}: `;
      return div;
    }
    if (entry.kind === "roll") {
      div.classList.add("roll");
      // Someone else's roll: a filled panel, green for a success and red for a failure,
      // so it stands out from your own.
      if (entry.by && entry.by !== mine()?.name) {
        div.classList.add("others");
        const o = String(entry.outcome || "");
        if (o) div.classList.add(/success|cool/.test(o) ? "ok" : "bad");
      }
      return div;
    }
    const v = voiceOf(entry);
    div.classList.add(`style-${entry.inPerson ? "label" : v?.style || (entry.kind === "system" ? "boxed" : "plain")}`);
    // Someone of the cast over the intercom shows who is speaking: "INTERCOM · SALK: ".
    let label = entry.inPerson && entry.character ? `${entry.character.toUpperCase()}: ` // (in the room with them)
      : v?.style === "label" ? `${entry.shownAs || v.name}${entry.character ? ` · ${entry.character.toUpperCase()}` : ""}: ` : ""; // (an adversary: the name its line was said under)
    // The stream shows every system's lines: where they're on, when that changes. (Not the narrator's: the scene's on no system.)
    const where = stream && v?.style !== "narration" && whereTag(entry);
    if (where) { label = `[${where}] ${label}`; div.classList.add("style-label"); }
    if (label) div.dataset.label = label;
    // Their portrait, to the left of what they say: clear in person, full of static over the intercom.
    const portrait = entry.character && header.portraits?.[entry.character.toLowerCase()];
    if (portrait) withPortrait(div, portrait, { comms: !entry.inPerson, label });
    // (In person they're not on the intercom: the screen's own colour, not the intercom's.)
    if (v?.color && !entry.inPerson) {
      div.style.color = v.color;
      div.style.borderColor = v.color;
      div.style.textShadow = `0 0 2px ${v.color}88, 0 0 9px ${v.color}66`;
    }
    return div;
  }

  // A portrait's address: one that comes with the app, or one the Warden uploaded.
  const portraitSrc = (file) => (file.startsWith("kit/") ? `portraits/${file.slice(4)}` : `api/sessions/${code}/portraits/${file}`);
  // Portraits are see-through line art (the lines opaque, the paper clear): used as a
  // stencil, the lines take the text's colour and the screen shows through the rest.
  // (The hidden image is only there to drop the portrait if it won't load.)
  const portraitHtml = (file, cls = "") => (file ? `<span class="portrait ${cls}" style="--src: url('${escH(portraitSrc(file))}')"><span class="ink"></span><img src="${escH(portraitSrc(file))}" alt="" hidden onerror="this.parentNode.remove()"></span>` : "");
  // A line with a portrait on its left; its text goes in a span beside it.
  function withPortrait(div, file, { comms = false, label = "" } = {}) {
    div.classList.add("has-portrait");
    const pic = document.createElement("span");
    pic.className = `portrait${comms ? " comms" : ""}`;
    pic.style.setProperty("--src", `url('${portraitSrc(file)}')`);
    const ink = document.createElement("span");
    ink.className = "ink";
    const probe = new Image(); // (drop it if it won't load)
    probe.onerror = () => pic.remove();
    probe.src = portraitSrc(file);
    pic.append(ink);
    const text = document.createElement("span");
    text.className = "lt";
    if (label) text.dataset.label = label;
    div.append(pic, text);
  }

  // Where a line's text goes: its text span (beside a portrait), or the line itself.
  const textOf = (div) => div.querySelector(".lt") || div;

  // ---- the stream page: the Warden's log, as terminal lines
  // The system a line was said on, by name: "" for the station's own network.
  const netKey = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const sysOf = (net) => (!net ? "" : net === "*" ? "ALL SYSTEMS" : terminals().find((t) => t.system && netKey(t.system) === net)?.system || "");
  // The system a line is on, when it's not the one the line before was on (else "").
  let lastWhere = "";
  function whereTag(entry) {
    const name = sysOf(entry.net) || header.stationName;
    if (name === lastWhere) return "";
    lastWhere = name;
    return name;
  }
  // The Warden's own entries (session.js PRIVATE_KINDS): their label.
  const META = {
    note: () => "LOG",
    warden: () => "WARDEN > CORE",
    aside: () => "WARDEN NOTE",
    aside_reply: () => "CORE > WARDEN",
    heard: () => "WARDEN (VOICE)",
    table: (e) => `COMMS · ${e.playing ? `${e.playing} (${e.speaker || "CREW"})` : e.speaker || "CREW"}`.toUpperCase(),
  };
  // A note's text, as the terminal puts it: "Agent triggered effect: blackout (2s) before line #13" -> "EFFECT: BLACKOUT (2S)".
  function metaText(e) {
    const fx = /^Agent triggered effect: (.*?)(?: (before|after) line #\d+)?$/.exec(e.text || "");
    if (fx) return `EFFECT: ${fx[1]}${fx[2] === "after" ? " (AFTER THE LINE)" : ""}`;
    return String(e.text || "").replace(/^[\u2696\u26A1]\uFE0F?\s*/u, ""); // (no symbols)
  }
  // The per-player versions of a line, under it: "↳ ROOK: ..."
  function addVariants(div, entry) {
    for (const v of entry.variants || []) {
      const el = document.createElement("div");
      el.className = "var";
      el.textContent = `\u21B3 ${v.to.map(nameOf).join(", ")}: ${v.text}`;
      div.append(el);
    }
  }
  function onWardenLog({ add, update }) {
    for (const e of add) renderInstant(e);
    for (const u of update) {
      const div = linesEl.querySelector(`[data-id="${u.id}"]`);
      if (div?.dataset.kind) textOf(div).textContent = metaText(u);
    }
    scrollDown();
  }

  // Lines can read differently per character (variants): this screen shows the
  // one for its crew file, if any. Null when the line isn't for this screen at all.
  function forMe(entry) {
    if (stream) {
      if (META[entry.kind]) return { ...entry, text: metaText(entry) };
      return entry.text || entry.variants?.length || entry.kind === "player" ? entry : null; // (the main text; the versions go under it)
    }
    const vi = (entry.variants || []).findIndex((v) => myId && v.to.includes(myId));
    if (vi >= 0) return { ...entry, text: entry.variants[vi].text, vi };
    return entry.text || entry.kind === "player" ? entry : null;
  }

  // The text pieces a line is spoken in: one per text line for human voices
  // (blank lines ride along with the next), else the whole text. Same split as
  // the server's speechParts.
  function piecesOf(entry) {
    if (!(voiceOf(entry)?.chunked || entry.character) || entry.kind === "roll" || entry.kind === "player") return [entry.text];
    const out = [];
    let pending = "";
    for (const row of entry.text.split("\n")) {
      if (!row.trim()) { pending += `${row}\n`; continue; }
      out.push(pending + row);
      pending = "";
    }
    if (pending && out.length) out[out.length - 1] += `\n${pending.replace(/\n$/, "")}`;
    return out.length ? out : [entry.text];
  }

  function clipUrl(entry, part) {
    const q = new URLSearchParams();
    if (entry.vi >= 0) q.set("v", entry.vi);
    if (voiceOf(entry)?.chunked || entry.character) q.set("part", part);
    const qs = q.toString();
    return `api/sessions/${code}/tts/${entry.id}${qs ? `?${qs}` : ""}`;
  }

  function renderInstant(raw) {
    const entry = forMe(raw);
    if (!entry) return;
    const div = makeLine(entry);
    textOf(div).textContent = entry.text;
    if (stream) addVariants(div, entry);
    div.classList.add("done");
    linesEl.append(div);
  }

  // ---- playing lines to the schedule
  let lineGen = 0; // bumped on init: timers from before it do nothing
  const plays = new Map(); // entry id -> play
  const canHear = () => header.tts && !muted && volume > 0 && FX.Sound.ok();

  function enqueue(raw) {
    if (raw.kind === "player" || !raw.timing) { // what a player typed (or an unscheduled line)
      renderInstant(raw);
      return scrollDown();
    }
    if (plays.has(raw.id) || linesEl.querySelector(`[data-id="${raw.id}"]`)) return;
    const entry = forMe(raw); // null: not for this screen (it still keeps its place for effects)
    const v = !entry || (stream && !raw.text) ? -1 : entry.vi >= 0 ? entry.vi + 1 : 0; // (the stream: the main text, if there is one)
    const play = { gen: lineGen, raw, entry, v, pieces: entry ? piecesOf(entry) : [], div: null, finished: false };
    plays.set(raw.id, play);
    cueState.set(raw.id, "queued");
    updateBusy();
    setTimeout(() => startLine(play), untilServer(raw.timing.at));
    if (v >= 0) for (const part of raw.timing.versions[v] || []) schedulePart(play, part);
    if (raw.timing.end) onLineEnd({ id: raw.id, end: raw.timing.end });
  }

  // Effects "before" the line fire now (a beat like a blackout is already in the schedule).
  function startLine(play) {
    if (play.gen !== lineGen) return;
    cueState.set(play.raw.id, "showing");
    if (play.raw.reveal) showImage(play.raw.reveal); // (the players see it: now, not before)
    releaseCues(play.raw.id, "before");
  }

  function schedulePart(play, part) {
    // The clip came with the message (or, for a line already under way when this
    // screen joined, fetch it); decode it now so it's ready on time.
    const audio = !part.audio || !canHear() ? null : part.wav ? Voice.decode(part.wav) : Voice.load(clipUrl(play.entry, part.i));
    delete part.wav; // (don't keep the audio around in the timeline)
    setTimeout(() => playPart(play, part, audio), untilServer(part.at));
  }

  async function playPart(play, part, audio) {
    if (play.gen !== lineGen || play.cut || (play.cutAt !== undefined && part.at > play.cutAt)) return;
    if (!play.div) {
      play.div = makeLine(play.entry);
      play.div.classList.add("typing");
      linesEl.append(play.div);
      if (play.entry.kind !== "terminal" && play.entry.kind !== "roll") FX.Sound.beep(play.entry.kind === "system" ? 520 : 380, 0.15, 0.08);
    }
    const text = (part.i ? "\n" : "") + (play.pieces[part.i] ?? "");
    const late = serverNow() - part.at;
    // The whole clip always plays: a screen that's a moment late starts it a moment late.
    if (audio) audio.then((buf) => play.gen === lineGen && !play.cut && Voice.playNow(buf, play.entry.inPerson ? {} : voiceOf(play.entry)?.fx)); // (in person: their own voice, no speaker effects)
    // Type it out within the piece's time (all at once if this screen is late).
    if (late > part.dur * 0.6) { textOf(play.div).textContent += text; scrollDown(); }
    else typeInto(textOf(play.div), text, part.dur - Math.max(0, late));
    if (part.last) setTimeout(() => finishLine(play), Math.max(0, part.dur - Math.max(0, late)));
  }

  function finishLine(play) {
    if (play.finished || play.gen !== lineGen) return;
    play.finished = true;
    if (stream && play.entry?.variants?.length) {
      if (!play.div) { play.div = makeLine(play.entry); linesEl.append(play.div); }
      addVariants(play.div, play.entry);
      scrollDown();
    }
    if (play.div) {
      play.div.classList.remove("typing");
      play.div.classList.add("done");
    }
    cueState.set(play.raw.id, "done");
    releaseCues(play.raw.id, "after");
    plays.delete(play.raw.id);
    updateBusy();
  }

  // A player typed while lines were playing: the comms stop on every screen.
  // Lines that hadn't started are gone; a line cut off mid-way stops where it is.
  function onInterrupt({ at, cut, trimmed }) {
    Voice.interrupt();
    for (const id of cut) {
      const play = plays.get(id);
      if (play) { play.cut = true; play.div?.remove(); plays.delete(id); }
      heldCues.delete(id);
      cueState.set(id, "done");
    }
    for (const id of trimmed) {
      const play = plays.get(id);
      if (!play) continue;
      play.cutAt = at;
      if (play.div) textOf(play.div).textContent += " —";
      finishLine(play);
    }
    updateBusy();
  }

  function onPart({ id, v, part }) {
    const play = plays.get(id);
    if (!play) return;
    (play.raw.timing.versions[v] ||= []).push(part);
    if (v === play.v) schedulePart(play, part);
  }

  // A line's last moment: lines that aren't for this screen finish here.
  function onLineEnd({ id, end }) {
    const play = plays.get(id);
    if (!play) return;
    play.raw.timing.end = end;
    if (play.v < 0) setTimeout(() => finishLine(play), untilServer(end));
  }

  // Type `text` onto the end of `div` within about `budget` ms (the time the voice takes).
  function typeInto(div, text, budget = text.length * 14) {
    const start = div.textContent;
    const len = Math.max(1, text.length);
    const per = (budget * 0.85) / len; // ms per character to finish in time
    const interval = Math.max(4, Math.min(14, per));
    const perTick = per < 4 ? Math.ceil(4 / Math.max(0.1, per)) : 1;
    let i = 0;
    const step = () => {
      if (!div.isConnected) return;
      i = Math.min(text.length, i + perTick);
      div.textContent = start + text.slice(0, i);
      if (i % 3 === 0) FX.Sound.tick();
      scrollDown();
      if (i < text.length) setTimeout(step, interval);
    };
    step();
  }

  // ------------------------------------------------------------ effect cues
  // The agent can time an effect to a line ("before" it starts, or "after" the
  // last line). It waits here until its line comes up on the schedule, then
  // runs for its own duration.
  const cueState = new Map(); // entry id -> "queued" | "showing" | "done"
  const heldCues = new Map(); // entry id -> { before: [], after: [] }

  function runEffect(effect) {
    FX.start(effect);
    if (effect.atEntry && effect.seconds > 0) setTimeout(() => FX.end(effect.id), effect.seconds * 1000);
  }

  function onEffect(effect) {
    const st = effect.atEntry ? cueState.get(effect.atEntry) : "none";
    // (A line not here yet is still being scheduled: hold its effect for it.)
    const due = st === "none" || st === "done" || (st === "showing" && effect.when === "before");
    if (due) return runEffect(effect);
    const h = heldCues.get(effect.atEntry) || { before: [], after: [] };
    h[effect.when === "after" ? "after" : "before"].push(effect);
    heldCues.set(effect.atEntry, h);
  }

  function releaseCues(id, when) {
    const h = heldCues.get(id);
    if (h) for (const e of h[when].splice(0)) runEffect(e);
  }

  function dropCue(fxId) {
    for (const h of heldCues.values()) for (const k of ["before", "after"]) h[k] = h[k].filter((e) => e.id !== fxId);
  }

  function scrollDown() { screenEl.scrollTop = screenEl.scrollHeight; }

  // How long it's been thinking, once that's more than a moment (slow models
  // shouldn't look broken).
  let busySince = 0;
  function updateBusy() {
    busyEl.hidden = !(busy && !plays.size);
    if (busy && !busySince) busySince = Date.now();
    if (!busy) busySince = 0;
    tickBusy();
    if (!busyEl.hidden) scrollDown();
  }
  function tickBusy() {
    const s = busySince ? Math.round((Date.now() - busySince) / 1000) : 0;
    $("busy-t").textContent = s >= 8 ? `· ${s}S` : "";
  }
  setInterval(tickBusy, 1000);

  // ------------------------------------------------------------ input
  const measure = document.createElement("canvas").getContext("2d");
  function placeCaret() {
    const cs = getComputedStyle(input);
    measure.font = `${cs.fontSize} ${cs.fontFamily}`;
    const w = measure.measureText(input.value.toUpperCase().slice(0, input.selectionStart ?? input.value.length)).width;
    caret.style.left = `${input.offsetLeft + Math.min(w, input.clientWidth - 4)}px`;
  }
  ["input", "keyup", "click", "focus"].forEach((ev) => input.addEventListener(ev, placeCaret));
  addEventListener("resize", placeCaret);
  // (and whenever the prompt changes size: renamed on connecting, the font arriving, the row shown again)
  new ResizeObserver(() => placeCaret()).observe(promptEl);
  new ResizeObserver(() => placeCaret()).observe(input);

  // Nothing speaks during a blackout; lines that arrive then stay silent.
  Voice.setBlocked(() => FX.has("blackout"));

  function lockedOut() { return FX.has("lockout"); }
  document.addEventListener("fxchange", () => {
    // Power cut: silence what is being said now. Queued lines wait for the
    // lights to come back (Voice is blocked meanwhile), then carry on.
    if (FX.has("blackout")) Voice.interrupt();
    form.classList.toggle("disabled", lockedOut());
    input.disabled = lockedOut() || watching();
    const typingElsewhere = document.activeElement && document.activeElement !== input && document.activeElement.matches("input, textarea, select");
    if (!lockedOut() && !spectate && !typingElsewhere) input.focus();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || lockedOut() || watching()) return;
    history.unshift(text);
    histIdx = -1;
    input.value = "";
    placeCaret();
    FX.Sound.beep(1400, 0.03, 0.04);
    if (/^(clear|cls)$/i.test(text)) { linesEl.innerHTML = ""; return; }
    send({ t: "input", text });
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" && history.length) {
      histIdx = Math.min(history.length - 1, histIdx + 1);
      input.value = history[histIdx];
      e.preventDefault();
    } else if (e.key === "ArrowDown") {
      histIdx = Math.max(-1, histIdx - 1);
      input.value = histIdx < 0 ? "" : history[histIdx];
      e.preventDefault();
    } else if (e.key.length === 1) {
      FX.Sound.tick();
    }
    requestAnimationFrame(placeCaret);
  });
  // Clicking anywhere on the screen focuses the prompt.
  screenEl.addEventListener("click", (e) => {
    if (getSelection().toString() || document.body.classList.contains("panel-open")) return;
    if (e.target.closest("input, button, select, textarea, a, label, .rollbox, .panel")) return;
    input.focus();
  });

  // ------------------------------------------------------------ volume
  // Ten-segment retro meter, top right. Click/drag a segment, scroll, or use
  // arrow keys; click VOL to mute. Remembered per device.
  const volBars = $("vol-bars"), volBtn = $("vol-mute");
  let volume = 0.8, muted = false;
  try {
    const saved = JSON.parse(ls.get("terminal-volume") || "null");
    if (saved) ({ volume, muted } = saved);
  } catch {}
  volBars.innerHTML = Array.from({ length: 10 }, (_, i) => `<i data-v="${(i + 1) / 10}"></i>`).join("");
  function applyVolume() {
    volume = Math.round(Math.min(1, Math.max(0, volume)) * 10) / 10;
    FX.Sound.setVolume(muted ? 0 : volume);
    volBars.querySelectorAll("i").forEach((b, i) => b.classList.toggle("on", !muted && i < volume * 10));
    volBtn.classList.toggle("muted", muted || volume === 0);
    volBtn.textContent = muted || volume === 0 ? "MUTE" : "VOL";
    volBars.setAttribute("aria-valuenow", String(muted ? 0 : volume * 10));
    ls.set("terminal-volume", JSON.stringify({ volume, muted }));
  }
  const setFromPointer = (e) => {
    const b = e.target.closest("i");
    if (b) { volume = Number(b.dataset.v); muted = false; applyVolume(); }
  };
  let dragging = false;
  volBars.addEventListener("pointerdown", (e) => { dragging = true; setFromPointer(e); e.preventDefault(); });
  volBars.addEventListener("pointerover", (e) => dragging && setFromPointer(e));
  addEventListener("pointerup", () => { if (dragging) { dragging = false; input.focus(); } });
  volBars.addEventListener("wheel", (e) => { e.preventDefault(); volume += e.deltaY < 0 ? 0.1 : -0.1; muted = false; applyVolume(); });
  volBars.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") volume += 0.1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") volume -= 0.1;
    else return;
    e.preventDefault(); muted = false; applyVolume();
  });
  volBtn.addEventListener("click", () => { muted = !muted; applyVolume(); input.focus(); });
  applyVolume();

  // ------------------------------------------------------------ crew files
  // The players' characters. Each screen claims one (remembered per session on
  // this device); FILE in the header shows its sheet.
  let crew = [], claims = {}, myId = null;
  let played = []; // who is playing whom (at a screen, or on Discord): [{ id, by }]
  const crewKey = () => `crew:${code}`;
  const mine = () => crew.find((c) => c.id === myId) || null;
  const watching = () => !spectate && crew.length > 0 && !mine();
  let docs = []; // the documents this player holds (handouts; see "documents")
  // The square (■): drawn by a stand-in font that sits it on the baseline; .sq lifts it to the letters' middle.
  const SQ = '<span class="sq">■</span>', sq = (html) => `${SQ} ${html} ${SQ}`;
  const escH = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  // A label's text; mid-glitch, the one it rots and puts back (data-orig: effects.js).
  const setLabel = (el, t) => { if (el.dataset.orig !== undefined) el.dataset.orig = t; else el.textContent = t; };
  // The crew picker's button to start on: their own file's, else the first.
  const focusPick = () => ($("crewpick-list").querySelector("li.current button") || $("crewpick-list").querySelector("button"))?.focus();

  function openPanel(id) {
    if (id !== "docs") stopLog(); // (an audio log stops when its panel closes)
    for (const p of ["crewpick", "crewfile", "selfroll", "termpick", "solopick", "docs", "ending"]) $(p).hidden = p !== id;
    document.body.classList.toggle("panel-open", !!id);
    // (Not before power-on: the key that wakes the terminal would also press the button.)
    if (id === "crewpick" && bootEl.classList.contains("gone")) focusPick();
    if (!id && !spectate) input.focus();
    renderSide(); // (out of the way while choosing a character)
  }

  function setCrew(list, taken, playedBy) {
    crew = list || [];
    claims = taken || {};
    played = playedBy || [];
    renderCastbar();
    if (myId && !mine()) {
      // Their file was removed (or a new story began): choose again.
      myId = null;
      if (!spectate && crew.length) setTimeout(() => { renderPicker(); openPanel("crewpick"); });
    }
    const pc = mine();
    // Just watching (there are files, none of them theirs): no prompt, only the way back to the picker.
    form.hidden = spectate || watching();
    input.disabled = lockedOut() || watching();
    $("watchpick").hidden = !watching();
    $("hdr-file").hidden = $("hdr-file-sep").hidden = spectate || !crew.length;
    $("hdr-file").textContent = pc ? `FILE: ${shortName(pc)}` : "FILE: NONE";
    if (!$("crewpick").hidden) renderPicker();
    if (!$("crewfile").hidden) renderFile();
    renderSide();
  }
  // The stream page's corner: the crew being played, each with their portrait and condition,
  // and a frame for the Warden's camera (their streaming software puts the camera over it).
  let stationMap = null; // { layout, people: { room: [crew ids] } } (session.js streamMap)
  function renderCastbar() {
    if (!stream) return;
    if (stationMap) {
      StationMap.mini($("cb-map"), stationMap.layout, peopleNames(stationMap.people));
    }
    const pcs = played.map((p) => ({ ...p, c: crew.find((c) => c.id === p.id) })).filter((p) => p.c);
    $("cb-crew").innerHTML = pcs.map(({ c, by }) => {
      const wounds = Array.from({ length: c.wounds.max }, (_, i) => `<i class="${i < c.wounds.current ? "on" : ""}"></i>`).join("");
      return `<div class="cb-pc">
        <div class="cb-face">${portraitHtml(c.portrait, "cb-portrait") || '<span class="cb-noface">NO PHOTO</span>'}</div>
        <div class="cb-name"><span>${escH(shortName(c))}</span><span class="cb-wounds" title="Wounds">${wounds}</span></div>
        <div class="cb-vit"><span>HP ${c.health.current}/${c.health.max}</span><span>STRESS ${c.stress}</span></div>
        ${by ? `<div class="cb-by">${escH(by.toUpperCase())}</div>` : ""}
      </div>`;
    }).join("");
  }

  // A nickname in quotes ("Rook", 'Beck') if there is one, else the first name.
  const shortName = (c) => (c.name.match(/["'“‘]([^"'”’]+)["'”’]/)?.[1] || c.name.split(" ")[0]).toUpperCase();
  const nameOf = (id) => shortName(crew.find((c) => c.id === id) || { name: id });
  // Who is in which room, as the map shows them: { room: [short names] }.
  const peopleNames = (people) => Object.fromEntries(Object.entries(people).map(([room, ids]) => [room, ids.map((id) => nameOf(id))]));

  function renderPicker() {
    $("crewpick-list").innerHTML = crew.map((c, i) => {
      const others = (claims[c.id] || 0) - (c.id === myId ? 1 : 0);
      const cls = [c.portrait && "has-face", c.id === myId && "current"].filter(Boolean).join(" ");
      return `<li${cls ? ` class="${cls}"` : ""} data-id="${escH(c.id)}">${portraitHtml(c.portrait, "face")}<button type="button" class="p-btn pick" data-id="${escH(c.id)}">[${i + 1}] ${escH(c.name.toUpperCase())}</button>
        <span class="p-dim"> · ${escH(c.className.toUpperCase())} · ${escH(c.role.toUpperCase())}${others > 0 ? " · <b>IN USE</b>" : ""}${c.id === myId ? " · <b>CURRENT FILE</b>" : ""}</span>
        <div class="p-dim p-crime">${escH(c.crime)}</div></li>`;
    }).join("");
  }

  function vitalsChange(field, d) {
    const c = mine();
    if (!c) return;
    const cur = field === "stress" ? c.stress : c[field].current;
    send({ t: "vitals", field, value: cur + d });
    FX.Sound.beep(d > 0 ? 760 : 520, 0.05, 0.05);
  }
  for (const el of ["side", "crewfile-body"]) {
    $(el).addEventListener("click", (e) => {
      const v = e.target.closest("[data-vital]");
      if (v) return vitalsChange(v.dataset.vital, Number(v.dataset.d));
      const s = e.target.closest("[data-check]");
      if (s) openSelfRoll(s.dataset.check);
      const doc = e.target.closest("[data-doc]");
      if (doc) showDoc(doc.dataset.doc);
    });
  }

  // ---- the crew sheet, in cards (like the Mothership companion app), in the screen's colour.
  // A Stat or Save in a circle: tap it to roll (when the Warden allows it).
  const circle = (k, v) => header.selfRolls && !spectate
    ? `<button type="button" class="cs-num" data-check="${k}" title="Roll ${k}"><span class="cs-circle">${v}</span><span class="cs-k">${k.toUpperCase()}</span></button>`
    : `<div class="cs-num"><span class="cs-circle">${v}</span><span class="cs-k">${k.toUpperCase()}</span></div>`;
  // Health, Wounds or Stress in a pill, with [-] / [+] when players track their own.
  // (drawn, not typed: the font's hyphen is thinner than its plus)
  const STEP_ICON = (d) => `<svg viewBox="0 0 10 10" aria-hidden="true"><path d="${d}" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"/></svg>`;
  const STEP_MINUS = STEP_ICON("M1.5 5h7"), STEP_PLUS = STEP_ICON("M1.5 5h7M5 1.5v7");
  function pill(field, label, now, max, subs) {
    const ctl = header.vitals && !spectate;
    const btn = (d) => `<button type="button" class="p-btn cs-step" data-vital="${field}" data-d="${d}" aria-label="${field} ${d > 0 ? "up" : "down"}">${d > 0 ? STEP_PLUS : STEP_MINUS}</button>`;
    return `<div class="cs-vital"><div class="cs-k">${label}</div>
      <div class="cs-pill">${ctl ? btn(-1) : ""}<span><span class="cs-now${max !== undefined ? " of" : ""}" style="min-width: ${Math.max(2, String(max ?? "").length)}ch">${now}</span>${max !== undefined ? ` <span class="cs-of">/</span> ${max}` : ""}</span>${ctl ? btn(1) : ""}</div>
      <div class="cs-subs">${subs.map((x) => `<span>${x}</span>`).join("")}</div></div>`;
  }
  const field = (label, value) => value ? `<div class="cs-field"><span class="cs-k">${label}</span><b>${escH(value.toUpperCase())}</b></div>` : "";
  const sheetHead = (c) => `<div class="cs-card cs-head">
      <div class="cs-facebox">${portraitHtml(c.portrait, "cs-face") || `<span class="cs-noface">NO PHOTO</span>`}</div>
      <div>${field("CHARACTER NAME", c.name)}${field("PRONOUNS", c.pronouns)}${field("CLASS", c.className)}${field("ROLE", c.role)}</div>
    </div>`;
  const statusCard = (c) => `<div class="cs-card cs-status"><div class="cs-title">STATUS REPORT</div><div class="cs-vitals">
      ${pill("health", "HEALTH", c.health.current, c.health.max, ["CURRENT", "MAX"])}
      ${pill("wounds", "WOUNDS", c.wounds.current, c.wounds.max, ["CURRENT", "MAX"])}
      ${pill("stress", "STRESS", c.stress, undefined, ["CURRENT"])}
    </div></div>`;
  const numbersCard = (title, obj, hint = "") => `<div class="cs-card cs-${title.toLowerCase()}"><div class="cs-title">${title}</div>
      <div class="cs-nums">${Object.entries(obj).map(([k, v]) => circle(k, v)).join("")}</div>${hint}</div>`;
  const rollHint = () => (header.selfRolls && !spectate ? '<div class="cs-hint">TAP A STAT OR SAVE TO ROLL IT</div>' : "");

  function renderFile() {
    const c = mine();
    if (!c) { $("crewfile-body").innerHTML = '<div class="p-dim">NO CREW FILE SELECTED.</div>'; return; }
    $("crewfile-body").innerHTML = `<div class="cs cs-full">${sheetCards(c)}</div>`;
    fitChips($("crewfile-body"));
  }
  // A skill's bonus comes with it from the server ({ name, bonus }: crew.js).
  const skillBonus = (pc, name) => (name && pc.skills.find((s) => s.name.toLowerCase() === name.toLowerCase())?.bonus) || 0;
  // A document they hold, among their items: a file you can open.
  const FILE_ICON = '<svg class="cs-file" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>';
  // An audio log, among their items: a cassette.
  const TAPE_ICON = '<svg class="cs-file" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><circle cx="16" cy="11" r="2"/><path d="M8 13h8"/><path d="M6 19l2-3h8l2 3"/></svg>';
  const docChip = (d) => `<button type="button" class="cs-doc" data-doc="${escH(d.id)}" title="${d.audio ? "Play" : "Open"}">${d.audio ? TAPE_ICON : FILE_ICON}${chipText(d.title.toUpperCase())}</button>`;
  // A pill's text: one line; too long for the pill, it fades at the end and scrolls across on hover (fitChips).
  const chipText = (t) => `<span class="cs-cw"><span class="cs-ct">${escH(t)}</span></span>`;
  function fitChips(root) {
    requestAnimationFrame(() => {
      for (const cw of root.querySelectorAll(".cs-cw")) {
        const over = cw.firstElementChild.scrollWidth - cw.clientWidth;
        cw.classList.toggle("long", over > 1);
        if (over > 1) {
          cw.style.setProperty("--shift", `${-(over + 6)}px`);
          cw.style.setProperty("--dur", `${Math.max(2.5, (over + 6) / 28 + 1.5).toFixed(1)}s`);
        }
      }
    });
  }
  // Everything on their sheet, in cards (the full file and the side sheet alike).
  const sheetCards = (c) => `
      ${sheetHead(c)}
      ${statusCard(c)}
      ${numbersCard("STATS", c.stats, rollHint())}
      ${numbersCard("SAVES", c.saves)}
      <div class="cs-card cs-skills"><div class="cs-title">SKILLS</div>${c.skills.length ? `<div class="cs-list">${c.skills.map((s) => `<div><span>${escH(s.name)}</span><span class="cs-bonus">+${s.bonus}</span></div>`).join("")}</div>` : '<div class="cs-hint">NONE</div>'}</div>
      <div class="cs-card cs-items"><div class="cs-title">ITEMS</div>${c.items.length || docs.some((d) => d.to) ? `<div class="cs-chips">${c.items.map((x) => `<span>${chipText(x)}</span>`).join("")}${docs.filter((d) => d.to).map(docChip).join("")}</div>` : '<div class="cs-hint">NOTHING</div>'}</div>
      ${docs.some((d) => !d.to) ? `<div class="cs-card cs-shared"><div class="cs-title">SHARED</div><div class="cs-chips">${docs.filter((d) => !d.to).map(docChip).join("")}</div></div>` : ""}
      <div class="cs-card cs-story">
        ${c.crime ? `<div><span class="cs-k">CONVICTION</span> ${escH(c.crime)}</div>` : ""}
        ${c.backstory ? `<div class="p-text">${escH(c.backstory)}</div>` : ""}
        ${c.trinket ? `<div><span class="cs-k">TRINKET</span> ${escH(c.trinket)}</div>` : ""}
        ${c.patch ? `<div><span class="cs-k">PATCH</span> ${escH(c.patch)}</div>` : ""}
      </div>`;

  // ---- the sidebar: the player's sheet beside the terminal (when there's room).
  // Normally 30% of the row; widened (up to half) when the status report wouldn't fit in that.
  // If it wouldn't fit even in half, there's no sidebar: FILE opens the full sheet instead.
  let sideOpen = ls.get("side-open") !== "0";
  function sideNeed(c) {
    // (the status report at its narrowest, measured off-screen in the sidebar's type)
    const m = document.createElement("div");
    // (squeezed to nothing, its three columns each shrink to their own pill: what overflows is what it needs)
    m.style.cssText = "position: absolute; visibility: hidden; left: -9999px; top: 0; width: 0;";
    m.innerHTML = `<div class="cs cs-compact">${statusCard(c)}</div>`;
    document.body.append(m);
    const card = m.querySelector(".cs-card"), cs = getComputedStyle(card);
    const w = m.querySelector(".cs-vitals").scrollWidth + ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"].reduce((n, k) => n + parseFloat(cs[k]), 0);
    m.remove();
    const side = getComputedStyle($("side"));
    return Math.ceil(w + parseFloat(side.paddingLeft) + parseFloat(side.borderLeftWidth) + 2);
  }
  // The sidebar's width, or 0 if it doesn't fit.
  function sideWidth() {
    const c = mine();
    if (!c) return 0;
    const row = $("mainrow").clientWidth, need = sideNeed(c);
    if (need > row / 2) return 0;
    return Math.max(need, Math.min(row * 0.3, 440));
  }
  const wide = () => sideWidth() > 0;

  function renderSide() {
    const c = mine();
    docsButton();
    const side = $("side");
    const w = sideWidth();
    side.hidden = !c || !sideOpen || !w || spectate || !$("crewpick").hidden || !$("crewfile").hidden || !$("reveal").hidden; // (hidden while choosing a character, with the full sheet open, or a picture up)
    $("hdr-file").classList.toggle("on", !side.hidden);
    if (side.hidden) return;
    side.style.flexBasis = `${w}px`;
    // (the buttons stay at the bottom of the panel, whatever is scrolled above them)
    side.innerHTML = `<div class="cs cs-compact">${sheetCards(c)}</div>
      <div class="s-foot"><button type="button" class="p-btn" id="side-change">[ CHANGE CHARACTER ]</button> <button type="button" class="p-btn" id="side-hide">[ HIDE ]</button></div>`;
    fitChips(side);
  }
  addEventListener("resize", () => renderSide());
  $("side").addEventListener("click", (e) => {
    if (e.target.id === "side-change") toPicker(); // (the crew picker, as from the full file)
    if (e.target.id === "side-hide") setSide(false);
  });
  function setSide(open) {
    sideOpen = open;
    ls.set("side-open", open ? "1" : "0");
    renderSide();
    if (!spectate) input.focus();
  }

  function claim(id) {
    myId = id;
    ls.set(crewKey(), id || "none");
    send({ t: "claim", id });
    setCrew(crew, claims, played);
    if (curRoll) showRoll(curRoll); // (a roll may be waiting on this character)
    FX.Sound.beep(880, 0.06, 0.05);
  }

  // After (re)connecting: reclaim this device's file, or ask which one is theirs.
  function crewOnInit() {
    if (spectate || !crew.length) return;
    const saved = ls.get(crewKey());
    if (saved === "none") return claim(null);
    if (saved && crew.some((c) => c.id === saved)) return claim(saved);
    renderPicker();
    openPanel("crewpick");
  }

  // Picking a character shows their file to confirm: SELECT keeps it, BACK returns to the
  // picker. Opened from the header instead, it's CLOSE and CHANGE.
  let confirming = false;
  function showPicked(id) {
    claim(id);
    renderFile();
    openCrewfile(true);
  }
  function openCrewfile(picking) {
    confirming = picking;
    setLabel($("crewfile-close"), picking ? "[ BACK ]" : "[ CLOSE ]");
    setLabel($("crewfile-change"), picking ? "[ SELECT ]" : "[ CHANGE ]");
    openPanel("crewfile");
  }
  $("crewpick-list").addEventListener("click", (e) => {
    const id = e.target.closest("[data-id]")?.dataset.id;
    if (id) showPicked(id);
  });
  addEventListener("keydown", (e) => {
    if ($("crewpick").hidden || !bootEl.classList.contains("gone") || e.ctrlKey || e.metaKey || e.altKey) return; // (not the key that powers the terminal on)
    const c = crew[Number(e.key) - 1];
    if (c) { e.preventDefault(); showPicked(c.id); $("crewfile-change").focus(); }
  });
  $("crewpick-none").onclick = () => { claim(null); openPanel(null); };
  $("watchpick").onclick = () => toPicker();
  // ------------------------------------------------------------ markdown
  // Handouts are written in a little Markdown: # headings, **bold**, *italic*,
  // __underline__ (here, not bold), ~~struck out~~, `code`, - and 1. lists,
  // > quotes, --- dividers. Everything is escaped first, so no HTML gets through.
  function mdInline(s) {
    return s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/__(.+?)__/g, "<u>$1</u>")
      .replace(/~~(.+?)~~/g, "<s>$1</s>")
      .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, "$1<i>$2</i>")
      .replace(/(^|[^_\w])_(?!\s)(.+?)_(?!\w)/g, "$1<i>$2</i>");
  }
  function renderMd(text) {
    const out = [];
    let list = null; // "ul" | "ol" while inside one
    const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
    for (const raw of escH(text).split("\n")) {
      const line = raw.trimEnd();
      let m;
      if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { close(); out.push(`<div class="md-h md-h${m[1].length}">${mdInline(m[2])}</div>`); }
      else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { close(); out.push('<div class="md-hr"></div>'); }
      else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push(`<li>${mdInline(m[1])}</li>`); }
      else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push(`<li>${mdInline(m[1])}</li>`); }
      else if ((m = line.match(/^\s*&gt;\s?(.*)$/))) { close(); out.push(`<div class="md-q">${mdInline(m[1])}</div>`); }
      else if (!line.trim()) { close(); out.push('<div class="md-gap"></div>'); }
      else { close(); out.push(`<div>${mdInline(line)}</div>`); }
    }
    close();
    return out.join("");
  }

  // ------------------------------------------------------------ documents
  // Handouts: a new one opens on arrival, and they're kept with the player's items on
  // their sheet. Without a sheet (no character picked), DOCS in the header lists them.
  function docsButton() {
    // (On the stream page, every handout: open one to show it, or play an audio log for the viewers.)
    $("hdr-docs").hidden = $("hdr-docs-sep").hidden = !docs.length || (spectate && !stream) || !!mine();
    $("hdr-docs").textContent = docs.length ? `DOCS (${docs.length})` : "DOCS";
  }
  function setDocs(list) {
    docs = list || [];
    docsButton();
    renderSide();
    if (!$("crewfile").hidden) renderFile();
    if (!$("docs").hidden && $("docs-body").hidden) showDocList();
  }
  function gotDoc(h) {
    setDocs([...docs.filter((d) => d.id !== h.id), h]);
    if (spectate && !stream) return;
    FX.Sound.beep(880, 0.08);
    showDoc(h.id);
  }
  function showDocList() {
    $("docs-title").innerHTML = sq("DOCUMENTS");
    $("docs-list").hidden = false;
    $("docs-body").hidden = $("docs-back").hidden = true;
    stopLog();
    $("docs-list").innerHTML = docs.map((d, i) => `<li><button type="button" class="p-btn" data-doc="${escH(d.id)}">[${i + 1}] ${escH(d.title.toUpperCase())}</button>${d.audio ? ' <span class="p-dim">· AUDIO</span>' : ""}</li>`).join("") || '<li class="p-dim">NONE YET.</li>';
    openPanel("docs");
  }
  function showDoc(id) {
    const d = docs.find((x) => x.id === id);
    if (!d) return showDocList();
    $("docs-title").innerHTML = sq(escH(d.title.toUpperCase()));
    $("docs-list").hidden = true;
    $("docs-body").hidden = false;
    stopLog();
    $("docs-body").innerHTML = d.audio ? logHtml(d) : renderMd(d.text);
    $("docs-back").hidden = docs.length < 2;
    openPanel("docs");
  }

  // ---- audio logs: a handout with a voice. PLAY speaks it a line at a time, with the voice's
  // effects, lighting up each line of the transcript as it's said; STOP (or closing it) stops it.
  let log = null; // { clip } while one plays
  let logGen = 0;
  const logHtml = (d) => `<div class="alog" data-alog="${escH(d.id)}">
      <div class="alog-head"><span>VOICE: ${escH(d.audio.speaker.toUpperCase())}</span><span class="alog-state">READY</span></div>
      <div class="alog-ctl"><button type="button" class="p-btn" data-alog-play>[ PLAY ]</button> <button type="button" class="p-btn" data-alog-stop hidden>[ STOP ]</button></div>
      <div class="alog-lines">${d.audio.lines.map((l, i) => `<div class="alog-line" data-i="${i}">${l.who ? `<span class="alog-who">${escH(l.who)}:</span> ` : ""}${escH(l.text)}</div>`).join("")}</div>
    </div>`;
  function stopLog() {
    logGen++;
    log?.clip?.stop();
    log = null;
  }
  async function playLog(d) {
    stopLog();
    FX.Sound.unlock();
    const gen = logGen, box = $("docs-body").querySelector(".alog"), lines = [...box.querySelectorAll(".alog-line")];
    log = { clip: null };
    const state = (t) => { box.querySelector(".alog-state").textContent = t; };
    const buttons = (playing) => { box.querySelector("[data-alog-play]").hidden = playing; box.querySelector("[data-alog-stop]").hidden = !playing; };
    buttons(true);
    for (const l of lines) l.classList.remove("now", "said");
    const fetchPart = (i) => (i < lines.length ? Voice.load(`api/sessions/${code}/handouts/${encodeURIComponent(d.id)}/audio/${i}`) : null);
    let next = fetchPart(0);
    for (let i = 0; i < lines.length; i++) {
      state(`LOADING ${i + 1}/${lines.length}`);
      const buf = await next;
      if (gen !== logGen) return;
      next = fetchPart(i + 1); // (the next line loads while this one plays)
      lines[i].classList.add("now");
      lines[i].scrollIntoView({ block: "nearest" });
      state(`PLAYING ${i + 1}/${lines.length}`);
      if (buf) {
        log.clip = Voice.playClip(buf, d.audio.lines[i].fx); // (each speaker sounds their own way)
        if (!(await log.clip.done) || gen !== logGen) return;
      }
      lines[i].classList.replace("now", "said");
      await new Promise((r) => setTimeout(r, 350));
      if (gen !== logGen) return;
    }
    state("END OF RECORDING");
    buttons(false);
    log = null;
  }
  $("docs-body").addEventListener("click", (e) => {
    const box = e.target.closest(".alog");
    const d = box && docs.find((x) => x.id === box.dataset.alog);
    if (!d) return;
    if (e.target.closest("[data-alog-play]")) playLog(d);
    if (e.target.closest("[data-alog-stop]")) {
      stopLog();
      box.querySelector(".alog-state").textContent = "STOPPED";
      box.querySelector("[data-alog-play]").hidden = false;
      box.querySelector("[data-alog-stop]").hidden = true;
      for (const l of box.querySelectorAll(".alog-line.now")) l.classList.remove("now");
    }
  });
  $("hdr-docs").onclick = () => ($("docs").hidden ? showDocList() : openPanel(null));
  $("docs-list").addEventListener("click", (e) => { const id = e.target.closest("[data-doc]")?.dataset.doc; if (id) showDoc(id); });
  $("docs-close").onclick = () => openPanel(null);
  $("docs-back").onclick = showDocList;
  addEventListener("keydown", (e) => {
    if ($("docs").hidden) return;
    if (e.key === "Escape") return openPanel(null);
    if (!$("docs-list").hidden && /^[1-9]$/.test(e.key) && docs[Number(e.key) - 1]) { e.preventDefault(); showDoc(docs[Number(e.key) - 1].id); }
  });

  // ------------------------------------------------------------ clocks
  // Countdowns on the shared timeline (server time), under the header.
  let clocks = [];
  function setClocks(list) {
    clocks = list || [];
    renderClocks();
  }
  function renderClocks() {
    const el = $("clocks");
    el.hidden = !clocks.length;
    el.innerHTML = clocks.map((c) => {
      const s = c.paused ? c.left : Math.max(0, Math.ceil((c.ends - serverNow()) / 1000));
      return `<span class="clock${s <= 30 && !c.paused ? " low" : ""}${c.paused ? " paused" : ""}">${SQ} ${escH(c.label)} <b>${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}</b>${c.paused ? " HOLD" : ""}</span>`;
    }).join("");
  }
  setInterval(() => clocks.some((c) => !c.paused) && renderClocks(), 250);

  // ------------------------------------------------------------ no Warden
  // A game without a Warden. Whoever starts it is its pilot: the AI runs on
  // their key, and this screen keeps the session's token to prove it (PILOT:
  // the AI, the story, inviting others). Everyone sees the stories on offer;
  // the pilot picks one, the AI builds it and runs the whole game.
  const pilotKey = () => `pilot:${code}`;
  for (const b of document.querySelectorAll(".dlg-close")) b.onclick = () => b.closest("dialog").close();

  // Starting one, from the join screen.
  let providers = [];
  const providerList = async () => (providers.length ? providers : (providers = await fetch("api/providers").then((r) => (r.ok ? r.json() : [])).catch(() => [])));
  async function openSoloStart() {
    $("soloStart").showModal();
    const list = await providerList();
    // The free model first when the server offers one: nothing to set up.
    // This computer's own key first (a local run), then the free model, then the rest.
    const order = [...list.filter((p) => p.localKey), ...list.filter((p) => p.free), ...list.filter((p) => !p.free && !p.localKey)];
    $("ss-provider").innerHTML = order.map((p) => `<option value="${escH(p.id)}">${escH(p.label)}${p.free ? " · no key needed, slow" : p.localKey ? " · this computer's key" : ` · ${escH(p.models[0].label)}`}</option>`).join("");
    syncSoloStart();
  }
  function syncSoloStart() {
    const p = providers.find((x) => x.id === $("ss-provider").value);
    const free = !!p?.free || !!p?.localKey;
    $("ss-keyrow").hidden = $("ss-rememberrow").hidden = free;
    $("ss-keylink").href = p?.keyUrl || "#";
    $("ss-key").placeholder = p?.keyHint || "";
    const remembered = p && ls.get(`wardenKey:${p.id}`);
    $("ss-key").value = remembered || "";
    $("ss-remember").checked = !!remembered;
    $("ss-note").innerHTML = p?.localKey
      ? `Uses the ${escH(p.label)} key in your .env file. Nothing to paste.`
      : free
      ? "<b>Note:</b> the free model is shared and slow, writes thinner stories, and stops answering if its limit runs out. DeepSeek is much better, at a fraction of a cent per reply. Switch any time under PILOT."
      : "Your key is kept in server memory for this game only, never saved or shown. Your provider bills you for usage (a fraction of a cent per reply on cheap models).";
  }
  $("solo-start").onclick = openSoloStart;
  $("ss-provider").onchange = syncSoloStart;
  $("soloStartForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const provider = $("ss-provider").value;
    const chosen = providers.find((p) => p.id === provider);
    const free = !!chosen?.free || !!chosen?.localKey;
    const apiKey = free ? "" : $("ss-key").value.trim();
    $("ss-go").disabled = true;
    $("ss-err").textContent = "";
    try {
      const r = await fetch("api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, apiKey, solo: true }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Couldn't start a game (${r.status}).`);
      ls.set(`pilot:${data.code}`, data.token);
      if (!free && $("ss-remember").checked) ls.set(`wardenKey:${provider}`, apiKey);
      else if (!free) ls.del(`wardenKey:${provider}`);
      location.href = `?s=${data.code}`;
    } catch (err) {
      $("ss-err").textContent = err.message;
      $("ss-go").disabled = false;
    }
  });

  // Choosing the story (everyone sees it; the pilot picks).
  let solo = null, isPilot = false, pilot = null, pilotKeySent = false;
  function applySolo(x) {
    solo = x || null;
    if (solo?.phase === "ended") return showEnding();
    if (!$("ending").hidden) openPanel(null);
    if (!solo || solo.phase === "play") {
      if (!$("solopick").hidden) openPanel(null);
      return;
    }
    renderSolo();
    openPanel("solopick");
  }
  function renderSolo() {
    if (!solo) return;
    const building = solo.phase === "building";
    $("solopick-title").innerHTML = sq(building ? `BUILDING: ${escH(solo.title.toUpperCase())}` : "CHOOSE A STORY");
    $("solopick-note").textContent = building
      ? "THE AI IS BUILDING THE WORLD AND EVERYONE IN IT. THIS CAN TAKE A FEW MINUTES."
      : `NO WARDEN TONIGHT: THE AI RUNS THE GAME. ${isPilot ? "PICK A STORY (PRESS 1-9)." : "THE PILOT IS PICKING A STORY. TALK IT OVER."}`;
    $("solopick-list").innerHTML = building ? "" : solo.pitches.map((p, i) => {
      const name = `[${i + 1}] ${escH(p.title.toUpperCase())}`;
      return `<li>${isPilot ? `<button type="button" class="p-btn pick" data-pick="${i}">${name}</button>` : name}<span class="p-dim tags"> · ${escH(p.tags.toUpperCase())}</span>
        <div class="p-dim p-crime">${escH(p.hook)}</div></li>`;
    }).join("");
    $("solopick-status").innerHTML = solo.busy === "pitches" ? 'GENERATING STORIES<span class="dots"></span>'
      : building ? 'BUILDING<span class="dots"></span>' : escH(solo.error.toUpperCase());
    $("solopick-more").hidden = !isPilot || building;
    $("solopick-more").disabled = !!solo.busy;
  }
  // THE END: once the final scene has played out on this screen.
  let endingTimer = null;
  function showEnding() {
    clearTimeout(endingTimer);
    if (plays.size) { endingTimer = setTimeout(showEnding, 700); return; }
    const x = solo;
    $("ending-verdict").textContent = (x.recap?.verdict || "").toUpperCase();
    $("ending-how").textContent = x.ending ? x.ending.toUpperCase() : "";
    $("ending-recap").innerHTML = (x.recap?.sections || []).map((s) => `<div class="rc-h">${escH(s.heading.toUpperCase())}</div><div class="rc-t">${escH(s.text)}</div>`).join("");
    $("ending-status").innerHTML = x.busy === "recap" ? 'WRITING THE RECAP<span class="dots"></span>' : escH((x.error || "").toUpperCase());
    $("ending-again").hidden = !isPilot;
    if (!isPilot && x.busy !== "recap") $("ending-status").textContent = (x.error ? `${x.error} ` : "").toUpperCase() + "THE PILOT CAN START ANOTHER STORY.";
    openPanel("ending");
  }
  $("ending-again").onclick = () => ws?.send(JSON.stringify({ t: "pilotNewStory" }));

  const pickStory = (i) => solo?.phase === "pick" && !solo.busy && ws?.send(JSON.stringify({ t: "pilotBuild", i }));
  $("solopick-list").addEventListener("click", (e) => { const i = e.target.closest("[data-pick]")?.dataset.pick; if (i !== undefined) pickStory(Number(i)); });
  $("solopick-more").onclick = () => ws?.send(JSON.stringify({ t: "pilotPitches" }));
  addEventListener("keydown", (e) => {
    if ($("solopick").hidden || !isPilot || e.ctrlKey || e.metaKey || e.altKey || !/^[1-9]$/.test(e.key)) return;
    if (Number(e.key) <= (solo?.pitches.length || 0)) { e.preventDefault(); pickStory(Number(e.key) - 1); }
  });

  // The pilot's controls.
  function setPilot(info) {
    isPilot = true;
    pilot = info;
    $("hdr-pilot").hidden = $("hdr-pilot-sep").hidden = false;
    // After a server restart the key is gone: re-send a remembered one.
    const p = info.providers.find((x) => x.id === info.config.provider);
    const remembered = p && !p.configured && ls.get(`wardenKey:${p.id}`);
    if (remembered && !pilotKeySent) {
      pilotKeySent = true;
      ws.send(JSON.stringify({ t: "pilotKey", provider: p.id, key: remembered }));
    }
    renderSolo();
    if ($("pilotDlg").open) renderPilot();
  }
  const fill = (sel, opts, value) => { sel.innerHTML = opts.map(([v, l]) => `<option value="${escH(v)}">${escH(l)}</option>`).join(""); sel.value = value; };
  function renderPilot() {
    const { providers: list, config } = pilot;
    const p = list.find((x) => x.id === config.provider) || list[0];
    const m = p.models.find((x) => x.id === config.model) || p.models[0];
    $("pl-code").textContent = code;
    fill($("pl-provider"), list.map((x) => [x.id, `${x.label}${x.configured ? "" : " (no key)"}`]), p.id);
    fill($("pl-model"), p.models.map((x) => [x.id, x.label]), m.id);
    fill($("pl-effort"), m.efforts.map((e) => [e, e === "off" ? "off (fastest)" : e]), config.effort);
    $("pl-effortrow").hidden = !m.efforts.length;
    $("pl-keyrow").hidden = $("pl-keyactions").hidden = !!p.free;
    $("pl-key").placeholder = p.configured ? "•••••••• (paste to replace)" : p.keyHint;
    $("pl-keystatus").textContent = p.configured ? "A key is set for this game." : "No key yet. Add one so the AI can answer.";
  }
  $("hdr-pilot").onclick = () => { renderPilot(); $("pilotDlg").showModal(); };

  $("pl-provider").onchange = (e) => send({ t: "pilotConfig", patch: { provider: e.target.value } });
  $("pl-model").onchange = (e) => send({ t: "pilotConfig", patch: { model: e.target.value } });
  $("pl-effort").onchange = (e) => send({ t: "pilotConfig", patch: { effort: e.target.value } });
  $("pl-keysave").onclick = () => {
    const key = $("pl-key").value.trim();
    if (!key) return;
    send({ t: "pilotKey", provider: $("pl-provider").value, key });
    send({ t: "pilotConfig", patch: { provider: $("pl-provider").value } });
    $("pl-key").value = "";
  };
  $("pl-copy").onclick = async () => {
    const link = `${location.origin}${location.pathname}?s=${code}`;
    try { await navigator.clipboard.writeText(link); $("pl-copy").textContent = "Copied"; } catch { prompt("Copy this link:", link); }
    setTimeout(() => { $("pl-copy").textContent = "Copy link"; }, 1500);
  };
  $("pl-wrapup").onclick = () => {
    if (!confirm("Wrap up the story here? Everyone gets THE END and a recap.")) return;
    send({ t: "pilotWrapUp" });
    $("pilotDlg").close();
  };
  $("pl-newstory").onclick = () => {
    if (!confirm("Choose a new story? The current one ends for everyone.")) return;
    send({ t: "pilotNewStory" });
    $("pilotDlg").close();
  };
  $("pl-end").onclick = () => {
    if (!confirm("End the game for everyone?")) return;
    send({ t: "pilotEnd" });
    ls.del(pilotKey());
  };
  // While a dialog is open the terminal's own shortcuts stand down (as for the rules).
  addEventListener("keydown", (e) => { if ($("soloStart").open || $("pilotDlg").open) e.stopImmediatePropagation(); }, true);

  // A message from the system, not the story (e.g. the AI didn't answer).
  function notice(text) {
    const div = document.createElement("div");
    div.className = "line notice";
    div.textContent = `[ ${String(text).toUpperCase()} ]`;
    linesEl.append(div);
    scrollDown();
  }

  // The rules: a readable modal over the terminal (Esc or ✕ closes it).
  $("hdr-rules").onclick = () => $("rules").showModal();
  // FLICKER: less flicker, blinking and flashing on this screen (remembered on this device). Off
  // to start with for anyone whose system asks for reduced motion.
  let calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const savedCalm = ls.get("calm");
  if (savedCalm !== null) calm = savedCalm === "1";
  function applyCalm() {
    document.body.classList.toggle("calm", calm);
    $("hdr-calm").textContent = calm ? "FLICKER: OFF" : "FLICKER: ON";
    $("hdr-calm").setAttribute("aria-pressed", String(calm));
  }
  $("hdr-calm").onclick = () => {
    calm = !calm;
    ls.set("calm", calm ? "1" : "0");
    applyCalm();
    input.focus();
  };
  applyCalm();
  $("rules-close").onclick = () => $("rules").close();
  $("rules").addEventListener("click", (e) => { if (e.target === $("rules")) $("rules").close(); }); // (outside the sheet)
  // While it's open the terminal's own shortcuts (number keys, typing, Esc) stand down;
  // the dialog's own keys (Esc, Tab, Enter) still work.
  addEventListener("keydown", (e) => { if ($("rules").open) e.stopImmediatePropagation(); }, true);

  $("hdr-file").onclick = () => {
    // No crew file yet (FILE: NONE): straight to the crew picker (or close it again).
    if (!mine()) {
      if (!$("crewpick").hidden) return openPanel(null);
      return toPicker();
    }
    if (wide() && $("crewfile").hidden && $("crewpick").hidden) return setSide(!sideOpen);
    renderFile();
    if ($("crewfile").hidden) openCrewfile(false); else openPanel(null);
  };
  const toPicker = () => { renderPicker(); openPanel("crewpick"); focusPick(); };
  $("crewfile-close").onclick = () => (confirming ? toPicker() : openPanel(null));
  $("crewfile-change").onclick = () => (confirming ? openPanel(null) : toPicker());
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("panel-open") && !$("crewfile").hidden) openPanel(null);
  });

  // ---- terminals: where this screen is on the station, and how that terminal looks.
  const LOOK_FX = { blood: "blood", goo: "goo", crack: "crack" }; // drawn with the screen effects, left on
  const LOOK_NAMES = { blood: "BLOODY", goo: "SLIMED", crack: "CRACKED", flicker: "FLICKERING", dim: "DIM", grime: "GRIMY", portable: "HANDHELD" };
  let termId = null;
  const termKey = () => `term:${code}`;
  const terminals = () => header.terminals || [];
  const myTerm = () => terminals().find((t) => t.id === termId) || null;

  // After (re)connecting: go back to this device's terminal, or the first one open.
  function terminalOnInit() {
    if (spectate || !terminals().length) return applyTerminal();
    const saved = ls.get(termKey());
    // (Only one they can reach now: a new story or a sealed door may have moved them.)
    const t = terminals().find((x) => x.id === (termId || saved) && x.open) || terminals().find((x) => x.open);
    if (t) setTerminal(t.id, true);
  }
  function setTerminal(id, tell) {
    termId = id;
    ls.set(termKey(), id);
    if (tell) send({ t: "terminal", id });
    applyTerminal();
  }

  // The system this screen is on: the station's, or a separate one (the crew's tug)
  // with its own name and OS. The station's access level means nothing there.
  const sysTerm = () => (spectate ? null : myTerm()?.system ? myTerm() : null);
  const sysName = () => sysTerm()?.system || header.stationName;
  const accessText = () => (sysTerm() ? "CREW" : header.accessLevel);
  const promptText = () => `${accessText()}@${sysName()}>`;
  function applyNames() {
    $("hdr-station").textContent = sysName();
    $("hdr-access").textContent = accessText();
    $("hdr-os").textContent = sysTerm()?.os || `${header.voices?.terminal?.name || "TERMINAL"} OS v4.1`;
    promptEl.textContent = promptText();
  }

  // Theme, screen styles (flicker, dim, grime, handheld) and permanent blood/goo/crack.
  let decor = "";
  function applyTerminal() {
    applyNames();
    const t = spectate ? null : myTerm();
    for (const cls of [...document.body.classList]) if (cls.startsWith("theme-") || cls.startsWith("look-")) document.body.classList.remove(cls);
    document.body.classList.add(`theme-${t?.theme || header.theme || "green"}`);
    for (const l of t?.look || []) if (!LOOK_FX[l]) document.body.classList.add(`look-${l}`);
    const want = (t?.look || []).filter((l) => LOOK_FX[l]);
    const key = `${t?.id}|${want.join(",")}`;
    if (key !== decor) {
      decor = key;
      for (const l of Object.keys(LOOK_FX)) FX.end(`decor-${l}`);
      for (const l of want) FX.start({ id: `decor-${l}`, type: LOOK_FX[l], text: "", intensity: 2, seconds: 0, quiet: true });
    }
    const btn = $("hdr-term");
    btn.hidden = $("hdr-term-sep").hidden = spectate || !terminals().length;
    btn.textContent = t ? `TERM: ${t.name.replace(/\s*TERMINAL$/i, "")}` : "TERM: ----";
    if (!$("termpick").hidden) renderTermPick();
  }

  function renderTermPick() {
    const can = header.moveTerminals !== false;
    $("termpick-note").textContent = can ? "SELECT A TERMINAL (PRESS 1-9)." : "MOVEMENT RESTRICTED. ASK THE WARDEN.";
    $("termpick-list").innerHTML = terminals().map((t, i) => {
      const here = t.id === termId;
      const ok = can && t.open && !here;
      const looks = t.look.map((l) => LOOK_NAMES[l]).filter(Boolean).join(" · ");
      return `<li>${ok ? `<button type="button" class="p-btn" data-term="${escH(t.id)}">[${i + 1}] ${escH(t.name)}</button>` : `<span class="${here ? "" : "p-dim"}">[${i + 1}] ${escH(t.name)}</span>`}
        <span class="p-dim">${here ? " · <b>YOU ARE HERE</b>" : t.open ? "" : " · NO ACCESS"}${looks ? ` · ${looks}` : ""}</span></li>`;
    }).join("");
  }
  $("hdr-term").onclick = () => {
    if (!$("termpick").hidden) return openPanel(null);
    renderTermPick();
    openPanel("termpick");
    $("termpick-list").querySelector("button")?.focus();
  };
  $("termpick-close").onclick = () => openPanel(null);
  function pickTerm(id) {
    const t = terminals().find((x) => x.id === id);
    if (!t || !t.open || header.moveTerminals === false) return;
    setTerminal(id, true);
    openPanel(null);
    // Walking up to a different screen: a short power-on.
    const crtEl = $("crt");
    crtEl.classList.remove("power-on");
    void crtEl.offsetWidth;
    crtEl.classList.add("power-on");
    FX.Sound.beep(1200, 0.05);
  }
  $("termpick-list").addEventListener("click", (e) => { const id = e.target.closest("[data-term]")?.dataset.term; if (id) pickTerm(id); });
  addEventListener("keydown", (e) => {
    if ($("termpick").hidden || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") return openPanel(null);
    const t = terminals()[Number(e.key) - 1];
    if (t) { e.preventDefault(); pickTerm(t.id); }
  });

  // ---- rolling your own Stat/Save: pick a relevant skill (optional; it adds its bonus), then roll.
  // Edge: its own sign in the pip ([+] / [-]); chosen, it's cut out of the square (pip).
  const ADV = [["none", "NORMAL", ""], ["advantage", "ADVANTAGE", "+"], ["disadvantage", "DISADVANTAGE", "-"]];
  let sr = null; // { check, skill, adv }

  function openSelfRoll(check) {
    if (!mine() || !header.selfRolls) return;
    sr = { check, skill: "", adv: "none" };
    $("sr-dice").value = "";
    $("sr-err").textContent = "";
    renderSelfRoll();
    openPanel("selfroll");
    $("sr-skills").querySelector("button")?.focus();
  }
  function renderSelfRoll() {
    const c = mine();
    if (!c || !sr) return;
    const base = c.stats[sr.check] ?? c.saves[sr.check];
    const bonus = skillBonus(c, sr.skill);
    // A chosen pip is a drawn square (one character wide), its sign (if any) cut out of it:
    // drawn, not the ■ character, so every pip is exactly the same size.
    const pip = (sign = "") => `<svg class="sr-pip" viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10"/>${sign ? `<path d="M2.5 5h5${sign === "+" ? "M5 2.5v5" : ""}"/>` : ""}</svg>`;
    const pick = (on, attrs, label) => `<button type="button" class="p-btn${on ? " on" : ""}" ${attrs}>[${on ? pip() : " "}] ${escH(label)}</button>`;
    $("sr-title").innerHTML = sq(`ROLL: ${escH(sr.check.toUpperCase())} (${base})`);
    $("sr-skills").innerHTML = [pick(!sr.skill, 'data-skill=""', "NONE"), ...c.skills.map((s) => pick(sr.skill === s.name, `data-skill="${escH(s.name)}"`, `${s.name.toUpperCase()} +${s.bonus}`))].join(" ");
    $("sr-adv").innerHTML = ADV.map(([id, label, sign]) => {
      if (!sign) return pick(sr.adv === id, `data-adv="${id}"`, label);
      const on = sr.adv === id;
      return `<button type="button" class="p-btn${on ? " on" : ""}" data-adv="${id}">[${on ? pip(sign) : sign}] ${label}</button>`;
    }).join(" ");
    $("sr-target").textContent = `ROLL UNDER ${base + bonus} ON D100${sr.adv === "none" ? "" : " (ROLL TWICE)"}.`;
    $("sr-dice").placeholder = sr.adv === "none" ? "47" : "47 82";
  }
  $("selfroll").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !sr) return;
    if (b.dataset.skill !== undefined) sr.skill = b.dataset.skill;
    else if (b.dataset.adv) sr.adv = b.dataset.adv;
    else return;
    renderSelfRoll();
    $("selfroll").querySelector(`[data-${b.dataset.skill !== undefined ? "skill" : "adv"}="${CSS.escape(b.dataset.skill ?? b.dataset.adv)}"]`)?.focus();
  });
  // Dice typed in by hand: every number in it.
  const readDice = (text) => text.split(/[^0-9]+/).filter(Boolean).map(Number);
  function sendSelfRoll(manual) {
    if (!sr) return;
    const msg = { t: "selfRoll", check: sr.check, skill: sr.skill, advantage: sr.adv };
    if (manual) {
      const dice = readDice($("sr-dice").value);
      const need = sr.adv === "none" ? 1 : 2;
      if (dice.length !== need || dice.some((d) => d > 99)) {
        $("sr-err").textContent = need === 1 ? "ENTER ONE D100 ROLL (00-99)." : "ENTER BOTH D100 ROLLS, E.G. 47 82.";
        return $("sr-dice").focus();
      }
      Object.assign(msg, { manual: true, dice });
    }
    send(msg);
    sr = null;
    openPanel(null);
  }
  $("sr-form").addEventListener("submit", (e) => { e.preventDefault(); sendSelfRoll($("sr-dice").value.trim() !== ""); });
  $("sr-enter").onclick = () => sendSelfRoll(true);
  $("sr-cancel").onclick = () => { sr = null; openPanel(null); };
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("selfroll").hidden) { sr = null; openPanel(null); } });

  // ------------------------------------------------------------ ability rolls
  // The Warden calls for a roll from one character or all of them. Each rolls
  // on their own screen against their own sheet (here, or typing their dice);
  // everyone else sees who is still rolling.
  const rollbox = $("rollbox"), rbDice = $("rb-dice"), rbErr = $("rb-err");
  let curRoll = null, alerted = "";

  // What this character rolls against, from their own sheet.
  function rollTargetText(roll, pc) {
    if (roll.panic) return `YOUR STRESS: ${pc.stress} · ROLL ABOVE IT ON A D20 TO KEEP YOUR COOL`;
    const stat = pc.stats[roll.check] ?? pc.saves[roll.check];
    const bonus = skillBonus(pc, roll.skillName);
    return `YOUR ${roll.check.toUpperCase()}: ${stat}${bonus ? ` + ${roll.skillName.toUpperCase()} ${bonus}` : ""} · ROLL UNDER ${stat + bonus}`;
  }

  function showRoll(roll) {
    curRoll = roll;
    rollbox.hidden = !roll;
    if (!roll) { if (!spectate) input.focus(); return; }
    const own = mine();
    const mustRoll = !spectate && !!own && roll.pcs.some((p) => p.id === own.id && !p.done);
    const waiting = roll.pcs.filter((p) => !p.done).map((p) => p.name.toUpperCase());
    $("rb-title").innerHTML = sq(mustRoll ? "ROLL REQUIRED" : "ROLL IN PROGRESS");
    $("rb-label").textContent = [roll.label, roll.skill].filter(Boolean).join(" · ");
    $("rb-reason").textContent = roll.reason ? roll.reason.toUpperCase() : "";
    $("rb-stakes").hidden = !roll.stakes;
    $("rb-stakes").textContent = roll.stakes ? [roll.stakes.success && `IF IT WORKS: ${roll.stakes.success}`, roll.stakes.failure && `IF IT FAILS: ${roll.stakes.failure}`].filter(Boolean).join("\n").toUpperCase() : "";
    $("rb-wait").textContent = waiting.length ? `WAITING ON: ${waiting.join(", ")}` : "";
    $("rb-form").hidden = !mustRoll;
    if (!mustRoll) return;
    $("rb-target").textContent = rollTargetText(roll, own);
    $("rb-roll").textContent = roll.panic ? "[ ROLL D20 ]" : "[ ROLL D100 ]";
    rbDice.placeholder = roll.panic ? (roll.advantage === "none" ? "14" : "14 6") : (roll.advantage === "none" ? "47" : "47 82");
    // A new roll for this character: clear the box, call them to it.
    if (alerted === `${roll.id}:${own.id}`) return;
    alerted = `${roll.id}:${own.id}`;
    rbDice.value = "";
    rbErr.textContent = "";
    if (!$("crewfile").hidden || !$("crewpick").hidden) openPanel(null);
    FX.Sound.beep(660, 0.12, 0.07);
    setTimeout(() => FX.Sound.beep(880, 0.16, 0.07), 140);
    scrollDown();
    $("rb-roll").focus();
  }

  function sendRoll(manual) {
    if (!curRoll) return;
    const msg = { t: "roll", id: curRoll.id };
    if (manual) {
      const dice = readDice(rbDice.value);
      const need = curRoll.advantage === "none" ? 1 : 2;
      const [lo, hi, die, eg] = curRoll.panic ? [1, 20, "D20", "14 6"] : [0, 99, "D100", "47 82"];
      if (dice.length !== need || dice.some((d) => d < lo || d > hi)) {
        rbErr.textContent = need === 1 ? `ENTER ONE ${die} ROLL (${curRoll.panic ? "1-20" : "00-99"}).` : `ENTER BOTH ${die} ROLLS, E.G. ${eg}.`;
        return rbDice.focus();
      }
      Object.assign(msg, { manual: true, dice });
    }
    rbErr.textContent = "ROLLING...";
    send(msg);
  }

  $("rb-form").addEventListener("submit", (e) => { e.preventDefault(); sendRoll(rbDice.value.trim() !== ""); });
  $("rb-enter").addEventListener("click", () => sendRoll(true));
  rbDice.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendRoll(true); } });

  // Big dice tumble, then the verdict. When everyone rolls, results play one after another.
  const rollQueue = [];
  function showRollResult(msg) {
    rollQueue.push(msg);
    if (rollQueue.length === 1) playRollResult();
  }

  function playRollResult() {
    const { result, label, who, effect } = rollQueue[0];
    const fx = $("rollfx"), diceEl = fx.querySelector(".rf-dice"), outEl = fx.querySelector(".rf-out");
    const show = result.panic ? String : (d) => String(d).padStart(2, "0");
    const random = () => (result.panic ? 1 + Math.floor(Math.random() * 20) : Math.floor(Math.random() * 100));
    const name = who ? `${who.toUpperCase()}: ` : "";
    fx.className = "rollfx";
    fx.hidden = false;
    outEl.textContent = name + label;
    let n = 0;
    const tumble = setInterval(() => {
      diceEl.textContent = result.dice.map(() => show(random())).join(" ");
      if (n++ % 2 === 0) FX.Sound.tick();
    }, 60);
    setTimeout(() => {
      clearInterval(tumble);
      diceEl.textContent = result.dice.length > 1 ? `${result.dice.map(show).join(" / ")} → ${show(result.used)}` : show(result.used);
      outEl.textContent = name + (result.panic
        ? (result.success ? `KEPT THEIR COOL (ABOVE STRESS ${result.target})` : `PANIC! (STRESS ${result.target}) · ${effect ? effect.toUpperCase() : `PANIC TABLE ${result.used}`}`)
        : `${result.outcome.toUpperCase()} (UNDER ${result.target})${result.success ? "" : " · +1 STRESS"}`);
      fx.classList.add(result.success ? "pass" : "fail");
      if (result.critical) fx.classList.add("crit");
      if (result.success) { FX.Sound.beep(880, 0.12, 0.08); setTimeout(() => FX.Sound.beep(1320, 0.2, 0.08), 120); }
      else { FX.Sound.beep(220, 0.3, 0.1); setTimeout(() => FX.Sound.beep(160, 0.4, 0.1), 260); }
    }, 1300);
    // The next result (if any) follows sooner, so a whole crew's rolls don't drag.
    setTimeout(() => {
      rollQueue.shift();
      if (rollQueue.length) playRollResult();
      else fx.hidden = true;
    }, rollQueue.length > 1 ? 3400 : 5200);
  }

  // ------------------------------------------------------------ room layouts
  // The Warden shows a room's floor plan: walls, doors and furniture, as a
  // blueprint on this screen (never who or what is in it). Esc or a click closes it.
  function showPlan({ name, rows }) {
    const fx = $("planfx");
    fx.hidden = !rows;
    if (!rows) return;
    fx.querySelector(".pf-title").textContent = `LAYOUT: ${String(name || "").toUpperCase()}`;
    fx.querySelector(".pf-plan").innerHTML = RoomPlan.svg(rows, { cell: 24, title: name });
    chirp();
  }
  // Two rising beeps: something's come up on the screen.
  function chirp() { FX.Sound.beep(520, 0.08, 0.05); setTimeout(() => FX.Sound.beep(780, 0.1, 0.05), 90); }
  // An adversary's picture (the agent's reveal, as its line begins; or the Warden's Show):
  // in the panel beside the terminal, tinted to the screen's colour, so the dialogue
  // stays in view. Closes with a click, Esc or [ CLOSE ].
  function showImage({ title, name, src, credit = "" }) {
    if (!src) return FX.Sound.sting(); // (revealed, but no picture: just the sting)
    const box = $("reveal");
    const rvTitle = box.querySelector(".rv-title"), t = String(title || name || "").toUpperCase();
    setLabel(rvTitle, t);
    // (a credit's link stays clickable: everything else in it is text)
    const link = (t) => escH(t).replace(/(https?:\/\/[^\s<]+|[\w-]+(?:\.[\w-]+)+\/[^\s<]*)/g, (u) => `<a href="${u.startsWith("http") ? u : `https://${u}`}" target="_blank" rel="noopener">${u}</a>`);
    box.querySelector(".rv-pic").innerHTML = `<img src="${escH(src)}" alt="" referrerpolicy="no-referrer">`;
    box.querySelector(".rv-credit").innerHTML = credit ? link(credit) : "";
    box.hidden = false;
    renderSide(); // (the character sheet steps aside while it's up)
    FX.Sound.sting(); // (a horror sting: it's been seen)
  }
  function closeReveal() {
    if ($("reveal").hidden) return;
    $("reveal").hidden = true;
    renderSide();
  }
  $("reveal").addEventListener("click", (e) => { if (!e.target.closest("a")) closeReveal(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeReveal(); });
  $("planfx").addEventListener("click", () => { $("planfx").hidden = true; });

  // ---- the station map, while the Warden shows it: the view they picked (2D, or 3D:
  // isomap.js, loaded when first needed). Never who of the cast is where (the server leaves that out).
  // It opens when the Warden shows it; closed here, it stays closed until they show it again.
  let isoOn = false, isoView = null, isoData = null, isoLib = null;
  function setIso(map) {
    const box = $("isofx"), body = box.querySelector(".if-map");
    if (!map) { isoOn = false; return closeIso(); }
    isoData = { ...map, editable: false, people: peopleNames(map.people || {}) };
    if (!isoOn) {
      isoOn = true;
      box.hidden = false;
      chirp();
    }
    if (box.hidden) return;
    body.classList.toggle("iso", map.view === "iso");
    box.querySelector(".if-close").textContent = map.view === "iso" ? "[ DRAG TO TURN · ESC TO CLOSE ]" : "[ ESC TO CLOSE ]";
    if (map.view !== "iso") {
      if (isoView) { isoView.dispose(); isoView = null; }
      body.innerHTML = '<div class="smap"></div>';
      StationMap.draw(body.firstChild, isoData.station, isoData.layout, { editable: false, people: isoData.people });
      return;
    }
    if (isoView) return isoView.update(isoData);
    body.innerHTML = "";
    (isoLib ||= import("./isomap.js")).then((lib) => { if (!box.hidden && !isoView && isoData.view === "iso") isoView = lib.mount(body, isoData, { labelPx: 18 }); })
      .catch(() => { body.textContent = "MAP DATA UNAVAILABLE."; });
  }
  function closeIso() {
    $("isofx").hidden = true;
    isoView?.dispose();
    isoView = null;
    $("isofx").querySelector(".if-map").innerHTML = "";
  }
  $("isofx").querySelector(".if-close").onclick = closeIso;
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("isofx").hidden) closeIso(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("planfx").hidden) $("planfx").hidden = true; });

  // ------------------------------------------------------------ socket
  // The socket lives next to this page (works under any mount point, e.g. /mothership/).
  function socketUrl() {
    const u = new URL(`ws?s=${encodeURIComponent(code)}`, location.href);
    u.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    if (stream) { u.searchParams.set("stream", "1"); return u; } // (no terminal: it sees them all)
    // Where this screen was, so the server starts it on that system's log.
    const term = termId || ls.get(termKey());
    if (term) u.searchParams.set("term", term);
    return u;
  }

  // The server was updated while this page was open: load the new code (the
  // old script can't follow the new server, e.g. effect timing).
  let version = null;
  function newCode(v) {
    if (version && v && v !== version) { location.reload(); return true; }
    version = v || version;
    return false;
  }

  function connect() {
    if (!code) return;
    Sfx.setUrl((id) => `api/sessions/${code}/sounds/${id}`);
    ws = new WebSocket(socketUrl());
    ws.onopen = () => {
      $("hdr-link").classList.remove("down");
      if (stream) ws.send(JSON.stringify({ t: "auth", token: streamKey }));
      const token = ls.get(pilotKey());
      if (token) ws.send(JSON.stringify({ t: "pilot", token }));
      // Sync this screen's clock with the server's (a few tries; the quickest wins).
      bestRtt = Infinity;
      for (let i = 0; i < 4; i++) setTimeout(ping, i * 250);
    };
    ws.onclose = (ev) => {
      $("hdr-link").classList.add("down");
      if (stream && ev.code === 4003) { // (an old link: the console has the current one)
        bootEl.classList.remove("gone");
        bootText.textContent = "STREAM LINK NOT RECOGNISED.\nCOPY IT AGAIN FROM THE WARDEN CONSOLE: SETTINGS > SESSION.\n";
        return;
      }
      if (ev.code === 4004) {
        // The session ended (or expired): back to the code prompt.
        if (spectate) return;
        bootEl.classList.remove("gone");
        showCredit();
        bootText.textContent = "SESSION TERMINATED.\n\n";
        return askForCode();
      }
      setTimeout(connect, ev.code === 4029 ? 10000 : 1500);
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      switch (msg.t) {
        case "init":
          if (newCode(msg.version)) return;
          applyHeader(msg.header);
          lineGen++;
          plays.clear();
          Voice.stop();
          linesEl.innerHTML = "";
          lastWhere = "";
          cueState.clear();
          heldCues.clear();
          // Our crew file first: lines can read differently for it.
          if (msg.map) stationMap = msg.map;
          setTimeout(() => setIso(msg.iso || null)); // (after the crew: it names them)
          setCrew(msg.crew, msg.claims, msg.played);
          if (mine()) ws.send(JSON.stringify({ t: "claim", id: myId }));
          // Past lines appear at once; any still playing join the schedule in step.
          for (const e of msg.log) {
            if (e.timing && e.kind !== "player" && (e.timing.end ?? Infinity) > serverNow()) enqueue(e);
            else renderInstant(e);
          }
          // Timed cues were played when they happened; don't replay them on reload.
          FX.sync(msg.effects.filter((e) => !(e.atEntry && e.seconds > 0)));
          Sfx.sync(msg.playing || []); // loops (ambience, a growl) that are running
          busy = msg.busy;
          updateBusy();
          showRoll(msg.roll || null);
          setClocks(msg.clocks);
          setDocs(msg.handouts);
          // A game without a Warden: the stories on offer until one is playing.
          applySolo(msg.solo);
          // First visit, or a new story replaced the crew: reclaim a remembered file or pick one.
          if (!mine() && (!msg.solo || msg.solo.phase === "play")) crewOnInit();
          terminalOnInit();
          scrollDown();
          break;
        case "solo": applySolo(msg.solo); break;
        case "clocks": setClocks(msg.clocks); break;
        case "handout": gotDoc(msg.handout); break;
        case "handouts": setDocs(msg.handouts); break;
        case "handoutGone": setDocs(docs.filter((d) => d.id !== msg.id)); break;
        case "pilotInfo": setPilot(msg); break;
        case "notice": notice(msg.text); break;
        case "header":
          if (header.tts && !msg.header.tts) Voice.stop();
          applyHeader(msg.header);
          break;
        case "line": enqueue(msg.entry); break;
        case "part": onPart(msg); break;
        case "interrupt": onInterrupt(msg); break;
        case "terminalSet": setTerminal(msg.id, false); break; // the Warden moved us
        case "lineEnd": onLineEnd(msg); break;
        case "pong": onPong(msg); break;
        case "busy": busy = msg.busy; updateBusy(); break;
        case "effect": onEffect(msg.effect); break;
        case "roll": showRoll(msg.roll); break;
        case "crew": setCrew(msg.crew, msg.claims, msg.played); break;
        case "wardenLog": onWardenLog(msg); break;
        case "streamMap": stationMap = msg.map; renderCastbar(); break;
        case "isoMap": setIso(msg.map); break;
        case "rollResult": showRollResult(msg); break;
        case "roomPlan": showPlan(msg); break;
        case "showImage": showImage(msg); break;
        case "rollError": rbErr.textContent = String(msg.text || "").toUpperCase(); $("sr-err").textContent = rbErr.textContent; break;
        case "endEffect": dropCue(msg.id); FX.end(msg.id); break;
        case "sound": Sfx.play(msg.play); break;
        case "soundStop": msg.all ? Sfx.stopAll() : Sfx.stop(msg.pid); break;
        case "soundVolume": Sfx.setVolume(msg.pid, msg.volume); break;
      }
    };
  }
  if (spectate) connect(); // (the stream page too)
})();
