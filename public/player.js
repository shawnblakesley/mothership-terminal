(() => {
  const params = new URLSearchParams(location.search);
  const spectate = params.has("spectate");
  const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  let code = normCode(params.get("s"));

  const $ = (id) => document.getElementById(id);
  const linesEl = $("lines"), screenEl = $("screen"), input = $("in"), form = $("inputrow");
  const caret = $("caret"), busyEl = $("busy"), promptEl = $("prompt");

  let header = { stationName: "----", accessLevel: "GUEST", theme: "green" };
  let ws, typingQueue = [], typing = false, busy = false;
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
      await printBoot(["HV-CORE OS v4.1  (C) HOLLIS-VANE SYSTEMS", "MEMORY CHECK ............ 65536K OK", "NEURAL CORE ............. ONLINE"]);
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
    promptEl.textContent = `${h.accessLevel}@${h.stationName}>`;
    document.body.className = `theme-${h.theme || "green"}`;
    for (const el of linesEl.querySelectorAll(".line.player")) el.dataset.prompt = el.dataset.prompt || "";
    placeCaret();
  }
  setInterval(() => { $("hdr-clock").textContent = new Date().toTimeString().slice(0, 8); }, 1000);

  // ------------------------------------------------------------ lines
  // Human (neural) voices are slow to generate, so they're fetched one text line at a
  // time: the first line plays while the next is generated. (Same split as the
  // server's speechParts in voices.js.)
  //
  // Returns the line's text split into the pieces being spoken, each with the
  // voice's { started, ended } handle, so typeNext() can reveal the text in step
  // with the voice. Null when nothing will be spoken (sound off, not unlocked...).
  function speak(entry) {
    if (muted || volume === 0) return null; // muted terminals don't wait on silent audio
    const v = voiceOf(entry);
    const url = `api/sessions/${code}/tts/${entry.id}`;
    if (!v?.chunked) {
      const handle = Voice.say(url, v?.fx);
      return handle && [{ text: entry.text, handle }];
    }
    // One clip per non-empty text line; blank lines ride along with the next one.
    const pieces = [];
    let pending = "";
    for (const row of entry.text.split("\n")) {
      if (!row.trim()) { pending += `${row}\n`; continue; }
      const handle = Voice.say(`${url}?part=${pieces.length}`, v.fx);
      if (!handle) return null;
      pieces.push({ text: pending + row, handle });
      pending = "";
    }
    if (pending && pieces.length) pieces.at(-1).text += `\n${pending.replace(/\n$/, "")}`;
    return pieces.length ? pieces : null;
  }

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

  function renderInstant(entry) {
    const div = makeLine(entry);
    div.textContent = entry.text;
    div.classList.add("done");
    linesEl.append(div);
  }

  function enqueue(entry) {
    if (entry.kind === "player") {
      renderInstant(entry);
      scrollDown();
      return;
    }
    // Speech is requested now (so audio starts generating right away); the text
    // waits for it in typeNext().
    entry.speech = header.tts && entry.kind !== "roll" ? speak(entry) : null;
    cueState.set(entry.id, "queued");
    typingQueue.push(entry);
    if (!typing) typeNext();
  }

  // Type `text` onto the end of `div`, a few characters at a time.
  function typeInto(div, text) {
    return new Promise((resolve) => {
      const start = div.textContent;
      let i = 0;
      // Faster for long dumps so the table doesn't take forever.
      const perTick = text.length > 600 ? 6 : text.length > 200 ? 3 : 1;
      const step = () => {
        i = Math.min(text.length, i + perTick);
        div.textContent = start + text.slice(0, i);
        if (i % 3 === 0) FX.Sound.tick();
        scrollDown();
        if (i < text.length) setTimeout(step, text[i - 1] === "\n" ? 60 : 14);
        else resolve();
      };
      step();
    });
  }

  // ------------------------------------------------------------ effect cues
  // The agent can time an effect to a line ("before" it starts, or "after" the
  // last line). The effect arrives right after its line, while that line is
  // still queued behind earlier text and voices, so it waits here until the
  // line comes up, then runs for its own duration.
  const cueState = new Map(); // entry id -> "queued" | "showing" | "done"
  const heldCues = new Map(); // entry id -> { before: [], after: [] }

  function runEffect(effect) {
    FX.start(effect);
    if (effect.atEntry && effect.seconds > 0) setTimeout(() => FX.end(effect.id), effect.seconds * 1000);
  }

  function onEffect(effect) {
    const st = effect.atEntry ? cueState.get(effect.atEntry) : null;
    const due = !st || st === "done" || (st === "showing" && effect.when === "before");
    if (due) return runEffect(effect);
    const h = heldCues.get(effect.atEntry) || { before: [], after: [] };
    h[effect.when === "after" ? "after" : "before"].push(effect);
    heldCues.set(effect.atEntry, h);
  }

  // Fires the held effects; returns how long a beat should pause the dialogue
  // (effect-only beats like a blackout last for their duration, up to 10s).
  function releaseCues(id, when) {
    const h = heldCues.get(id);
    if (!h) return 0;
    let pause = 0;
    for (const e of h[when].splice(0)) {
      runEffect(e);
      if (e.hold) pause = Math.max(pause, Math.min(10, e.seconds || 3));
    }
    return pause;
  }

  function dropCue(fxId) {
    for (const h of heldCues.values()) for (const k of ["before", "after"]) h[k] = h[k].filter((e) => e.id !== fxId);
  }

  async function typeNext() {
    const entry = typingQueue.shift();
    if (!entry) { typing = false; updateBusy(); return; }
    typing = true;
    updateBusy();
    const div = makeLine(entry);
    div.classList.add("typing");
    linesEl.append(div);
    cueState.set(entry.id, "showing");
    // Effects timed to the start of this line; a beat (e.g. a blackout) pauses first.
    const pause = releaseCues(entry.id, "before");
    if (pause) await new Promise((r) => setTimeout(r, pause * 1000));
    if (entry.kind !== "terminal") FX.Sound.beep(entry.kind === "system" ? 520 : 380, 0.15, 0.08);
    if (entry.speech) {
      // Spoken: each piece appears as its voice starts saying it, and the next
      // piece (or line) waits until the voice has finished.
      for (const [i, piece] of entry.speech.entries()) {
        await piece.handle.started;
        const [, played] = await Promise.all([typeInto(div, (i ? "\n" : "") + piece.text), piece.handle.ended]);
        // The voice couldn't play (blackout, failure): still give it reading time.
        if (!played) await new Promise((r) => setTimeout(r, Math.min(6000, 600 + piece.text.length * 45)));
      }
    } else {
      await typeInto(div, entry.text);
    }
    div.classList.remove("typing");
    div.classList.add("done");
    cueState.set(entry.id, "done");
    releaseCues(entry.id, "after");
    setTimeout(typeNext, 120);
  }

  function scrollDown() { screenEl.scrollTop = screenEl.scrollHeight; }

  function updateBusy() {
    busyEl.hidden = !(busy && !typing);
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
  screenEl.addEventListener("click", () => { if (!getSelection().toString()) input.focus(); });

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
    rbStat.value = "";
    rbDice.value = "";
    rbErr.textContent = "";
    for (const el of rollbox.querySelectorAll("input, button")) el.disabled = spectate;
    FX.Sound.beep(660, 0.12, 0.07);
    setTimeout(() => FX.Sound.beep(880, 0.16, 0.07), 140);
    scrollDown();
    if (!spectate) (roll.statKnown ? $("rb-roll") : rbStat).focus();
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
    ws.onopen = () => $("hdr-link").classList.remove("down");
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
          typingQueue = [];
          Voice.stop();
          linesEl.innerHTML = "";
          msg.log.forEach(renderInstant);
          cueState.clear();
          heldCues.clear();
          // Timed cues were played when they happened; don't replay them on reload.
          FX.sync(msg.effects.filter((e) => !(e.atEntry && e.seconds > 0)));
          Sfx.sync(msg.playing || []); // loops (ambience, a growl) that are running
          busy = msg.busy;
          updateBusy();
          showRoll(msg.roll || null);
          scrollDown();
          break;
        case "header":
          if (header.tts && !msg.header.tts) Voice.stop();
          applyHeader(msg.header);
          break;
        case "line": enqueue(msg.entry); break;
        case "busy": busy = msg.busy; updateBusy(); break;
        case "effect": onEffect(msg.effect); break;
        case "roll": showRoll(msg.roll); break;
        case "rollResult": showRollResult(msg); break;
        case "rollError": rbErr.textContent = String(msg.text || "").toUpperCase(); break;
        case "endEffect": dropCue(msg.id); FX.end(msg.id); break;
        case "sound": Sfx.play(msg.play); break;
        case "soundStop": msg.all ? Sfx.stopAll() : Sfx.stop(msg.pid); break;
        case "soundVolume": Sfx.setVolume(msg.pid, msg.volume); break;
      }
    };
  }
  if (spectate) connect();
})();
