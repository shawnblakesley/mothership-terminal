(() => {
  const params = new URLSearchParams(location.search);
  const spectate = params.has("spectate");
  const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  let code = normCode(params.get("s"));

  const $ = (id) => document.getElementById(id);
  const linesEl = $("lines"), screenEl = $("screen"), input = $("in"), form = $("inputrow");
  const caret = $("caret"), busyEl = $("busy"), promptEl = $("prompt");

  let header = { stationName: "----", accessLevel: "GUEST", theme: "green" };
  let ws, busy = false;
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

  // Turn on the terminal: unlock audio (needs a key press/click), CRT power-on.
  function powerOn() {
    FX.Sound.unlock();
    FX.Sound.beep(1200, 0.05);
    bootEl.classList.add("gone");
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
      powerOn(); // submitting the form counts as the key press browsers need for audio
      connect();
    } catch (err) {
      joinErr.textContent = err.message;
    }
  });

  if (spectate) {
    bootEl.classList.add("gone");
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
        $("boot-press").hidden = false;
        const go = () => {
          removeEventListener("keydown", go);
          bootEl.removeEventListener("click", go);
          powerOn();
        };
        addEventListener("keydown", go);
        bootEl.addEventListener("click", go);
        connect();
      } catch (err) {
        askForCode(err.message);
      }
    })();
  }

  // ------------------------------------------------------------ header / clock
  function applyHeader(h) {
    header = h;
    $("hdr-station").textContent = h.stationName;
    $("hdr-access").textContent = h.accessLevel;
    $("hdr-os").textContent = `${h.voices?.terminal?.name || "TERMINAL"} OS v4.1`;
    promptEl.textContent = `${h.accessLevel}@${h.stationName}>`;
    applyTerminal();
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
  function ping() { if (ws?.readyState === 1) ws.send(JSON.stringify({ t: "ping", c: Date.now() })); }
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

  function makeLine(entry) {
    const div = document.createElement("div");
    div.className = `line ${entry.kind}`;
    div.dataset.id = entry.id;
    if (entry.kind === "player") {
      div.dataset.prompt = `${header.accessLevel}@${header.stationName}> `;
      return div;
    }
    if (entry.kind === "roll") { div.classList.add("roll"); return div; }
    const v = voiceOf(entry);
    div.classList.add(`style-${v?.style || (entry.kind === "system" ? "boxed" : "plain")}`);
    // A shared voice (the intercom) also shows who is speaking: "INTERCOM · SALK: ".
    if (v?.style === "label") div.dataset.label = `${v.name}${entry.character ? ` · ${entry.character.toUpperCase()}` : ""}: `;
    if (v?.color) {
      div.style.color = v.color;
      div.style.borderColor = v.color;
      div.style.textShadow = `0 0 2px ${v.color}88, 0 0 9px ${v.color}66`;
    }
    return div;
  }

  // Lines can read differently per character (variants): this screen shows the
  // one for its crew file, if any. Null when the line isn't for this screen at all.
  function forMe(entry) {
    const vi = (entry.variants || []).findIndex((v) => myId && v.to.includes(myId));
    if (vi >= 0) return { ...entry, text: entry.variants[vi].text, vi };
    return entry.text || entry.kind === "player" ? entry : null;
  }

  // The text pieces a line is spoken in: one per text line for human voices
  // (blank lines ride along with the next), else the whole text. Same split as
  // the server's speechParts.
  function piecesOf(entry) {
    if (!voiceOf(entry)?.chunked || entry.kind === "roll" || entry.kind === "player") return [entry.text];
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
    if (voiceOf(entry)?.chunked) q.set("part", part);
    const qs = q.toString();
    return `api/sessions/${code}/tts/${entry.id}${qs ? `?${qs}` : ""}`;
  }

  function renderInstant(raw) {
    const entry = forMe(raw);
    if (!entry) return;
    const div = makeLine(entry);
    div.textContent = entry.text;
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
    const v = !entry ? -1 : entry.vi >= 0 ? entry.vi + 1 : 0;
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
    releaseCues(play.raw.id, "before");
  }

  function schedulePart(play, part) {
    // Fetch the clip ahead so it's ready on time (the server has already made it).
    const audio = part.audio && canHear() ? Voice.load(clipUrl(play.entry, part.i)) : null;
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
    if (audio) audio.then((buf) => play.gen === lineGen && Voice.playNow(buf, voiceOf(play.entry)?.fx, serverNow() - part.at));
    // Type it out within the piece's time (all at once if this screen is late).
    if (late > part.dur * 0.6) { play.div.textContent += text; scrollDown(); }
    else typeInto(play.div, text, part.dur - Math.max(0, late));
    if (part.last) setTimeout(() => finishLine(play), Math.max(0, part.dur - Math.max(0, late)));
  }

  function finishLine(play) {
    if (play.finished || play.gen !== lineGen) return;
    play.finished = true;
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
      if (play.div) play.div.textContent += " —";
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

  function updateBusy() {
    busyEl.hidden = !(busy && !plays.size);
    if (!busyEl.hidden) scrollDown();
  }

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

  // Nothing speaks during a blackout; lines that arrive then stay silent.
  Voice.setBlocked(() => FX.has("blackout"));

  function lockedOut() { return FX.has("lockout"); }
  document.addEventListener("fxchange", () => {
    // Power cut: silence what is being said now. Queued lines wait for the
    // lights to come back (Voice is blocked meanwhile), then carry on.
    if (FX.has("blackout")) Voice.interrupt();
    form.classList.toggle("disabled", lockedOut());
    input.disabled = lockedOut();
    if (!lockedOut() && !spectate) input.focus();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || lockedOut()) return;
    history.unshift(text);
    histIdx = -1;
    input.value = "";
    placeCaret();
    FX.Sound.beep(1400, 0.03, 0.04);
    if (/^(clear|cls)$/i.test(text)) { linesEl.innerHTML = ""; return; }
    ws?.readyState === 1 && ws.send(JSON.stringify({ t: "input", text }));
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
  screenEl.addEventListener("click", () => { if (!getSelection().toString() && !document.body.classList.contains("panel-open")) input.focus(); });

  // ------------------------------------------------------------ volume
  // Ten-segment retro meter, top right. Click/drag a segment, scroll, or use
  // arrow keys; click VOL to mute. Remembered per device.
  const volBars = $("vol-bars"), volBtn = $("vol-mute");
  let volume = 0.8, muted = false;
  try {
    const saved = JSON.parse(localStorage.getItem("terminal-volume") || "null");
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
    try { localStorage.setItem("terminal-volume", JSON.stringify({ volume, muted })); } catch {}
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
  const crewKey = () => `crew:${code}`;
  const mine = () => crew.find((c) => c.id === myId) || null;
  const escH = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function openPanel(id) {
    for (const p of ["crewpick", "crewfile", "selfroll", "termpick"]) $(p).hidden = p !== id;
    document.body.classList.toggle("panel-open", !!id);
    // (Not before power-on: the key that wakes the terminal would also press the button.)
    if (id === "crewpick" && bootEl.classList.contains("gone")) $("crewpick-list").querySelector("button")?.focus();
    if (!id && !spectate) input.focus();
  }

  function setCrew(list, taken) {
    crew = list || [];
    claims = taken || {};
    if (myId && !mine()) {
      // Their file was removed (or a new story began): choose again.
      myId = null;
      if (!spectate && crew.length) setTimeout(() => { renderPicker(); openPanel("crewpick"); });
    }
    const pc = mine();
    $("hdr-file").hidden = $("hdr-file-sep").hidden = spectate || !crew.length;
    $("hdr-file").textContent = pc ? `FILE: ${shortName(pc)}` : "FILE: NONE";
    if (!$("crewpick").hidden) renderPicker();
    if (!$("crewfile").hidden) renderFile();
    renderSide();
  }
  // A nickname in quotes ("Rook", 'Beck') if there is one, else the first name.
  const shortName = (c) => (c.name.match(/["'“‘]([^"'”’]+)["'”’]/)?.[1] || c.name.split(" ")[0]).toUpperCase();

  function renderPicker() {
    $("crewpick-list").innerHTML = crew.map((c, i) => {
      const others = (claims[c.id] || 0) - (c.id === myId ? 1 : 0);
      return `<li><button type="button" class="p-btn pick" data-id="${escH(c.id)}">[${i + 1}] ${escH(c.name.toUpperCase())}</button>
        <span class="p-dim"> · ${escH(c.className.toUpperCase())} · ${escH(c.role.toUpperCase())}${others > 0 ? " · <b>IN USE</b>" : ""}${c.id === myId ? " · <b>YOU</b>" : ""}</span>
        <div class="p-dim p-crime">${escH(c.crime)}</div></li>`;
    }).join("");
  }

  // A Stat/Save the player can click to roll (if the Warden allows it).
  const statBtn = (k, v, short) => header.selfRolls && !spectate
    ? `<button type="button" class="p-btn s-roll" data-check="${k}" title="Roll ${k}">${short ? `<span class="s-k">${k.slice(0, 3).toUpperCase()}</span> ` : `<span class="p-dim">${k.toUpperCase()}</span> `}${v}</button>`
    : (short ? `<span class="s-k">${k.slice(0, 3).toUpperCase()}</span><span class="s-v">${v}</span>` : `<span class="p-stat"><span class="p-dim">${k.toUpperCase()}</span> ${v}</span>`);
  // Health/wounds/stress, with -/+ when players track their own.
  const vitalCtl = (field, shown) => header.vitals && !spectate
    ? `<span class="v-ctl"><button type="button" class="p-btn" data-vital="${field}" data-d="-1" aria-label="${field} down">[-]</button> ${shown} <button type="button" class="p-btn" data-vital="${field}" data-d="1" aria-label="${field} up">[+]</button></span>`
    : shown;
  function vitalsChange(field, d) {
    const c = mine();
    if (!c) return;
    const cur = field === "stress" ? c.stress : c[field].current;
    ws?.readyState === 1 && ws.send(JSON.stringify({ t: "vitals", field, value: cur + d }));
    FX.Sound.beep(d > 0 ? 760 : 520, 0.05, 0.05);
  }
  for (const el of ["side", "crewfile-body"]) {
    $(el).addEventListener("click", (e) => {
      const v = e.target.closest("[data-vital]");
      if (v) return vitalsChange(v.dataset.vital, Number(v.dataset.d));
      const s = e.target.closest("[data-check]");
      if (s) openSelfRoll(s.dataset.check);
    });
  }

  function renderFile() {
    const c = mine();
    if (!c) { $("crewfile-body").innerHTML = '<div class="p-dim">NO CREW FILE SELECTED.</div>'; return; }
    const row = (obj) => Object.entries(obj).map(([k, v]) => `<span class="p-stat">${statBtn(k, v)}</span>`).join("");
    $("crewfile-body").innerHTML = `
      <div class="p-title">■ CREW FILE: ${escH(c.name.toUpperCase())} ■</div>
      <div class="p-dim">${escH([c.pronouns, c.className, c.role].filter(Boolean).join(" · ").toUpperCase())}</div>
      <div class="p-sec">CONVICTION: ${escH(c.crime)}</div>
      <div class="p-sec p-text">${escH(c.backstory)}</div>
      <div class="p-sec"><span class="p-dim">STATS</span> ${row(c.stats)}</div>
      <div class="p-sec"><span class="p-dim">SAVES</span> ${row(c.saves)}</div>
      <div class="p-sec"><span class="p-stat"><span class="p-dim">HEALTH</span> ${vitalCtl("health", `${c.health.current}/${c.health.max}`)}</span><span class="p-stat"><span class="p-dim">WOUNDS</span> ${vitalCtl("wounds", `${c.wounds.current}/${c.wounds.max}`)}</span><span class="p-stat"><span class="p-dim">STRESS</span> ${vitalCtl("stress", c.stress)}</span></div>
      ${header.selfRolls && !spectate ? '<div class="p-dim p-sec">CLICK A STAT OR SAVE TO ROLL IT.</div>' : ""}
      <div class="p-sec"><span class="p-dim">SKILLS</span> ${escH(c.skills.join(" · ") || "NONE")}</div>
      <div class="p-sec"><span class="p-dim">LOADOUT</span> ${escH(c.loadout)}</div>
      ${c.trinket ? `<div class="p-sec"><span class="p-dim">TRINKET</span> ${escH(c.trinket)}</div>` : ""}
      ${c.patch ? `<div class="p-sec"><span class="p-dim">PATCH</span> ${escH(c.patch)}</div>` : ""}`;
  }

  // ---- the sidebar: the player's sheet beside the terminal (on wide screens).
  let sideOpen = true;
  try { sideOpen = localStorage.getItem("side-open") !== "0"; } catch {}
  const wide = () => matchMedia("(min-width: 900px)").matches;
  const blocks = (n, max, cap = 20) => "■".repeat(Math.min(n, cap)) + "□".repeat(Math.max(0, Math.min(max, cap) - n));

  function renderSide() {
    const c = mine();
    const side = $("side");
    side.hidden = !c || !sideOpen || !wide() || spectate;
    $("hdr-file").classList.toggle("on", !side.hidden);
    if (side.hidden) return;
    const grid = (obj) => header.selfRolls && !spectate
      ? `<div class="s-rolls">${Object.entries(obj).map(([k, v]) => statBtn(k, v, true)).join("")}</div>`
      : `<div class="s-grid">${Object.entries(obj).map(([k, v]) => statBtn(k, v, true)).join("")}</div>`;
    side.innerHTML = `
      <div class="s-name">${escH(c.name.toUpperCase())}</div>
      <div class="p-dim">${escH([c.className, c.role].filter(Boolean).join(" · ").toUpperCase())}</div>
      <div class="s-sec"><span class="p-dim">STATS${header.selfRolls && !spectate ? " · CLICK TO ROLL" : ""}</span>${grid(c.stats)}</div>
      <div class="s-sec"><span class="p-dim">SAVES</span>${grid(c.saves)}</div>
      <div class="s-sec s-meters">
        <div><span class="p-dim">HEALTH</span> ${vitalCtl("health", `${c.health.current}/${c.health.max}`)}<div class="s-bar">${blocks(c.health.current, c.health.max)}</div></div>
        <div><span class="p-dim">WOUNDS</span> ${vitalCtl("wounds", `${c.wounds.current}/${c.wounds.max}`)}<div class="s-bar">${blocks(c.wounds.current, c.wounds.max)}</div></div>
        <div><span class="p-dim">STRESS</span> ${vitalCtl("stress", c.stress)}<div class="s-bar${c.stress >= 10 ? " hot" : ""}">${blocks(c.stress, Math.max(10, c.stress))}</div></div>
      </div>
      <div class="s-sec"><span class="p-dim">SKILLS</span><div>${escH(c.skills.join(" · ") || "NONE")}</div></div>
      <div class="s-sec"><span class="p-dim">LOADOUT</span><div>${escH(c.loadout)}</div></div>
      ${c.trinket ? `<div class="s-sec"><span class="p-dim">TRINKET</span><div>${escH(c.trinket)}</div></div>` : ""}
      <div class="s-sec"><button type="button" class="p-btn" id="side-more">[ FULL FILE ]</button> <button type="button" class="p-btn" id="side-hide">[ HIDE ]</button></div>`;
  }
  addEventListener("resize", () => renderSide());
  $("side").addEventListener("click", (e) => {
    if (e.target.id === "side-more") { renderFile(); openPanel("crewfile"); }
    if (e.target.id === "side-hide") setSide(false);
  });
  function setSide(open) {
    sideOpen = open;
    try { localStorage.setItem("side-open", open ? "1" : "0"); } catch {}
    renderSide();
    if (!spectate) input.focus();
  }

  function claim(id) {
    myId = id;
    try { localStorage.setItem(crewKey(), id || "none"); } catch {}
    ws?.readyState === 1 && ws.send(JSON.stringify({ t: "claim", id }));
    setCrew(crew, claims);
    FX.Sound.beep(880, 0.06, 0.05);
  }

  // After (re)connecting: reclaim this device's file, or ask which one is theirs.
  function crewOnInit() {
    if (spectate || !crew.length) return;
    let saved = null;
    try { saved = localStorage.getItem(crewKey()); } catch {}
    if (saved === "none") return claim(null);
    if (saved && crew.some((c) => c.id === saved)) return claim(saved);
    renderPicker();
    openPanel("crewpick");
  }

  $("crewpick-list").addEventListener("click", (e) => {
    const id = e.target.closest("[data-id]")?.dataset.id;
    if (!id) return;
    claim(id);
    renderFile();
    openPanel("crewfile");
  });
  addEventListener("keydown", (e) => {
    if ($("crewpick").hidden || !bootEl.classList.contains("gone") || e.ctrlKey || e.metaKey || e.altKey) return; // (not the key that powers the terminal on)
    const c = crew[Number(e.key) - 1];
    if (c) { e.preventDefault(); claim(c.id); renderFile(); openPanel("crewfile"); $("crewfile-close").focus(); }
  });
  $("crewpick-none").onclick = () => { claim(null); openPanel(null); };
  $("hdr-file").onclick = () => {
    if (mine() && wide() && $("crewfile").hidden && $("crewpick").hidden) return setSide(!sideOpen);
    renderFile();
    openPanel($("crewfile").hidden ? "crewfile" : null);
  };
  $("crewfile-close").onclick = () => openPanel(null);
  $("crewfile-change").onclick = () => { renderPicker(); openPanel("crewpick"); $("crewpick-list").querySelector("button")?.focus(); };
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
    let saved = null;
    try { saved = localStorage.getItem(termKey()); } catch {}
    const t = terminals().find((x) => x.id === (termId || saved)) || terminals().find((x) => x.open);
    if (t) setTerminal(t.id, true);
  }
  function setTerminal(id, tell) {
    termId = id;
    try { localStorage.setItem(termKey(), id); } catch {}
    if (tell) ws?.readyState === 1 && ws.send(JSON.stringify({ t: "terminal", id }));
    applyTerminal();
  }

  // Theme, screen styles (flicker, dim, grime, handheld) and permanent blood/goo/crack.
  let decor = "";
  function applyTerminal() {
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

  // ---- rolling your own Stat/Save: pick a relevant skill (optional), then roll.
  const LEVELS = [["trained", "TRAINED +10", 10], ["expert", "EXPERT +15", 15], ["master", "MASTER +20", 20]];
  const ADV = [["none", "NORMAL"], ["advantage", "[+] ADVANTAGE"], ["disadvantage", "[-] DISADVANTAGE"]];
  let sr = null; // { check, skill, level, adv }

  function openSelfRoll(check) {
    if (!mine() || !header.selfRolls) return;
    sr = { check, skill: "", level: "trained", adv: "none" };
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
    const bonus = sr.skill ? LEVELS.find((l) => l[0] === sr.level)[2] : 0;
    const pick = (on, attrs, label) => `<button type="button" class="p-btn${on ? " on" : ""}" ${attrs}>${on ? "[■]" : "[ ]"} ${escH(label)}</button>`;
    $("sr-title").textContent = `■ ROLL: ${sr.check.toUpperCase()} (${base}) ■`;
    $("sr-skills").innerHTML = [pick(!sr.skill, 'data-skill=""', "NONE"), ...c.skills.map((s) => pick(sr.skill === s, `data-skill="${escH(s)}"`, s.toUpperCase()))].join(" ");
    $("sr-level-row").hidden = !sr.skill;
    $("sr-levels").innerHTML = LEVELS.map(([id, label]) => pick(sr.level === id, `data-level="${id}"`, label)).join(" ");
    $("sr-adv").innerHTML = ADV.map(([id, label]) => pick(sr.adv === id, `data-adv="${id}"`, label)).join(" ");
    $("sr-target").textContent = `ROLL UNDER ${base + bonus} ON D100${sr.adv === "none" ? "" : " (ROLL TWICE)"}.`;
    $("sr-dice").placeholder = sr.adv === "none" ? "47" : "47 82";
  }
  $("selfroll").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !sr) return;
    if (b.dataset.skill !== undefined) sr.skill = b.dataset.skill;
    else if (b.dataset.level) sr.level = b.dataset.level;
    else if (b.dataset.adv) sr.adv = b.dataset.adv;
    else return;
    renderSelfRoll();
    $("selfroll").querySelector(`[data-${b.dataset.skill !== undefined ? "skill" : b.dataset.level ? "level" : "adv"}="${CSS.escape(b.dataset.skill ?? b.dataset.level ?? b.dataset.adv)}"]`)?.focus();
  });
  function sendSelfRoll(manual) {
    if (!sr) return;
    const msg = { t: "selfRoll", check: sr.check, skill: sr.skill, skillLevel: sr.level, advantage: sr.adv };
    if (manual) {
      const dice = $("sr-dice").value.split(/[^0-9]+/).filter(Boolean).map(Number);
      const need = sr.adv === "none" ? 1 : 2;
      if (dice.length !== need || dice.some((d) => d > 99)) {
        $("sr-err").textContent = need === 1 ? "ENTER ONE D100 ROLL (00-99)." : "ENTER BOTH D100 ROLLS, E.G. 47 82.";
        return $("sr-dice").focus();
      }
      Object.assign(msg, { manual: true, dice });
    }
    ws?.readyState === 1 && ws.send(JSON.stringify(msg));
    sr = null;
    openPanel(null);
  }
  $("sr-form").addEventListener("submit", (e) => { e.preventDefault(); sendSelfRoll($("sr-dice").value.trim() !== ""); });
  $("sr-enter").onclick = () => sendSelfRoll(true);
  $("sr-cancel").onclick = () => { sr = null; openPanel(null); };
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("selfroll").hidden) { sr = null; openPanel(null); } });

  // ------------------------------------------------------------ ability rolls
  // The Warden calls for a Mothership check/save; the players enter their Stat
  // (unless the Warden already set it) and either roll here or type their dice.
  const rollbox = $("rollbox"), rbStat = $("rb-stat"), rbDice = $("rb-dice"), rbErr = $("rb-err");
  let curRoll = null;

  function showRoll(roll) {
    curRoll = roll;
    rollbox.hidden = !roll;
    if (!roll) { if (!spectate) input.focus(); return; }
    $("rb-label").textContent = [roll.label, roll.skill].filter(Boolean).join(" · ");
    $("rb-reason").textContent = roll.reason ? roll.reason.toUpperCase() : "";
    $("rb-stat-row").hidden = roll.statKnown;
    $("rb-stat-name").textContent = `YOUR ${roll.statName.toUpperCase()}${roll.bonus ? ` (SKILL +${roll.bonus} IS ADDED)` : ""}`;
    rbDice.placeholder = roll.advantage === "none" ? "47" : "47 82";
    // Their crew file knows the number: fill it in (they can still change it).
    const own = mine();
    rbStat.value = own && !roll.statKnown ? String(own.stats[roll.check] ?? own.saves[roll.check] ?? "") : "";
    rbDice.value = "";
    if (!$("crewfile").hidden || !$("crewpick").hidden) openPanel(null);
    rbErr.textContent = "";
    for (const el of rollbox.querySelectorAll("input, button")) el.disabled = spectate;
    FX.Sound.beep(660, 0.12, 0.07);
    setTimeout(() => FX.Sound.beep(880, 0.16, 0.07), 140);
    scrollDown();
    if (!spectate) (roll.statKnown || rbStat.value ? $("rb-roll") : rbStat).focus();
  }

  function sendRoll(manual) {
    if (!curRoll) return;
    const stat = rbStat.value.trim();
    if (!curRoll.statKnown && !/^\d{1,2}$/.test(stat)) {
      rbErr.textContent = `ENTER YOUR ${curRoll.statName.toUpperCase()} FIRST.`;
      return rbStat.focus();
    }
    const msg = { t: "roll", id: curRoll.id, stat: Number(stat) };
    if (manual) {
      const dice = rbDice.value.split(/[^0-9]+/).filter(Boolean).map(Number);
      const need = curRoll.advantage === "none" ? 1 : 2;
      if (dice.length !== need || dice.some((d) => d > 99)) {
        rbErr.textContent = need === 1 ? "ENTER ONE D100 ROLL (00-99)." : "ENTER BOTH D100 ROLLS, E.G. 47 82.";
        return rbDice.focus();
      }
      Object.assign(msg, { manual: true, dice });
    }
    rbErr.textContent = "ROLLING...";
    ws?.readyState === 1 && ws.send(JSON.stringify(msg));
  }

  $("rb-form").addEventListener("submit", (e) => { e.preventDefault(); sendRoll(rbDice.value.trim() !== ""); });
  $("rb-enter").addEventListener("click", () => sendRoll(true));
  rbDice.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendRoll(true); } });

  // Big dice tumble, then the verdict.
  function showRollResult({ result, label }) {
    const fx = $("rollfx"), diceEl = fx.querySelector(".rf-dice"), outEl = fx.querySelector(".rf-out");
    const pad = (d) => String(d).padStart(2, "0");
    fx.className = "rollfx";
    fx.hidden = false;
    outEl.textContent = label;
    let n = 0;
    const tumble = setInterval(() => {
      diceEl.textContent = result.dice.map(() => pad(Math.floor(Math.random() * 100))).join(" ");
      if (n++ % 2 === 0) FX.Sound.tick();
    }, 60);
    setTimeout(() => {
      clearInterval(tumble);
      diceEl.textContent = result.dice.length > 1 ? `${result.dice.map(pad).join(" / ")} → ${pad(result.used)}` : pad(result.used);
      outEl.textContent = `${result.outcome.toUpperCase()} (UNDER ${result.target})${result.success ? "" : " · +1 STRESS"}`;
      fx.classList.add(result.success ? "pass" : "fail");
      if (result.critical) fx.classList.add("crit");
      if (result.success) { FX.Sound.beep(880, 0.12, 0.08); setTimeout(() => FX.Sound.beep(1320, 0.2, 0.08), 120); }
      else { FX.Sound.beep(220, 0.3, 0.1); setTimeout(() => FX.Sound.beep(160, 0.4, 0.1), 260); }
    }, 1300);
    setTimeout(() => { fx.hidden = true; }, 5200);
  }

  // ------------------------------------------------------------ socket
  // The socket lives next to this page (works under any mount point, e.g. /mothership/).
  function socketUrl() {
    const u = new URL(`ws?s=${encodeURIComponent(code)}`, location.href);
    u.protocol = location.protocol === "https:" ? "wss:" : "ws:";
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
      // Sync this screen's clock with the server's (a few tries; the quickest wins).
      bestRtt = Infinity;
      for (let i = 0; i < 4; i++) setTimeout(ping, i * 250);
    };
    ws.onclose = (ev) => {
      $("hdr-link").classList.add("down");
      if (ev.code === 4004) {
        // The session ended (or expired): back to the code prompt.
        if (spectate) return;
        bootEl.classList.remove("gone");
        bootText.textContent = "SESSION TERMINATED.\n\n";
        $("boot-press").hidden = true;
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
          cueState.clear();
          heldCues.clear();
          // Our crew file first: lines can read differently for it.
          setCrew(msg.crew, msg.claims);
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
          // First visit, or a new story replaced the crew: reclaim a remembered file or pick one.
          if (!mine()) crewOnInit();
          terminalOnInit();
          scrollDown();
          break;
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
        case "crew": setCrew(msg.crew, msg.claims); break;
        case "rollResult": showRollResult(msg); break;
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
