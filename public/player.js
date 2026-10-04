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
  function speak(entry) {
    const v = voiceOf(entry);
    const url = `api/sessions/${code}/tts/${entry.id}`;
    if (!v?.chunked) return Voice.say(url, v?.fx);
    const parts = entry.text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    parts.forEach((_, i) => Voice.say(`${url}?part=${i}`, v.fx));
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
    const v = voiceOf(entry);
    div.classList.add(`style-${v?.style || (entry.kind === "system" ? "boxed" : "plain")}`);
    if (v?.style === "label") div.dataset.label = `${v.name}: `;
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
    typingQueue.push(entry);
    if (!typing) typeNext();
    if (header.tts) speak(entry);
  }

  function typeNext() {
    const entry = typingQueue.shift();
    if (!entry) { typing = false; updateBusy(); return; }
    typing = true;
    updateBusy();
    const div = makeLine(entry);
    div.classList.add("typing");
    linesEl.append(div);
    if (entry.kind !== "terminal") FX.Sound.beep(entry.kind === "system" ? 520 : 380, 0.15, 0.08);
    const text = entry.text;
    let i = 0;
    // Faster for long dumps so the table doesn't take forever.
    const perTick = text.length > 600 ? 6 : text.length > 200 ? 3 : 1;
    const step = () => {
      i = Math.min(text.length, i + perTick);
      div.textContent = text.slice(0, i);
      if (i % 3 === 0) FX.Sound.tick();
      scrollDown();
      if (i < text.length) setTimeout(step, text[i - 1] === "\n" ? 60 : 14);
      else {
        div.classList.remove("typing");
        div.classList.add("done");
        setTimeout(typeNext, 120);
      }
    };
    step();
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
    if (FX.has("blackout")) Voice.stop(); // power cut kills every voice, queued lines included
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

  // ------------------------------------------------------------ socket
  // The socket lives next to this page (works under any mount point, e.g. /mothership/).
  function socketUrl() {
    const u = new URL(`ws?s=${encodeURIComponent(code)}`, location.href);
    u.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return u;
  }

  function connect() {
    if (!code) return;
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
          applyHeader(msg.header);
          typingQueue = [];
          Voice.stop();
          linesEl.innerHTML = "";
          msg.log.forEach(renderInstant);
          FX.sync(msg.effects);
          busy = msg.busy;
          updateBusy();
          scrollDown();
          break;
        case "header":
          if (header.tts && !msg.header.tts) Voice.stop();
          applyHeader(msg.header);
          break;
        case "line": enqueue(msg.entry); break;
        case "busy": busy = msg.busy; updateBusy(); break;
        case "effect": FX.start(msg.effect); break;
        case "endEffect": FX.end(msg.id); break;
      }
    };
  }
  if (spectate) connect();
})();
