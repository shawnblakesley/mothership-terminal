(() => {
  const params = new URLSearchParams(location.search);
  const stream = /\/stream$/.test(location.pathname);
  const streamKey = new URLSearchParams(location.hash.slice(1)).get("key") || "";
  const spectate = params.has("spectate") || stream;
  const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  let code = normCode(params.get("s"));

  const $ = (id) => document.getElementById(id);
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

  const bootEl = $("boot");
  const bootText = $("boot-text"), joinForm = $("join"), joinInput = $("join-code"), joinErr = $("join-err");
  const printBoot = (lines, delay = 260) => new Promise((resolve) => {
    let i = 0;
    const iv = setInterval(() => {
      if (i >= lines.length) { clearInterval(iv); return resolve(); }
      bootText.textContent += lines[i++] + "\n";
    }, delay);
  });

  function showCredit() {
    $("credit").hidden = bootEl.classList.contains("gone") || header.portraitCredit === false;
  }

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
      window.history.replaceState(null, "", `?s=${code}`);
      joinForm.hidden = true;
      await printBoot([`STATION LINK ........... ${info.stationName}`, ""], 120);
      powerOn();
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
    const fxBottom = () => document.body.style.setProperty("--fx-bottom", `${Math.max(0, innerHeight - $("crt").offsetTop - $("castbar").offsetTop)}px`);
    new ResizeObserver(fxBottom).observe($("castbar"));
    addEventListener("resize", fxBottom);
    fxBottom();
    powerOn();
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

  function applyHeader(h) {
    header = h;
    renderShip();
    showCredit();
    applyTerminal();
    renderSide();
    if (!$("crewfile").hidden) renderFile();
    for (const el of linesEl.querySelectorAll(".line.player")) el.dataset.prompt = el.dataset.prompt || "";
    placeCaret();
  }
  setInterval(() => { $("hdr-clock").textContent = new Date().toTimeString().slice(0, 8); }, 1000);

  let clockOffset = 0;
  let bestRtt = Infinity;
  const serverNow = () => Date.now() + clockOffset;
  const untilServer = (t) => Math.max(0, t - serverNow());
  function ping() { send({ t: "ping", c: Date.now() }); }
  function onPong({ c, s }) {
    const rtt = Date.now() - c;
    if (rtt > bestRtt * 1.5 + 20) return;
    bestRtt = Math.min(bestRtt, rtt);
    clockOffset = s + rtt / 2 - Date.now();
  }
  setInterval(ping, 30_000);

  function voiceOf(entry) {
    const id = entry.entity || (entry.kind === "system" ? "broadcast" : "terminal");
    return header.voices?.[id];
  }

  try {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    const g = cv.getContext("2d"), px = g.createImageData(64, 64);
    for (let i = 0; i < px.data.length; i += 4) { const n = Math.random() * 255; px.data.set([n, n, n, Math.random() < 0.55 ? 255 : 0], i); }
    g.putImageData(px, 0, 0);
    document.documentElement.style.setProperty("--noise", `url(${cv.toDataURL()})`);
  } catch { }

  function makeLine(entry) {
    const div = document.createElement("div");
    div.className = `line ${entry.kind}`;
    div.dataset.id = entry.id;
    if (entry.kind === "player") {
      if (stream) whereTag(entry);
      div.dataset.prompt = stream ? `${entry.by ? shortName({ name: entry.by }) : "CREW"}@${sysOf(entry.net) || header.stationName}> ` : `${promptText()} `;
      return div;
    }
    if (META[entry.kind]) {
      div.classList.add("meta", "style-label");
      div.dataset.kind = entry.kind;
      div.dataset.label = entry.kind === "note" ? "> " : `${META[entry.kind](entry)}: `;
      return div;
    }
    if (entry.kind === "roll") {
      div.classList.add("roll");
      if (entry.by && entry.by !== mine()?.name) {
        div.classList.add("others");
        const o = String(entry.outcome || "");
        if (o) div.classList.add(/success|cool/.test(o) ? "ok" : "bad");
      }
      return div;
    }
    const v = voiceOf(entry);
    div.classList.add(`style-${entry.inPerson ? "label" : v?.style || (entry.kind === "system" ? "boxed" : "plain")}`);
    let label = entry.inPerson && entry.character ? `${entry.character.toUpperCase()}: `
      : v?.style === "label" ? `${entry.shownAs || v.name}${entry.character ? ` · ${entry.character.toUpperCase()}` : ""}: ` : "";
    const where = stream && v?.style !== "narration" && whereTag(entry);
    if (where) { label = `[${where}] ${label}`; div.classList.add("style-label"); }
    if (label) div.dataset.label = label;
    const portrait = entry.character && header.portraits?.[entry.character.toLowerCase()];
    if (portrait) withPortrait(div, portrait, { comms: !entry.inPerson, label });
    if (v?.color && !entry.inPerson) {
      div.style.color = v.color;
      div.style.borderColor = v.color;
      div.style.textShadow = `0 0 2px ${v.color}88, 0 0 9px ${v.color}66`;
    }
    return div;
  }

  const portraitSrc = (file) => (file.startsWith("kit/") ? `portraits/${file.slice(4)}` : `api/sessions/${code}/portraits/${file}`);
  const portraitHtml = (file, cls = "") => (file ? `<span class="portrait ${cls}" style="--src: url('${escH(portraitSrc(file))}')"><span class="ink"></span><img src="${escH(portraitSrc(file))}" alt="" hidden onerror="this.parentNode.remove()"></span>` : "");
  function withPortrait(div, file, { comms = false, label = "" } = {}) {
    div.classList.add("has-portrait");
    const pic = document.createElement("span");
    pic.className = `portrait${comms ? " comms" : ""}`;
    pic.style.setProperty("--src", `url('${portraitSrc(file)}')`);
    const ink = document.createElement("span");
    ink.className = "ink";
    const probe = new Image();
    probe.onerror = () => pic.remove();
    probe.src = portraitSrc(file);
    pic.append(ink);
    const text = document.createElement("span");
    text.className = "lt";
    if (label) text.dataset.label = label;
    div.append(pic, text);
  }

  const textOf = (div) => div.querySelector(".lt") || div;

  const netKey = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const sysOf = (net) => (!net ? "" : net === "*" ? "ALL SYSTEMS" : terminals().find((t) => t.system && netKey(t.system) === net)?.system || "");
  let lastWhere = "";
  function whereTag(entry) {
    const name = sysOf(entry.net) || header.stationName;
    if (name === lastWhere) return "";
    lastWhere = name;
    return name;
  }
  const META = {
    note: () => "LOG",
    warden: () => "WARDEN > CORE",
    aside: () => "WARDEN NOTE",
    aside_reply: () => "CORE > WARDEN",
    heard: () => "WARDEN (VOICE)",
    table: (e) => `COMMS · ${e.playing ? `${e.playing} (${e.speaker || "CREW"})` : e.speaker || "CREW"}`.toUpperCase(),
  };
  function metaText(e) {
    const fx = /^Agent triggered effect: (.*?)(?: (before|after) line #\d+)?$/.exec(e.text || "");
    if (fx) return `EFFECT: ${fx[1]}${fx[2] === "after" ? " (AFTER THE LINE)" : ""}`;
    return String(e.text || "").replace(/^[\u2696\u26A1]\uFE0F?\s*/u, "");
  }
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

  function forMe(entry) {
    if (stream) {
      if (META[entry.kind]) return { ...entry, text: metaText(entry) };
      return entry.text || entry.variants?.length || entry.kind === "player" ? entry : null;
    }
    const vi = (entry.variants || []).findIndex((v) => myId && v.to.includes(myId));
    if (vi >= 0) return { ...entry, text: entry.variants[vi].text, vi };
    return entry.text || entry.kind === "player" ? entry : null;
  }

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

  let lineGen = 0;
  const plays = new Map();
  const canHear = () => header.tts && !muted && volume > 0 && FX.Sound.ok();

  function enqueue(raw) {
    if (raw.kind === "player" || !raw.timing) {
      renderInstant(raw);
      return scrollDown();
    }
    if (plays.has(raw.id) || linesEl.querySelector(`[data-id="${raw.id}"]`)) return;
    const entry = forMe(raw);
    const v = !entry || (stream && !raw.text) ? -1 : entry.vi >= 0 ? entry.vi + 1 : 0;
    const play = { gen: lineGen, raw, entry, v, pieces: entry ? piecesOf(entry) : [], div: null, finished: false };
    plays.set(raw.id, play);
    cueState.set(raw.id, "queued");
    updateBusy();
    setTimeout(() => startLine(play), untilServer(raw.timing.at));
    if (v >= 0) for (const part of raw.timing.versions[v] || []) schedulePart(play, part);
    if (raw.timing.end) onLineEnd({ id: raw.id, end: raw.timing.end });
  }

  function startLine(play) {
    if (play.gen !== lineGen) return;
    cueState.set(play.raw.id, "showing");
    if (play.raw.reveal) showImage(play.raw.reveal);
    releaseCues(play.raw.id, "before");
  }

  function schedulePart(play, part) {
    const audio = !part.audio || !canHear() ? null : part.wav ? Voice.decode(part.wav) : Voice.load(clipUrl(play.entry, part.i));
    delete part.wav;
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
    if (audio) audio.then((buf) => play.gen === lineGen && !play.cut && (buf?.composed || part.composed ? Voice.playNow(buf, null, part.dur / 1000) : Voice.playNow(buf, play.entry.inPerson ? {} : voiceOf(play.entry)?.fx)));
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

  function onLineEnd({ id, end }) {
    const play = plays.get(id);
    if (!play) return;
    play.raw.timing.end = end;
    if (play.v < 0) setTimeout(() => finishLine(play), untilServer(end));
  }

  function typeInto(div, text, budget = text.length * 14) {
    const start = div.textContent;
    const len = Math.max(1, text.length);
    const per = (budget * 0.85) / len;
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

  const cueState = new Map();
  const heldCues = new Map();

  function runEffect(effect) {
    FX.start(effect);
    if (effect.atEntry && effect.seconds > 0) setTimeout(() => FX.end(effect.id), effect.seconds * 1000);
  }

  function onEffect(effect) {
    if (effect.type === "sound" && FX.Sound.ok()) Sfx.preload(effect.sound);
    const st = effect.atEntry ? cueState.get(effect.atEntry) : "none";
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

  const measure = document.createElement("canvas").getContext("2d");
  function placeCaret() {
    const cs = getComputedStyle(input);
    measure.font = `${cs.fontSize} ${cs.fontFamily}`;
    const w = measure.measureText(input.value.toUpperCase().slice(0, input.selectionStart ?? input.value.length)).width;
    caret.style.left = `${input.offsetLeft + Math.min(w, input.clientWidth - 4)}px`;
  }
  ["input", "keyup", "click", "focus"].forEach((ev) => input.addEventListener(ev, placeCaret));
  addEventListener("resize", placeCaret);
  new ResizeObserver(() => placeCaret()).observe(promptEl);
  new ResizeObserver(() => placeCaret()).observe(input);

  Voice.setBlocked(() => FX.has("blackout"));

  function lockedOut() { return FX.has("lockout"); }
  document.addEventListener("fxchange", () => {
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
  screenEl.addEventListener("click", (e) => {
    if (getSelection().toString() || document.body.classList.contains("panel-open")) return;
    if (e.target.closest("input, button, select, textarea, a, label, .rollbox, .panel")) return;
    input.focus();
  });

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

  let crew = [], claims = {}, myId = null, conds = {};
  let played = [];
  const crewKey = () => `crew:${code}`;
  const mine = () => crew.find((c) => c.id === myId) || null;
  const watching = () => !spectate && crew.length > 0 && !mine();
  let docs = [];
  const SQ = '<span class="sq">■</span>', sq = (html) => `${SQ} ${html} ${SQ}`;
  const escH = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const setLabel = (el, t) => { if (el.dataset.orig !== undefined) el.dataset.orig = t; else el.textContent = t; };
  const focusPick = () => ($("crewpick-list").querySelector("li.current button") || $("crewpick-list").querySelector("button"))?.focus();

  function openPanel(id) {
    if (id !== "docs") stopLog();
    for (const p of ["crewpick", "crewfile", "selfroll", "termpick", "solopick", "docs", "ending", "chargen"]) $(p).hidden = p !== id;
    document.body.classList.toggle("panel-open", !!id);
    if (id === "crewpick" && bootEl.classList.contains("gone")) focusPick();
    if (!id && !spectate) input.focus();
    renderSide();
  }

  function renderShip() {
    if (window.ShipUI && $("shipbar")) ShipUI.player($("shipbar"), header?.ship || null, spectate ? null : mine(), send);
  }

  function setCrew(list, taken, playedBy) {
    crew = list || [];
    claims = taken || {};
    played = playedBy || [];
    renderShip();
    renderCastbar();
    if (myId && !mine()) {
      myId = null;
      if (!spectate && crew.length) setTimeout(() => { renderPicker(); openPanel("crewpick"); });
    }
    const pc = mine();
    form.hidden = spectate || watching();
    input.disabled = lockedOut() || watching();
    $("watchpick").hidden = !watching();
    $("hdr-file").hidden = $("hdr-file-sep").hidden = spectate || !crew.length;
    $("hdr-file").textContent = pc ? `FILE: ${shortName(pc)}${gone(pc) ? ` (${gone(pc).toUpperCase()})` : ""}` : "FILE: NONE";
    $("hdr-memo").hidden = $("hdr-memo-sep").hidden = spectate || !crew.some(gone);
    if (!$("memorialfx").hidden) renderMemorial();
    $("crewfile-new").hidden = !(pc && gone(pc) && !pc.replacedBy);
    if (!$("crewpick").hidden) renderPicker();
    if (!$("crewfile").hidden) renderFile();
    renderSide();
  }
  let stationMap = null;
  function renderCastbar() {
    if (!stream) return;
    if (stationMap) {
      StationMap.mini($("cb-map"), stationMap.layout, peopleNames(stationMap.people));
    }
    const pcs = played.map((p) => ({ ...p, c: crew.find((c) => c.id === p.id) })).filter((p) => p.c);
    $("cb-crew").innerHTML = pcs.map(({ c, by }) => {
      const wounds = Array.from({ length: c.wounds.max }, (_, i) => `<i class="${i < c.wounds.current ? "on" : ""}"></i>`).join("");
      return `<div class="cb-pc" data-id="${escH(c.id)}">
        <span class="vwave" aria-hidden="true">${WAVE_BARS}</span>
        <div class="cb-face">${portraitHtml(c.portrait, "cb-portrait") || '<span class="cb-noface">NO PHOTO</span>'}</div>
        <div class="cb-name"><span>${escH(shortName(c))}</span><span class="cb-wounds" title="Wounds">${wounds}</span></div>
        <div class="cb-vit"><span>HP ${c.health.current}/${c.health.max}</span><span>STRESS ${c.stress}</span></div>
        ${by ? `<div class="cb-by">${escH(by.toUpperCase())}</div>` : ""}
      </div>`;
    }).join("");
    showTalking();
  }
  let talking = new Set();
  const WAVE_COUNT = 36;
  function waveShape() {
    const humps = [0.3, 0.68].map((c) => ({ c: c + (Math.random() - 0.5) * 0.14, w: 0.1 + Math.random() * 0.08, a: 0.7 + Math.random() * 0.3 }));
    return Array.from({ length: WAVE_COUNT }, (_, i) => {
      const x = (i + 0.5) / WAVE_COUNT;
      const hump = Math.max(...humps.map(({ c, w, a }) => a * Math.exp(-(((x - c) / w) ** 2))));
      return Math.min(1, Math.max(0.15, 0.18 + 0.82 * hump + (Math.random() - 0.5) * 0.12));
    });
  }
  const waveSeconds = (i) => 0.55 + ((i * 7) % 11) * 0.05;
  const WAVE_BARS = waveShape().map((h, i) => `<i style="--h: ${h.toFixed(2)}; --t: ${waveSeconds(i).toFixed(2)}s"></i>`).join("");
  document.querySelector(".cb-cam .vwave").innerHTML = WAVE_BARS;
  function skewWave(card) {
    const heights = waveShape();
    card.querySelectorAll(".vwave i").forEach((bar, i) => {
      bar.style.setProperty("--h", heights[i].toFixed(2));
      bar.style.setProperty("--d", `${(-Math.random() * waveSeconds(i)).toFixed(2)}s`);
    });
  }
  let wardenTalking = false;
  function showTalking() {
    const cam = document.querySelector(".cb-cam");
    for (const [el, on] of [...[...$("cb-crew").querySelectorAll(".cb-pc")].map((el) => [el, talking.has(el.dataset.id)]), [cam, wardenTalking]]) {
      if (on && !el.classList.contains("talking")) skewWave(el);
      el.classList.toggle("talking", on);
    }
  }

  const shortName = (c) => (c.name.match(/["'“‘]([^"'”’]+)["'”’]/)?.[1] || c.name.split(" ")[0]).toUpperCase();
  const nameOf = (id) => shortName(crew.find((c) => c.id === id) || { name: id });
  const peopleNames = (people) => Object.fromEntries(Object.entries(people).map(([room, ids]) => [room, ids.map((id) => nameOf(id))]));

  function renderPicker() {
    $("crewpick-list").innerHTML = crew.map((c, i) => {
      const others = (claims[c.id] || 0) - (c.id === myId ? 1 : 0);
      const cls = [c.portrait && "has-face", c.id === myId && "current"].filter(Boolean).join(" ");
      return `<li${cls ? ` class="${cls}"` : ""} data-id="${escH(c.id)}">${portraitHtml(c.portrait, "face")}<button type="button" class="p-btn pick" data-id="${escH(c.id)}"${gone(c) && c.id !== myId ? " disabled" : ""}>[${i + 1}] ${escH(c.name.toUpperCase())}</button>
        <span class="p-dim"> · ${escH(c.className.toUpperCase())} · ${escH(c.role.toUpperCase())} · HIGH SCORE ${c.highScore || 0}${gone(c) ? ` · <b>${escH(gone(c).toUpperCase())}</b>` : ""}${others > 0 ? " · <b>IN USE</b>" : ""}${c.id === myId ? " · <b>CURRENT FILE</b>" : ""}</span>
        ${gone(c) && !c.replacedBy ? `<div><button type="button" class="p-btn" data-newfor="${escH(c.id)}">[ MAKE A NEW CHARACTER ]</button></div>` : ""}
        <div class="p-dim p-crime">${escH(c.crime)}</div></li>`;
    }).join("") + (canCreate() ? '<li><button type="button" class="p-btn" id="crewpick-new">[N] NEW CHARACTER</button><div class="p-dim p-crime">ROLL UP A NEW CREWMEMBER. THE WARDEN APPROVES THEM.</div></li>' : "");
  }
  const gone = (c) => (c.cond?.dead ? "deceased" : c.retired ? "retired" : "");
  const canCreate = () => !spectate && !!header.create && crew.filter((c) => !gone(c)).length < 4;

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

  const circle = (k, v) => header.selfRolls && !spectate
    ? `<button type="button" class="cs-num" data-check="${k}" title="Roll ${k}"><span class="cs-circle">${v}</span><span class="cs-k">${k.toUpperCase()}</span></button>`
    : `<div class="cs-num"><span class="cs-circle">${v}</span><span class="cs-k">${k.toUpperCase()}</span></div>`;
  const STEP_ICON = (d) => `<svg viewBox="0 0 10 10" aria-hidden="true"><path d="${d}" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"/></svg>`;
  const STEP_MINUS = STEP_ICON("M1.5 5h7"), STEP_PLUS = STEP_ICON("M1.5 5h7M5 1.5v7");
  function pill(field, label, now, max, subs) {
    const ctl = header.vitals && !spectate;
    const btn = (d) => `<button type="button" class="p-btn cs-step" data-vital="${field}" data-d="${d}" aria-label="${field} ${d > 0 ? "up" : "down"}">${d > 0 ? STEP_PLUS : STEP_MINUS}</button>`;
    return `<div class="cs-vital"><div class="cs-k">${label}</div>
      <div class="cs-pill">${ctl ? btn(-1) : ""}<span><span class="cs-now${max !== undefined ? " of" : ""}" style="min-width: ${Math.max(2, String(max ?? "").length)}ch">${now}</span>${max !== undefined ? ` <span class="cs-of">/</span> ${max}` : ""}</span>${ctl ? btn(1) : ""}</div>
      <div class="cs-subs">${subs.map((x) => `<span>${x}</span>`).join("")}</div></div>`;
  }
  const field = (label, value, always = false) => value || always ? `<div class="cs-field"><span class="cs-k">${label}</span><b>${escH(value.toUpperCase())}</b></div>` : "";
  const sheetHead = (c) => `<div class="cs-card cs-head">
      <div class="cs-facebox">${portraitHtml(c.portrait, "cs-face") || `<span class="cs-noface">NO PHOTO</span>`}</div>
      <div>${field("CHARACTER NAME", c.name)}${field("PRONOUNS", c.pronouns, true)}${field("CLASS", c.className)}${field("ROLE", c.role)}${field("HIGH SCORE", String(c.highScore || 0), true)}${field("STATUS", c.retired ? "retired" : "")}</div>
    </div>`;
  const combatRow = (c) => {
    const a = c.armor;
    const bits = [];
    if (a) bits.push(`<span class="${a.destroyed ? "cs-bad" : ""}">ARMOR: ${escH(a.name.toUpperCase())} · AP ${a.destroyed ? 0 : a.ap}${a.dr ? ` · DR ${a.dr}` : ""}${a.destroyed ? " · DESTROYED" : ""}</span>`);
    if (c.cond?.bleeding) bits.push(`<span class="cs-bad">BLEEDING ${c.cond.bleeding} A ROUND</span>`);
    if (c.cond?.dying) bits.push(`<span class="cs-bad">DYING: DEAD IN ${c.cond.dying} ROUNDS WITHOUT INTERVENTION</span>`);
    if (c.status) bits.push(`<span class="cs-bad">${escH(c.status.toUpperCase())}${c.statusNote ? ` · ${escH(c.statusNote.toUpperCase())}` : ""}</span>`);
    if (c.deathSaveIn) bits.push(`<span class="cs-bad">DEATH SAVE IN ${c.deathSaveIn} ROUNDS UNLESS TREATED</span>`);
    return `${c.cond?.dead ? '<div class="cs-deceased">DECEASED</div>' : ""}<div class="cs-combat">${bits.join("")}</div>`;
  };
  const statusCard = (c) => `<div class="cs-card cs-status"><div class="cs-title">STATUS REPORT</div><div class="cs-vitals">
      ${pill("health", "HEALTH", c.health.current, c.health.max, ["CURRENT", "MAX"])}
      ${pill("wounds", "WOUNDS", c.wounds.current, c.wounds.max, ["CURRENT", "MAX"])}
      ${pill("stress", "STRESS", c.stress, undefined, ["CURRENT", `MIN ${c.minStress ?? 2}`])}
    </div>${combatRow(c)}</div>`;
  const numbersCard = (title, obj, hint = "") => `<div class="cs-card cs-${title.toLowerCase()}"><div class="cs-title">${title}</div>
      <div class="cs-nums">${Object.entries(obj).map(([k, v]) => circle(k, v)).join("")}</div>${hint}</div>`;
  const rollHint = () => (header.selfRolls && !spectate ? '<div class="cs-hint">TAP A STAT OR SAVE TO ROLL IT</div>' : "");

  function renderFile() {
    const c = mine();
    if (!c) { $("crewfile-body").innerHTML = '<div class="p-dim">NO CREW FILE SELECTED.</div>'; return; }
    $("crewfile-body").innerHTML = `<div class="cs cs-full">${sheetCards(c)}</div>`;
    fitChips($("crewfile-body"));
  }
  const skillBonus = (pc, name) => (name && pc.skills.find((s) => s.name.toLowerCase() === name.toLowerCase())?.bonus) || 0;
  const FILE_ICON = '<svg class="cs-file" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>';
  const TAPE_ICON = '<svg class="cs-file" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><circle cx="16" cy="11" r="2"/><path d="M8 13h8"/><path d="M6 19l2-3h8l2 3"/></svg>';
  const docChip = (d) => `<button type="button" class="cs-doc" data-doc="${escH(d.id)}" title="${d.audio ? "Play" : "Open"}">${d.audio ? TAPE_ICON : FILE_ICON}${chipText(d.title.toUpperCase())}</button>`;
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
  const sheetCards = (c) => `
      ${sheetHead(c)}
      ${statusCard(c)}
      ${conds[c.id]?.length ? `<div class="cs-card cs-conds-card"><div class="cs-title">CONDITIONS</div><div class="cs-conds">${conds[c.id].map((x) => `<span>${escH(x.toUpperCase())}</span>`).join("")}</div></div>` : ""}
      ${numbersCard("STATS", c.stats, rollHint())}
      ${numbersCard("SAVES", c.saves)}
      <div class="cs-card cs-skills"><div class="cs-title">SKILLS</div>${c.skills.length ? `<div class="cs-list">${c.skills.map((s) => `<div><span>${escH(s.name)}</span><span class="cs-bonus">+${s.bonus}</span></div>`).join("")}</div>` : '<div class="cs-hint">NONE</div>'}</div>
      <div class="cs-card cs-items"><div class="cs-title">ITEMS</div>${c.items.length || docs.some((d) => d.to) ? `<div class="cs-chips">${c.items.map((x) => `<span>${chipText(x)}</span>`).join("")}${docs.filter((d) => d.to).map(docChip).join("")}</div>` : '<div class="cs-hint">NOTHING</div>'}</div>
      ${docs.some((d) => !d.to) ? `<div class="cs-card cs-shared"><div class="cs-title">SHARED</div><div class="cs-chips">${docs.filter((d) => !d.to).map(docChip).join("")}</div></div>` : ""}
      <div class="cs-card cs-story">
        ${c.crime ? `<div><span class="cs-k">CONVICTION</span> ${escH(c.crime)}</div>` : ""}
        ${c.backstory ? `<div class="p-text">${escH(c.backstory)}</div>` : ""}
        ${c.trinket ? `<div><span class="cs-k">TRINKET</span> ${escH(c.trinket)}</div>` : ""}
        ${c.credits ? `<div><span class="cs-k">CREDITS</span> ${c.credits.toLocaleString("en-US")} CR</div>` : ""}
        ${c.patch ? `<div><span class="cs-k">PATCH</span> ${escH(c.patch)}</div>` : ""}
        ${header.trauma?.[c.className] ? `<div><span class="cs-k">TRAUMA RESPONSE</span> ${escH(header.trauma[c.className])}</div>` : ""}
      </div>`;

  let sideOpen = ls.get("side-open") !== "0";
  function sideNeed(c) {
    const m = document.createElement("div");
    m.style.cssText = "position: absolute; visibility: hidden; left: -9999px; top: 0; width: 0;";
    m.innerHTML = `<div class="cs cs-compact">${statusCard(c)}</div>`;
    document.body.append(m);
    const card = m.querySelector(".cs-card"), cs = getComputedStyle(card);
    const w = m.querySelector(".cs-vitals").scrollWidth + ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"].reduce((n, k) => n + parseFloat(cs[k]), 0);
    m.remove();
    const side = getComputedStyle($("side"));
    return Math.ceil(w + parseFloat(side.paddingLeft) + parseFloat(side.borderLeftWidth) + 2);
  }
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
    side.hidden = !c || !sideOpen || !w || spectate || !$("crewpick").hidden || !$("crewfile").hidden || !$("reveal").hidden;
    $("hdr-file").classList.toggle("on", !side.hidden);
    if (side.hidden) return;
    side.style.flexBasis = `${w}px`;
    side.innerHTML = `<div class="cs cs-compact">${sheetCards(c)}</div>
      <div class="s-foot"><button type="button" class="p-btn" id="side-change">[ CHANGE CHARACTER ]</button> <button type="button" class="p-btn" id="side-hide">[ HIDE ]</button></div>`;
    fitChips(side);
  }
  addEventListener("resize", () => renderSide());
  $("side").addEventListener("click", (e) => {
    if (e.target.id === "side-change") toPicker();
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
    if (curRoll) showRoll(curRoll);
    FX.Sound.beep(880, 0.06, 0.05);
  }

  function crewOnInit() {
    if (spectate || !crew.length) return;
    const saved = ls.get(crewKey());
    if (saved === "none") return claim(null);
    if (saved && crew.some((c) => c.id === saved)) return claim(saved);
    renderPicker();
    openPanel("crewpick");
  }

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
    const newFor = e.target.closest("[data-newfor]")?.dataset.newfor;
    if (newFor !== undefined) return Chargen.start(newFor);
    if (e.target.closest("#crewpick-new")) return Chargen.start();
    const id = e.target.closest("[data-id]")?.dataset.id;
    const c = crew.find((x) => x.id === id);
    if (c && !(gone(c) && c.id !== myId)) showPicked(id);
  });
  addEventListener("keydown", (e) => {
    if ($("crewpick").hidden || !bootEl.classList.contains("gone") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.toLowerCase() === "n" && canCreate()) { e.preventDefault(); return Chargen.start(); }
    const c = crew[Number(e.key) - 1];
    if (c && !(gone(c) && c.id !== myId)) { e.preventDefault(); showPicked(c.id); $("crewfile-change").focus(); }
  });
  Chargen.init({
    send, escH, fit: fitChips, portrait: (f) => portraitHtml(f, "cs-face"), notice: (t) => notice(t),
    sheet: (c) => `<div class="cs cs-full">${sheetCards(c)}</div>`,
    open: () => openPanel("chargen"), close: () => openPanel(null), claim: (id) => claim(id),
  });
  $("crewfile-new").onclick = () => Chargen.start(mine()?.id);
  $("crewpick-none").onclick = () => { claim(null); openPanel(null); };
  $("watchpick").onclick = () => toPicker();
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
    let list = null;
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

  function docsButton() {
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

  let log = null;
  let logGen = 0;
  const logHtml = (d) => `<div class="alog" data-alog="${escH(d.id)}">
      <div class="alog-head"><span>VOICE: ${escH(d.audio.speaker.toUpperCase())}</span><span class="alog-state">READY</span></div>
      <div class="alog-ctl"><button type="button" class="p-btn" data-alog-play>[ PLAY ]</button> <button type="button" class="p-btn" data-alog-stop hidden>[ STOP ]</button><span class="vwave" aria-hidden="true">${WAVE_BARS}</span></div>
      <div class="alog-lines">${d.audio.lines.map((l, i) => (l.sound
        ? `<div class="alog-line alog-sfx" data-i="${i}">[ ${escH(l.sound.name.toUpperCase())} ]</div>`
        : `<div class="alog-line" data-i="${i}">${l.who ? `<span class="alog-who">${escH(l.who)}:</span> ` : ""}${escH(l.text)}</div>`)).join("")}</div>
    </div>`;
  function stopLog() {
    $("docs-body").querySelector(".alog")?.classList.remove("talking");
    logGen++;
    log?.clip?.stop();
    for (const pid of log?.sounds || []) Sfx.stop(pid);
    log = null;
  }
  async function playLog(d) {
    stopLog();
    FX.Sound.unlock();
    const gen = logGen, box = $("docs-body").querySelector(".alog"), lines = [...box.querySelectorAll(".alog-line")];
    log = { clip: null, sounds: [] };
    for (const l of d.audio.lines) if (l.sound) Sfx.preload(l.sound.id);
    const state = (t) => { box.querySelector(".alog-state").textContent = t; };
    const buttons = (playing) => { box.querySelector("[data-alog-play]").hidden = playing; box.querySelector("[data-alog-stop]").hidden = !playing; };
    buttons(true);
    for (const l of lines) l.classList.remove("now", "said");
    const fetchPart = (i) => (i < lines.length && !d.audio.lines[i].sound ? Voice.load(`api/sessions/${code}/handouts/${encodeURIComponent(d.id)}/audio/${i}`) : null);
    let next = fetchPart(0);
    for (let i = 0; i < lines.length; i++) {
      state(`LOADING ${i + 1}/${lines.length}`);
      const buf = await next;
      if (gen !== logGen) return;
      next = fetchPart(i + 1);
      const sound = d.audio.lines[i].sound;
      if (sound) {
        const pid = `log${gen}-${i}`;
        log.sounds.push(pid);
        Sfx.play({ pid, id: sound.id, volume: sound.volume, loop: false });
        lines[i].classList.add("said");
        if (i === lines.length - 1) await new Promise((r) => setTimeout(r, Math.min(10, sound.seconds || 3) * 1000));
        if (gen !== logGen) return;
        continue;
      }
      lines[i].classList.add("now");
      lines[i].scrollIntoView({ block: "nearest" });
      state(`PLAYING ${i + 1}/${lines.length}`);
      if (buf) {
        log.clip = buf.composed ? Voice.playClip(buf, null, buf.seconds) : Voice.playClip(buf, d.audio.lines[i].fx);
        skewWave(box);
        box.classList.add("talking");
        const finished = await log.clip.done;
        box.classList.remove("talking");
        if (!finished || gen !== logGen) return;
      }
      lines[i].classList.replace("now", "said");
      await new Promise((r) => setTimeout(r, 350));
      if (gen !== logGen) return;
    }
    state("END OF RECORDING");
    buttons(false);
    const last = d.audio.lines.at(-1)?.sound ? `log${gen}-${lines.length - 1}` : "";
    for (const pid of log.sounds) if (pid !== last) Sfx.stop(pid);
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

  const pilotKey = () => `pilot:${code}`;
  for (const b of document.querySelectorAll(".dlg-close")) b.onclick = () => b.closest("dialog").close();

  let providers = [];
  const providerList = async () => (providers.length ? providers : (providers = await fetch("api/providers").then((r) => (r.ok ? r.json() : [])).catch(() => [])));
  async function openSoloStart() {
    $("soloStart").showModal();
    const list = await providerList();
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
    const jobs = solo.jobs;
    $("solopick-title").innerHTML = sq(building ? `BUILDING: ${escH(solo.title.toUpperCase())}` : jobs ? "THE JOB BOARD" : "CHOOSE A STORY");
    $("solopick-note").textContent = building
      ? "THE AI IS BUILDING THE WORLD AND EVERYONE IN IT. THIS CAN TAKE A FEW MINUTES."
      : jobs ? `RIM HAULERS: THE RIG IS AT ${jobs.port}, ${jobs.fuel} FUEL. ${jobs.jobs.length ? (isPilot ? "PICK A JOB (PRESS 1-9)." : "THE PILOT IS PICKING A JOB. TALK IT OVER.") : "NO JOBS LEFT HERE."}`
      : `NO WARDEN TONIGHT: THE AI RUNS THE GAME. ${isPilot ? "PICK A STORY (PRESS 1-9)." : "THE PILOT IS PICKING A STORY. TALK IT OVER."}`;
    const board = () => jobs.jobs.map((j, i) => {
      const name = `[${i + 1}] ${escH(j.title)}`;
      return `<li>${isPilot ? `<button type="button" class="p-btn pick" data-job="${escH(j.id)}">${name}</button>` : name}<span class="p-dim tags"> · ${escH(j.where.toUpperCase())}${j.lane ? ` · ${escH(j.lane.toUpperCase())}, ${j.days} DAYS, ${j.cost} FUEL${j.short ? " · NOT ENOUGH FUEL" : ""}` : ""}</span>
        <div class="p-dim p-crime">${escH(j.hook)}</div><div class="p-dim p-crime">${escH(j.job)}</div></li>`;
    }).join("") + `<li class="p-dim">TRAVEL (HOUSE RULE: 1 FUEL PER STARTED 3 DAYS)${jobs.low ? " · FUEL IS BELOW THE CHEAPEST LANE: REFUEL" : ""}</li>` + jobs.lanes.map((l) =>
      `<li>${isPilot ? `<button type="button" class="p-btn" data-travel="${escH(l.to)}">[ TRAVEL: ${escH(l.dest)} ]</button>` : `TRAVEL: ${escH(l.dest)}`}<span class="p-dim tags"> · ${escH(l.lane.toUpperCase())}, ${l.days} DAYS, ${l.cost} FUEL${l.short ? " · NOT ENOUGH FUEL" : ""}</span></li>`).join("")
      + (isPilot && jobs.stuck ? `<li><button type="button" class="p-btn" data-dispatch="1">[ CALL DISPATCH ]</button><span class="p-dim tags"> · LOCAL 1312 ADVANCES THE FUEL FOR THE CHEAPEST LANE; ITS PRICE IS ADDED TO THE NOTE (HOUSE RULE)</span></li>` : "")
      + (isPilot && jobs.canRefuel ? `<li><button type="button" class="p-btn" data-refuel="1">[ REFUEL ${jobs.fuel}/${jobs.capacity} ]</button><span class="p-dim tags"> · ${jobs.fuelEach.toLocaleString("en-US")}CR A UNIT (HOUSE RULE), FROM THE RIG ACCOUNT&#58; ${jobs.money.toLocaleString("en-US")}CR</span></li>` : "");
    $("solopick-list").innerHTML = building ? "" : jobs ? board() : solo.pitches.map((p, i) => {
      const name = `[${i + 1}] ${escH(p.title.toUpperCase())}`;
      return `<li>${isPilot ? `<button type="button" class="p-btn pick" data-pick="${i}">${name}</button>` : name}<span class="p-dim tags"> · ${escH(p.tags.toUpperCase())}</span>
        <div class="p-dim p-crime">${escH(p.hook)}</div></li>`;
    }).join("");
    $("solopick-status").innerHTML = solo.busy === "pitches" ? 'GENERATING STORIES<span class="dots"></span>'
      : building ? 'BUILDING<span class="dots"></span>' : escH(solo.error.toUpperCase());
    $("solopick-more").hidden = !isPilot || building;
    $("solopick-more").disabled = !!solo.busy;
    $("solopick-more").textContent = jobs ? "[ LEAVE THE CAMPAIGN ]" : "[ OTHER STORIES ]";
  }
  let endingTimer = null;
  function showEnding() {
    clearTimeout(endingTimer);
    if (plays.size) { endingTimer = setTimeout(showEnding, 700); return; }
    const x = solo;
    $("ending-verdict").textContent = (x.recap?.verdict || "").toUpperCase();
    $("ending-how").textContent = x.ending ? x.ending.toUpperCase() : "";
    const after = x.after && [...(x.after.pay?.length ? [["Pay", x.after.pay.join("\n")]] : []), ...(x.after.factions.length ? [["Faction standing", x.after.factions.join("\n")]] : []), ["Downtime (short-term recovery and a Rest Save, rolled for the crew)", x.after.rest.join("\n")]];
    $("ending-recap").innerHTML = [...(x.recap?.sections || []).map((s) => [s.heading, s.text]), ...(after || [])].map(([h, t]) => `<div class="rc-h">${escH(h.toUpperCase())}</div><div class="rc-t">${escH(t)}</div>`).join("");
    $("ending-status").innerHTML = x.busy === "recap" ? 'WRITING THE RECAP<span class="dots"></span>' : escH((x.error || "").toUpperCase());
    $("ending-again").hidden = !isPilot;
    if (!isPilot && x.busy !== "recap") $("ending-status").textContent = (x.error ? `${x.error} ` : "").toUpperCase() + "THE PILOT CAN START ANOTHER STORY.";
    openPanel("ending");
  }
  $("ending-again").onclick = () => ws?.send(JSON.stringify({ t: "pilotNewStory" }));

  const pickStory = (i) => solo?.phase === "pick" && !solo.busy && ws?.send(JSON.stringify({ t: "pilotBuild", i }));
  const pickJob = (id) => solo?.phase === "pick" && !solo.busy && ws?.send(JSON.stringify({ t: "pilotJob", id }));
  $("solopick-list").addEventListener("click", (e) => {
    const i = e.target.closest("[data-pick]")?.dataset.pick, job = e.target.closest("[data-job]")?.dataset.job;
    const to = e.target.closest("[data-travel]")?.dataset.travel;
    if (to) ws?.send(JSON.stringify({ t: "pilotTravel", to }));
    else if (e.target.closest("[data-dispatch]")) ws?.send(JSON.stringify({ t: "pilotDispatch" }));
    else if (e.target.closest("[data-refuel]")) ws?.send(JSON.stringify({ t: "pilotRefuel" }));
    else if (i !== undefined) pickStory(Number(i));
    else if (job) pickJob(job);
  });
  $("solopick-more").onclick = () => ws?.send(JSON.stringify({ t: solo?.jobs ? "pilotLeaveCampaign" : "pilotPitches" }));
  addEventListener("keydown", (e) => {
    if ($("solopick").hidden || !isPilot || e.ctrlKey || e.metaKey || e.altKey || !/^[1-9]$/.test(e.key)) return;
    const n = Number(e.key) - 1;
    if (solo?.jobs) { if (solo.jobs.jobs[n]) { e.preventDefault(); pickJob(solo.jobs.jobs[n].id); } }
    else if (n < (solo?.pitches.length || 0)) { e.preventDefault(); pickStory(n); }
  });

  function setPilot(info) {
    isPilot = true;
    pilot = info;
    $("hdr-pilot").hidden = $("hdr-pilot-sep").hidden = false;
    const p = info.providers.find((x) => x.id === info.config.provider);
    const remembered = p && !p.configured && ls.get(`wardenKey:${p.id}`);
    if (remembered && !pilotKeySent) {
      pilotKeySent = true;
      ws.send(JSON.stringify({ t: "pilotKey", provider: p.id, key: remembered }));
    }
    renderSolo();
    Chargen.setPending(info.chargen, true);
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
  addEventListener("keydown", (e) => { if ($("soloStart").open || $("pilotDlg").open) e.stopImmediatePropagation(); }, true);

  function notice(text) {
    const div = document.createElement("div");
    div.className = "line notice";
    div.textContent = `[ ${String(text).toUpperCase()} ]`;
    linesEl.append(div);
    scrollDown();
  }

  $("hdr-rules").onclick = () => $("rules").showModal();
  $("hdr-menu").onclick = () => $("hdr-menu").setAttribute("aria-expanded", String($("hdr").classList.toggle("menu-open")));
  $("hdr").addEventListener("click", (e) => { if (e.target.closest(".hdr-btn:not(#hdr-menu)") && $("hdr").classList.contains("menu-open")) { $("hdr").classList.remove("menu-open"); $("hdr-menu").setAttribute("aria-expanded", "false"); } });
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
  $("rules").addEventListener("click", (e) => { if (e.target === $("rules")) $("rules").close(); });
  addEventListener("keydown", (e) => { if ($("rules").open) e.stopImmediatePropagation(); }, true);

  $("hdr-file").onclick = () => {
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

  const LOOK_FX = { blood: "blood", goo: "goo", crack: "crack" };
  const LOOK_NAMES = { blood: "BLOODY", goo: "SLIMED", crack: "CRACKED", flicker: "FLICKERING", dim: "DIM", grime: "GRIMY", portable: "HANDHELD" };
  let termId = null;
  const termKey = () => `term:${code}`;
  const terminals = () => header.terminals || [];
  const myTerm = () => terminals().find((t) => t.id === termId) || null;

  function terminalOnInit() {
    if (spectate || !terminals().length) return applyTerminal();
    const saved = ls.get(termKey());
    const t = terminals().find((x) => x.id === (termId || saved) && x.open) || terminals().find((x) => x.open);
    if (t) setTerminal(t.id, true);
  }
  function setTerminal(id, tell) {
    termId = id;
    ls.set(termKey(), id);
    if (tell) send({ t: "terminal", id });
    applyTerminal();
  }

  const sysTerm = () => (spectate ? null : myTerm()?.system ? myTerm() : null);
  const sysName = () => sysTerm()?.system || header.stationName;
  const accessText = () => (sysTerm() ? "CREW" : header.accessLevel);
  const promptText = () => `${accessText()}@${sysName()}>`;
  function applyNames() {
    $("hdr-station").textContent = sysName();
    $("hdr-access").textContent = accessText();
    $("hdr-os").textContent = sysTerm()?.os || `${header.voices?.terminal?.name || "TERMINAL"} OS v4.1`;
    promptEl.textContent = promptText();
    const rig = header.rig, onRig = !!rig && !spectate && (rig.transit || sysTerm()?.system === rig.system);
    $("hdr-rig").hidden = $("hdr-rig-sep").hidden = !onRig;
    if (onRig) {
      const s = rig.stores;
      $("hdr-rig").textContent = `FUEL ${rig.fuel}/${rig.capacity} PARTS ${s.parts} EXPLOSIVES ${s.explosives} FLARES ${s.flares} RATIONS ${s.rations}${rig.lifeSupport === "ONLINE" ? "" : ` LIFE SUPPORT ${rig.lifeSupport}`}`;
    }
  }

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

  const ADV = [["none", "NORMAL", ""], ["advantage", "ADVANTAGE", "+"], ["disadvantage", "DISADVANTAGE", "-"]];
  let sr = null;

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

  const rollbox = $("rollbox"), rbDice = $("rb-dice"), rbErr = $("rb-err");
  let curRoll = null, alerted = "";

  const ADV_MARK = { none: "NORMAL", advantage: "[+]", disadvantage: "[-]" };
  const plusBox = $("rb-plus-box");
  const myEntry = (own = mine()) => curRoll?.pcs.find((p) => p.id === own?.id);
  function diceNeeded() {
    const e = myEntry();
    let adv = e?.advantage ?? curRoll.advantage;
    if (e?.plus && (e.autoPlus || plusBox.checked)) adv = adv === "disadvantage" ? "none" : "advantage";
    return adv === "none" ? 1 : 2;
  }
  function setPlaceholder() {
    rbDice.placeholder = curRoll.panic ? (diceNeeded() === 1 ? "14" : "14 6") : (diceNeeded() === 1 ? "47" : "47 82");
  }
  plusBox.addEventListener("change", () => curRoll && setPlaceholder());

  function rollTargetText(roll, pc) {
    const own = myEntry(pc);
    const why = own?.why?.length ? ` (${own.why.join(", ").toUpperCase()})` : "";
    const mark = own && own.advantage !== roll.advantage ? ` · YOURS IS ${ADV_MARK[own.advantage]}${why}` : why ? ` ·${why}` : "";
    const rad = pc.cond?.rad || 0;
    if (roll.panic) return `YOUR STRESS: ${pc.stress} · ROLL ABOVE IT ON A D20 TO KEEP YOUR COOL${mark}`;
    if (roll.ship) {
      const sb = skillBonus(pc, roll.skillName);
      return `${roll.ship.label.toUpperCase()}: ${roll.ship.value}${sb ? ` + ${roll.skillName.toUpperCase()} ${sb}` : ""} · ROLL UNDER ${roll.ship.value + sb}${mark}`;
    }
    const stat = Math.max(1, (pc.stats[roll.check] ?? pc.saves[roll.check]) - rad);
    const bonus = skillBonus(pc, roll.skillName);
    return `YOUR ${roll.check.toUpperCase()}: ${stat}${rad ? ` (-${rad} RADIATION)` : ""}${bonus ? ` + ${roll.skillName.toUpperCase()} ${bonus}` : ""} · ROLL UNDER ${stat + bonus}${mark}`;
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
    const entry = myEntry(own);
    $("rb-plus").hidden = !entry?.plus;
    plusBox.checked = !!entry?.autoPlus;
    plusBox.disabled = !!entry?.autoPlus;
    setPlaceholder();
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
      const need = diceNeeded();
      const [lo, hi, die, eg] = curRoll.panic ? [1, 20, "D20", "14 6"] : [0, 99, "D100", "47 82"];
      if (dice.length !== need || dice.some((d) => d < lo || d > hi)) {
        rbErr.textContent = need === 1 ? `ENTER ONE ${die} ROLL (${curRoll.panic ? "1-20" : "00-99"}).` : `ENTER BOTH ${die} ROLLS, E.G. ${eg}.`;
        return rbDice.focus();
      }
      Object.assign(msg, { manual: true, dice });
    }
    if (myEntry()?.plus && plusBox.checked) msg.plus = true;
    rbErr.textContent = "ROLLING...";
    send(msg);
  }

  $("rb-form").addEventListener("submit", (e) => { e.preventDefault(); sendRoll(rbDice.value.trim() !== ""); });
  $("rb-enter").addEventListener("click", () => sendRoll(true));
  rbDice.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendRoll(true); } });

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
        : `${result.outcome.toUpperCase()}${result.panicCheck ? ": PANIC CHECK" : ""} (UNDER ${result.target})${result.success ? "" : " · +1 STRESS"}`);
      fx.classList.add(result.success ? "pass" : "fail");
      if (result.critical) fx.classList.add("crit");
      if (result.success) { FX.Sound.beep(880, 0.12, 0.08); setTimeout(() => FX.Sound.beep(1320, 0.2, 0.08), 120); }
      else { FX.Sound.beep(220, 0.3, 0.1); setTimeout(() => FX.Sound.beep(160, 0.4, 0.1), 260); }
    }, 1300);
    setTimeout(() => {
      rollQueue.shift();
      if (rollQueue.length) playRollResult();
      else fx.hidden = true;
    }, rollQueue.length > 1 ? 3400 : 5200);
  }

  function showPlan({ name, rows }) {
    const fx = $("planfx");
    fx.hidden = !rows;
    if (!rows) return;
    fx.querySelector(".pf-title").textContent = `LAYOUT: ${String(name || "").toUpperCase()}`;
    fx.querySelector(".pf-plan").innerHTML = RoomPlan.svg(rows, { cell: 24, title: name });
    chirp();
  }
  let sector = null;
  function showSector(msg) {
    const fx = $("sectorfx");
    if (msg.hide) { sector = null; fx.hidden = true; return; }
    const fresh = !sector;
    sector = msg;
    const port = (id) => msg.ports.find((p) => p.id === id);
    const mine = msg.offered.findIndex((o) => o.id === msg.mine);
    const lanes = msg.lanes.map((l) => `<line class="${l.dark ? "dark" : ""}" x1="${port(l.a).x}" y1="${port(l.a).y}" x2="${port(l.b).x}" y2="${port(l.b).y}"><title>${escH(l.name)} · ${l.days} days</title></line>`).join("");
    const ports = msg.ports.map((p) => `<g transform="translate(${p.x} ${p.y})"><circle r="9"/><circle r="3" class="core"/><text y="-16">${escH(p.name)}</text></g>`).join("");
    const jobs = msg.offered.map((o, i) => `<g class="job${i === mine ? " mine" : ""}" data-job="${escH(o.id)}" transform="translate(${o.x} ${o.y})"><rect x="-12" y="-12" width="24" height="24" transform="rotate(45)"/><text y="4">${i + 1}</text></g>`).join("");
    fx.querySelector(".pf-title").textContent = `SECTOR: ${String(msg.title).toUpperCase()}`;
    fx.querySelector(".sf-map").innerHTML = `<svg viewBox="0 0 1100 560" role="img" aria-label="Sector map"><g class="lanes">${lanes}</g>${ports}<g class="rig" transform="translate(${msg.rig.x - 40} ${msg.rig.y + 26})"><path d="M-8 6 L0 -9 L8 6 Z"/><text y="20">${escH(msg.rig.name)}</text></g>${jobs}</svg>`;
    const board = msg.offered.length
      ? msg.offered.map((o, i) => `<button type="button" class="p-btn sf-job${i === mine ? " mine" : ""}" data-job="${escH(o.id)}"><b>${i + 1}. ${escH(o.title)}</b>${msg.votes[o.id] ? ` <span class="sf-votes">[${"*".repeat(msg.votes[o.id])}]</span>` : ""}<span class="sf-hook">${escH(o.hook)}</span><span class="sf-hook">THE JOB: ${escH(o.job)}</span></button>`).join("")
      : `<div class="sf-none">NO JOBS ON THE BOARD YET.</div>`;
    fx.querySelector(".sf-side").innerHTML = `<div class="sf-head">JOB BOARD</div>${board}${msg.played.length ? `<div class="sf-head">DONE</div><div class="sf-played">${msg.played.map((p) => escH(p.title)).join("<br>")}</div>` : ""}`;
    if (fresh) { fx.hidden = false; chirp(); }
  }
  const voteJob = (id) => id && send({ t: "sectorVote", story: id });
  $("sectorfx").addEventListener("click", (e) => {
    const job = e.target.closest("[data-job]");
    if (job) return voteJob(job.dataset.job);
    if (!e.target.closest(".sf-side, .sf-map")) $("sectorfx").hidden = true;
  });
  addEventListener("keydown", (e) => {
    if ($("sectorfx").hidden || !sector) return;
    if (e.key === "Escape") $("sectorfx").hidden = true;
    else if (/^[1-9]$/.test(e.key) && sector.offered[e.key - 1]) { e.preventDefault(); voteJob(sector.offered[e.key - 1].id); }
  });
  // The memorial: every character the crew has lost, as a CRT crew manifest. High Score is sessions survived (PSG 18.3).
  function renderMemorial() {
    const list = crew.filter(gone);
    $("memorialfx").querySelector(".mm-body").innerHTML = list.map((c) => `<div class="mm-row">${portraitHtml(c.portrait, "mm-face")}<div>
      <div class="mm-who">${escH(c.name.toUpperCase())}</div>
      <div>${escH(c.className.toUpperCase())} · HIGH SCORE ${c.highScore || 0}</div>
      <div>${escH((c.cond?.dead ? (c.cond.dead === "Warden" ? "MARKED DECEASED BY THE WARDEN" : `DIED: ${c.cond.dead}`) : "RETIRED FROM PLAY").toUpperCase())}${c.endedIn ? ` · ${escH(c.endedIn.toUpperCase())}` : ""}</div>
      ${c.finalWords ? `<div class="mm-final">FINAL TRANSMISSION: "${escH(c.finalWords.toUpperCase())}"</div>` : ""}
      ${c.epitaph ? `<div class="mm-epitaph">${escH(c.epitaph.toUpperCase())}</div>` : ""}</div></div>`).join("") || '<div class="sf-none">NOBODY YET.</div>';
  }
  $("hdr-memo").onclick = () => { renderMemorial(); $("memorialfx").hidden = !$("memorialfx").hidden; };
  $("memorialfx").addEventListener("click", (e) => { if (!e.target.closest(".mm-row")) $("memorialfx").hidden = true; });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("memorialfx").hidden) $("memorialfx").hidden = true; });

  // Death: the vitals line goes flat with a held tone, then the player may send one last line, spoken on every screen in their voice.
  let flatTimer = 0;
  function flatline() {
    const fx = $("flatline"), line = fx.querySelector("polyline"), title = fx.querySelector(".fl-title"), form = fx.querySelector(".fl-form");
    clearInterval(flatTimer);
    title.hidden = form.hidden = true;
    fx.hidden = false;
    const beat = [0, 0, 0, 0, -8, 30, -46, 70, -30, 8, 0, 0, 0, 0, 0, 0];
    let tick = 0;
    const pts = () => Array.from({ length: 80 }, (_, i) => { const k = tick * 3 - 79 + i; return `${i * 5},${50 + (k >= 0 && k < 48 ? beat[k % beat.length] : 0)}`; }).join(" ");
    flatTimer = setInterval(() => {
      tick++;
      line.setAttribute("points", pts());
      if (tick === 44) { FX.Sound.beep(960, 4, 0.05, "sine"); title.hidden = false; }
      if (tick === 80) { clearInterval(flatTimer); form.hidden = false; $("fl-text").focus(); }
    }, 70);
  }
  const closeFlat = () => { clearInterval(flatTimer); $("flatline").hidden = true; };
  $("flatline").querySelector(".fl-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("fl-text").value.trim();
    if (text) send({ t: "finalWords", text });
    $("fl-text").value = "";
    closeFlat();
  });
  $("fl-skip").onclick = closeFlat;
  function chirp() { FX.Sound.beep(520, 0.08, 0.05); setTimeout(() => FX.Sound.beep(780, 0.1, 0.05), 90); }
  function showImage({ title, name, src, credit = "" }) {
    if (!src) return FX.Sound.sting();
    const box = $("reveal");
    const rvTitle = box.querySelector(".rv-title"), t = String(title || name || "").toUpperCase();
    setLabel(rvTitle, t);
    const link = (t) => escH(t).replace(/(https?:\/\/[^\s<]+|[\w-]+(?:\.[\w-]+)+\/[^\s<]*)/g, (u) => `<a href="${u.startsWith("http") ? u : `https://${u}`}" target="_blank" rel="noopener">${u}</a>`);
    box.querySelector(".rv-pic").innerHTML = `<img src="${escH(src)}" alt="" referrerpolicy="no-referrer">`;
    box.querySelector(".rv-credit").innerHTML = credit ? link(credit) : "";
    box.hidden = false;
    renderSide();
    FX.Sound.sting();
  }
  function closeReveal() {
    if ($("reveal").hidden) return;
    $("reveal").hidden = true;
    renderSide();
  }
  $("reveal").addEventListener("click", (e) => { if (!e.target.closest("a")) closeReveal(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeReveal(); });
  $("planfx").addEventListener("click", () => { $("planfx").hidden = true; });

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

  function socketUrl() {
    const u = new URL(`ws?s=${encodeURIComponent(code)}`, location.href);
    u.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    if (stream) { u.searchParams.set("stream", "1"); return u; }
    const term = termId || ls.get(termKey());
    if (term) u.searchParams.set("term", term);
    return u;
  }

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
      bestRtt = Infinity;
      for (let i = 0; i < 4; i++) setTimeout(ping, i * 250);
    };
    ws.onclose = (ev) => {
      $("hdr-link").classList.add("down");
      if (stream && ev.code === 4003) {
        bootEl.classList.remove("gone");
        bootText.textContent = "STREAM LINK NOT RECOGNISED.\nCOPY IT AGAIN FROM THE WARDEN CONSOLE: SETTINGS > SESSION.\n";
        return;
      }
      if (ev.code === 4004) {
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
          if (msg.map) stationMap = msg.map;
          setTimeout(() => setIso(msg.iso || null));
          conds = msg.conds || {};
          setCrew(msg.crew, msg.claims, msg.played);
          if (mine()) ws.send(JSON.stringify({ t: "claim", id: myId }));
          for (const e of msg.log) {
            if (e.timing && e.kind !== "player" && (e.timing.end ?? Infinity) > serverNow()) enqueue(e);
            else renderInstant(e);
          }
          FX.sync(msg.effects.filter((e) => !(e.atEntry && e.seconds > 0) && e.type !== "sound"));
          Sfx.sync(msg.playing || []);
          busy = msg.busy;
          updateBusy();
          showRoll(msg.roll || null);
          setClocks(msg.clocks);
          setDocs(msg.handouts);
          applySolo(msg.solo);
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
          if (!$("crewpick").hidden) renderPicker();
          break;
        case "line": enqueue(msg.entry); break;
        case "part": onPart(msg); break;
        case "interrupt": onInterrupt(msg); break;
        case "terminalSet": setTerminal(msg.id, false); break;
        case "lineEnd": onLineEnd(msg); break;
        case "pong": onPong(msg); break;
        case "busy": busy = msg.busy; updateBusy(); break;
        case "effect": onEffect(msg.effect); break;
        case "roll": showRoll(msg.roll); break;
        case "crew": conds = msg.conds || {}; setCrew(msg.crew, msg.claims, msg.played); break;
        case "cg": Chargen.onMessage(msg); break;
        case "cgAccepted": Chargen.onAccepted(msg.id); break;
        case "wardenLog": onWardenLog(msg); break;
        case "streamMap": stationMap = msg.map; renderCastbar(); break;
        case "talking": talking = new Set(msg.ids); wardenTalking = !!msg.warden; showTalking(); break;
        case "isoMap": setIso(msg.map); break;
        case "rollResult": showRollResult(msg); break;
        case "panicFx": PanicFx.play(msg, { me: mine(), crew, input, focusInput: () => { if (!spectate && !input.disabled && document.body.classList.contains("panel-open") === false) input.focus(); } }); break;
        case "roomPlan": showPlan(msg); break;
        case "sector": showSector(msg); break;
        case "flatline": if (msg.id === myId) flatline(); break;
        case "showImage": showImage(msg); break;
        case "rollError": rbErr.textContent = String(msg.text || "").toUpperCase(); $("sr-err").textContent = rbErr.textContent; break;
        case "endEffect": dropCue(msg.id); FX.end(msg.id); break;
        case "sound": Sfx.play(msg.play); break;
        case "soundStop": msg.all ? Sfx.stopAll() : Sfx.stop(msg.pid); break;
        case "soundVolume": Sfx.setVolume(msg.pid, msg.volume); break;
      }
    };
  }
  if (spectate) connect();
})();
