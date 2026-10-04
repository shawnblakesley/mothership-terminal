(() => {
  const $ = (id) => document.getElementById(id);
  const key = new URLSearchParams(location.search).get("key") || "";
  let ws, S = null;
  let pendingKey = ""; // re-render the draft only when the pending reply actually changes
  const dirty = new Set(); // config fields the DM is mid-edit on

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const send = (msg) => ws?.readyState === 1 && ws.send(JSON.stringify(msg));
  const time = (ts) => new Date(ts).toTimeString().slice(0, 5);

  const FX_META = {
    blood: ["🩸", "Blood"], goo: ["🟢", "Goo"], crack: ["💥", "Crack"],
    alarm: ["🚨", "Hacker alarm"], redalert: ["🔴", "Red alert"], glitch: ["📺", "Glitch"],
    static: ["▒", "Static"], blackout: ["⬛", "Blackout"], lockout: ["🔒", "Lockout"],
    banner: ["📢", "Banner"], corrupt: ["⌧", "Corrupt text"],
  };

  // ------------------------------------------------------------ socket
  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/?role=dm&key=${encodeURIComponent(key)}`);
    ws.onopen = () => { $("conn").textContent = "online"; $("conn").className = "pill ok"; };
    ws.onclose = () => { $("conn").textContent = "offline"; $("conn").className = "pill bad"; setTimeout(connect, 1500); };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.t === "state") { S = msg.state; render(); }
    };
  }

  // ------------------------------------------------------------ render
  function render() {
    renderAgentPicker();
    for (const b of $("mode").children) b.classList.toggle("on", b.dataset.mode === S.config.mode);
    renderLog();
    renderPending();
    renderEffects();
    renderConfig();
    renderSendAs();
    renderVoices();
  }

  function fillSelect(sel, options, value) {
    const html = options.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join("");
    if (sel.dataset.html !== html) { sel.innerHTML = html; sel.dataset.html = html; }
    sel.value = value;
  }

  function renderAgentPicker() {
    const { provider, model, effort } = S.config;
    const p = S.providers.find((x) => x.id === provider) ?? S.providers[0];
    const m = p.models.find((x) => x.id === model) ?? p.models[0];
    fillSelect($("provider"), S.providers.map((x) => [x.id, x.configured ? x.label : `${x.label} (no key)`]), p.id);
    fillSelect($("model"), p.models.map((x) => [x.id, x.label]), m.id);
    fillSelect($("effort"), m.efforts.map((e) => [e, e === "off" ? "thinking off" : `effort ${e}`]), effort);
    $("effort").disabled = !m.efforts.length;
    $("keywarn").hidden = p.configured;
    $("keywarn").textContent = `no ${p.envKey} — manual only`;
  }

  let lastLogLen = -1;
  function renderLog() {
    const log = $("log");
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const who = (e) => e.kind === "player" ? "Players"
      : e.kind === "warden" ? "⚑ Warden command → agent"
      : e.kind === "entity" ? `🔊 ${esc(voiceName(e.entity))} · ${e.source === "dm" ? "you" : "agent"}`
      : e.kind === "terminal" ? (e.source === "dm" ? "Terminal · you" : "Terminal · agent")
      : e.kind === "system" ? (e.source === "agent" ? "Broadcast · agent" : "Broadcast · you") : "Note";
    log.innerHTML = S.log.map((e) => `
      <div class="entry ${e.kind} ${e.hidden ? "hidden-on-player" : ""}">
        <div class="who"><span>${who(e)}</span><span>${time(e.ts)}</span>${e.hidden ? "<span>· cleared from screen</span>" : ""}</div>
        <div class="txt">${esc(e.text)}</div>
        <button class="del" data-del="${e.id}" title="Delete (also removes from agent memory)">✕</button>
      </div>`).join("") || `<div class="muted small">Nothing yet. Waiting for the crew to type something…</div>`;
    if (atBottom || S.log.length !== lastLogLen) log.scrollTop = log.scrollHeight;
    lastLogLen = S.log.length;
  }

  function renderPending() {
    const p = S.pending;
    const card = $("pending");
    const k = p ? `${p.status}|${p.forEntry}|${JSON.stringify(p.reply || p.error || "")}` : `none|${S.config.mode}`;
    if (k === pendingKey) return;
    pendingKey = k;
    const forText = p?.forEntry ? S.log.find((e) => e.id === p.forEntry)?.text : null;
    const forLine = forText ? `<div class="label">Replying to: <span class="muted">${esc(forText.slice(0, 120))}</span></div>` : "";

    if (!p) {
      card.className = "card empty";
      card.innerHTML = S.config.mode === "manual"
        ? "Manual mode — type replies in the comms box."
        : "No reply pending.";
      return;
    }
    if (p.status === "generating") {
      card.className = "card generating";
      card.innerHTML = `${forLine}<div><span class="spinner"></span>${esc(p.model || "Agent")} is thinking…</div>
        <div class="row"><button data-act="discard">Cancel</button></div>`;
      return;
    }
    if (p.status === "error") {
      card.className = "card error";
      card.innerHTML = `${forLine}<div class="err">${esc(p.error)}</div>
        ${steerRow()}
        <div class="row"><button data-act="regen" class="primary">Retry</button><button data-act="discard">Dismiss</button></div>`;
      return;
    }
    const r = p.reply;
    card.className = "card ready";
    card.innerHTML = `
      ${forLine}
      <div class="label">Draft reply <span class="muted">(edit freely · change who says each line · Ctrl+Enter sends)</span></div>
      <div id="draftLines">${(r.lines.length ? r.lines : [{ voice: "terminal", text: "" }]).map(draftLine).join("")}</div>
      <div class="row"><button data-act="addLine" class="ghost">+ Line</button></div>
      ${p.directives?.length ? `<div class="note">⚑ Following your command${p.directives.length > 1 ? "s" : ""}: ${p.directives.map(esc).join(" · ")}</div>` : ""}
      ${r.station_changes.length ? `<div class="label">Station changes</div><ul>${r.station_changes.map((c, i) =>
        `<li><label><input type="checkbox" data-chg="${i}" checked> ${esc(c.path)} → ${esc(c.value)}</label></li>`).join("")}</ul>` : ""}
      ${r.effects.length ? `<div class="label">Effects</div><ul>${r.effects.map((f, i) =>
        `<li><label><input type="checkbox" data-eff="${i}" ${S.config.agentEffects ? "checked" : ""}> ${FX_META[f.type]?.[0] || ""} ${esc(f.type)}${f.text ? ` "${esc(f.text)}"` : ""} · ${f.seconds || "∞"}s</label></li>`).join("")}</ul>` : ""}
      ${r.dm_note ? `<div class="note">🧠 ${esc(r.dm_note)}</div>` : ""}
      <div class="row"><button data-act="approve" class="primary">Send to players</button><button data-act="discard" class="ghost">Discard</button></div>
      ${steerRow()}
      <div class="row"><button data-act="regen">↻ Regenerate</button></div>`;
  }
  // One editable line of a draft: who says it, and what.
  const draftLine = (l) => `
    <div class="dline">
      <select aria-label="Voice">${S.config.voices.map((v) => `<option value="${esc(v.id)}" ${v.id === l.voice ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select>
      <textarea rows="${Math.min(12, Math.max(2, l.text.split("\n").length))}">${esc(l.text)}</textarea>
      <button data-act="delLine" class="ghost" title="Remove line">✕</button>
    </div>`;
  const steerRow = () => `<input id="steer" placeholder="Steer the rewrite: e.g. 'more evasive', 'deny the door is open', 'glitch mid-sentence'">`;

  function renderEffects() {
    const list = $("fxActive");
    list.innerHTML = S.effects.length
      ? S.effects.map((f) => `<li><span>${FX_META[f.type]?.[0] || ""}</span>
          <span class="grow">${esc(f.type)}${f.text ? ` · "${esc(f.text)}"` : ""}${f.source === "agent" ? " · <em>agent</em>" : ""}
          · ${f.seconds ? `${Math.max(0, Math.ceil(f.seconds - (Date.now() - f.startedAt) / 1000))}s` : "∞"}</span>
          <button data-endfx="${f.id}">End</button></li>`).join("")
      : `<li class="none">None</li>`;
  }

  function renderConfig() {
    const c = S.config;
    for (const id of ["stationName", "lore", "secrets", "standingOrders", "theme"]) {
      const el = $(id);
      if (!dirty.has(id) && document.activeElement !== el && el.value !== c[id]) el.value = c[id];
    }
    $("agentEffects").checked = c.agentEffects;
    $("tts").checked = c.tts;
    if (!dirty.has("whisper") && document.activeElement !== $("whisper")) $("whisper").value = S.whisper;
    if (!dirty.has("station") && document.activeElement !== $("station")) $("station").value = JSON.stringify(S.station, null, 2);
  }

  // ------------------------------------------------------------ actions
  $("mode").addEventListener("click", (e) => {
    const m = e.target.closest("button")?.dataset.mode;
    if (m) send({ t: "config", patch: { mode: m } });
  });

  // Text config fields save on blur (or after a pause in typing).
  for (const id of ["stationName", "lore", "secrets", "standingOrders"]) {
    const el = $(id);
    let t;
    const save = () => { clearTimeout(t); dirty.delete(id); send({ t: "config", patch: { [id]: el.value } }); };
    el.addEventListener("input", () => { dirty.add(id); clearTimeout(t); t = setTimeout(save, 800); });
    el.addEventListener("blur", () => dirty.has(id) && save());
  }
  for (const id of ["theme", "provider", "model", "effort"]) $(id).addEventListener("change", (e) => send({ t: "config", patch: { [id]: e.target.value } }));
  $("agentEffects").addEventListener("change", (e) => send({ t: "config", patch: { agentEffects: e.target.checked } }));
  $("tts").addEventListener("change", (e) => send({ t: "config", patch: { tts: e.target.checked } }));

  {
    const el = $("whisper");
    let t;
    const save = () => { clearTimeout(t); dirty.delete("whisper"); send({ t: "whisper", text: el.value }); };
    el.addEventListener("input", () => { dirty.add("whisper"); clearTimeout(t); t = setTimeout(save, 500); });
    el.addEventListener("blur", () => dirty.has("whisper") && save());
  }

  $("station").addEventListener("input", () => { dirty.add("station"); $("stationErr").textContent = "unsaved changes"; });
  $("stationSave").addEventListener("click", () => {
    try {
      const obj = JSON.parse($("station").value);
      send({ t: "station", station: obj });
      dirty.delete("station");
      $("stationErr").textContent = "";
    } catch (err) {
      $("stationErr").textContent = `Invalid JSON: ${err.message}`;
    }
  });

  function compose(as) {
    const text = $("compose").value.trim();
    if (!text) return;
    if (as === "note") send({ t: "note", text });
    else if (as === "command") send({ t: "command", text });
    else send({ t: "inject", as: $("sendAs").value, text, clearPending: true });
    $("compose").value = "";
  }
  $("sendCommand").onclick = () => compose("command");
  $("sendVoice").onclick = () => compose("voice");
  $("sendNote").onclick = () => compose("note");
  $("compose").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); compose("command"); }
  });

  $("log").addEventListener("click", (e) => {
    const id = e.target.closest("[data-del]")?.dataset.del;
    if (id) send({ t: "deleteEntry", id: Number(id) });
  });

  function approve() {
    const r = S.pending?.reply;
    if (!r) return;
    const card = $("pending");
    const reply = {
      lines: [...card.querySelectorAll(".dline")]
        .map((row) => ({ voice: row.querySelector("select").value, text: row.querySelector("textarea").value }))
        .filter((l) => l.text.trim()),
      station_changes: r.station_changes.filter((_, i) => card.querySelector(`[data-chg="${i}"]`)?.checked),
      effects: r.effects.filter((_, i) => card.querySelector(`[data-eff="${i}"]`)?.checked),
    };
    send({ t: "approve", reply });
  }
  $("pending").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "approve") approve();
    else if (act === "addLine") $("draftLines").insertAdjacentHTML("beforeend", draftLine({ voice: "terminal", text: "" }));
    else if (act === "delLine") e.target.closest(".dline").remove();
    else if (act === "discard") send({ t: "discard" });
    else if (act === "regen") send({ t: "generate", steer: $("steer")?.value || "" });
  });
  $("pending").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (e.target.id === "steer") send({ t: "generate", steer: e.target.value });
      else approve();
    }
  });
  $("promptNow").onclick = () => send({ t: "generate" });

  // Effect buttons
  $("fxButtons").innerHTML = Object.entries(FX_META)
    .map(([type, [ico, label]]) => `<button data-fx="${type}"><span class="ico">${ico}</span>${label}</button>`).join("");
  $("fxButtons").addEventListener("click", (e) => {
    const type = e.target.closest("[data-fx]")?.dataset.fx;
    if (!type) return;
    send({
      t: "effect",
      effect: { type, text: $("fxText").value, seconds: Number($("fxSecs").value) || 0, intensity: Number($("fxIntensity").value) },
    });
  });
  $("fxActive").addEventListener("click", (e) => {
    const id = e.target.closest("[data-endfx]")?.dataset.endfx;
    if (id) send({ t: "clearEffect", id });
  });
  $("fxClear").onclick = () => send({ t: "clearEffects" });
  setInterval(() => S && S.effects.length && renderEffects(), 1000);

  $("clearScreen").onclick = () => send({ t: "clearScreen" });
  $("resetSession").onclick = () => confirm("Start a new session? Clears the log and effects; lore, persona and secrets are kept.") &&
    send({ t: "resetSession", keepStation: confirm("Keep the current station state? (Cancel = restore default station)") });
  $("resetAll").onclick = () => confirm("Factory reset EVERYTHING (lore, persona, secrets, station) to defaults?") && send({ t: "resetAll" });

  // ------------------------------------------------------------ voices & entities
  const BUILTIN_IDS = ["terminal", "broadcast"];
  // Every voice keeps settings for both engines, so switching engine loses nothing.
  const BASE_VOICE = { engine: "espeak", speaker: "am_michael", pace: 1, variant: "", pitch: 50, speed: 170, wordgap: 0 };
  const FX_LABELS = {
    rate: "Speed / pitch", highpass: "Low cut (Hz)", lowpass: "High cut (Hz)", drive: "Distortion",
    ringMix: "Robot warble", ringFreq: "Warble freq (Hz)", comb: "Metallic", combMs: "Metallic tone (ms)",
    chorus: "Chorus", echo: "Echo", echoTime: "Echo time (s)", echoFeedback: "Echo repeats",
    reverb: "Reverb", noise: "Radio hiss", dry: "Direct level",
  };
  const VARIANT_LABELS = { "": "default", whisperf: "whisper (female)", klatt: "klatt (synthetic)", klatt2: "klatt 2", klatt3: "klatt 3" };

  let voicesDraft = null; // working copy while the Warden edits
  let voicesSentAt = 0;
  let voicesTimer = null;

  function voiceName(id) {
    return S?.config.voices.find((v) => v.id === id)?.name || id;
  }

  function renderSendAs() {
    const sel = $("sendAs");
    const prev = sel.value || "terminal";
    fillSelect(sel, S.config.voices.map((v) => [v.id, v.id === "terminal" ? `${v.name} (terminal)` : v.name]), prev);
    if (!sel.value) sel.value = "terminal";
  }

  function saveVoices() {
    clearTimeout(voicesTimer);
    voicesTimer = setTimeout(() => {
      voicesTimer = null;
      voicesSentAt = Date.now();
      send({ t: "voices", voices: voicesDraft });
    }, 350);
  }

  // fromDraft: re-draw the Warden's working copy (e.g. after picking a preset)
  // instead of pulling the server's copy, which may not have their latest edits yet.
  function renderVoices(fromDraft = false) {
    const panel = $("voices");
    if (!fromDraft) {
      // Don't yank the form out from under the Warden mid-edit.
      const editing = panel.contains(document.activeElement) || voicesTimer !== null || Date.now() - voicesSentAt < 1500;
      if (voicesDraft && editing) return;
      const json = JSON.stringify(S.config.voices);
      if (panel.dataset.json === json) return;
      panel.dataset.json = json;
      voicesDraft = structuredClone(S.config.voices);
    }
    const o = S.voiceOptions;
    panel.innerHTML = voicesDraft.map((v, i) => `
      <div class="vcard" data-i="${i}">
        <div class="row">
          <input data-k="name" value="${esc(v.name)}" aria-label="Name" class="vname">
          <button data-act="test" title="Hear it (on this computer only)">▶ Test</button>
          ${BUILTIN_IDS.includes(v.id) ? `<span class="pill">built-in</span>` : `<button data-act="del" class="danger" title="Delete voice">✕</button>`}
        </div>
        <label class="field"><span>Persona <em>(who this is and how it talks; the agent reads this)</em></span>
          <textarea data-k="persona" rows="${v.id === "terminal" ? 10 : 4}" placeholder="e.g. Dr. Imre Salk, the station medic. Exhausted, kind, hiding a fever...">${esc(v.persona || "")}</textarea></label>
        <div class="vgrid">
          <label>Style
            <select data-k="style">${o.styles.map((st) => `<option value="${st}" ${st === v.style ? "selected" : ""}>${{ plain: "plain text", label: "NAME: label", boxed: "boxed" }[st]}</option>`).join("")}</select>
          </label>
          <label>Colour
            <span class="row"><input type="color" data-k="color" value="${v.color || "#3bff7a"}" ${v.color ? "" : "disabled"}>
            <span class="check"><input type="checkbox" data-k="themeColor" ${v.color ? "" : "checked"}> theme</span></span>
          </label>
          <label>Preset
            <select data-k="preset">${[...Object.keys(o.presets), "custom"].map((p) => `<option value="${p}" ${p === v.preset ? "selected" : ""}>${p}</option>`).join("")}</select>
          </label>
          <label>Engine
            <select data-k="voice.engine">
              <option value="neural" ${v.voice.engine === "neural" ? "selected" : ""}>Human (neural)</option>
              <option value="espeak" ${v.voice.engine !== "neural" ? "selected" : ""}>Synthetic (eSpeak)</option>
            </select>
          </label>
          ${v.voice.engine === "neural" ? `
          <label>Speaker
            <select data-k="voice.speaker">${Object.entries(o.speakers).map(([id, label]) => `<option value="${id}" ${id === v.voice.speaker ? "selected" : ""}>${esc(label)}</option>`).join("")}</select>
          </label>
          ${slider("voice.pace", "Pace", 0.5, 2, 0.05, v.voice.pace)}` : `
          <label>Base voice
            <select data-k="voice.variant">${o.variants.map((va) => `<option value="${va}" ${va === v.voice.variant ? "selected" : ""}>${VARIANT_LABELS[va] || va}</option>`).join("")}</select>
          </label>
          ${slider("voice.pitch", "Pitch", 0, 99, 1, v.voice.pitch)}
          ${slider("voice.speed", "Words/min", 80, 320, 5, v.voice.speed)}`}
        </div>
        <details class="fxd"><summary>Effects</summary>
          <div class="vgrid">${Object.entries(o.fxParams).map(([k, [min, max]]) =>
            slider(`fx.${k}`, FX_LABELS[k] || k, min, max, (max - min) / 100, v.fx[k])).join("")}</div>
        </details>
      </div>`).join("");
  }

  function slider(key, label, min, max, step, value) {
    const shown = Number(value).toFixed(step < 1 ? 2 : 0);
    return `<label>${label} <output>${shown}</output>
      <input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
  }

  function setKey(v, key, raw) {
    const [a, b] = key.split(".");
    if (b) v[a][b] = raw;
    else v[a] = raw;
  }

  $("voices").addEventListener("input", (e) => {
    const card = e.target.closest(".vcard");
    const key = e.target.dataset.k;
    if (!card || !key) return;
    const v = voicesDraft[Number(card.dataset.i)];
    if (key === "themeColor") {
      const picker = card.querySelector('[data-k="color"]');
      picker.disabled = e.target.checked;
      v.color = e.target.checked ? "" : picker.value;
    } else if (key === "preset") {
      const p = S.voiceOptions.presets[e.target.value];
      v.preset = e.target.value;
      if (p) {
        v.voice = { ...BASE_VOICE, ...p.voice };
        v.fx = Object.fromEntries(Object.entries(S.voiceOptions.fxParams).map(([k, [, , def]]) => [k, p.fx[k] ?? def]));
        saveVoices();
        return renderVoices(true), restoreCard(card.dataset.i);
      }
    } else {
      const val = e.target.type === "range" ? Number(e.target.value) : e.target.value;
      setKey(v, key, val);
      if (key.startsWith("voice.") || key.startsWith("fx.")) {
        v.preset = "custom";
        card.querySelector('[data-k="preset"]').value = "custom";
      }
      if (key === "voice.engine") {
        // Different engines have different controls: redraw this card.
        saveVoices();
        renderVoices(true);
        return restoreCard(card.dataset.i);
      }
      const out = e.target.parentElement.querySelector("output");
      if (out) out.textContent = Number(val).toFixed(Number(e.target.step) < 1 ? 2 : 0);
    }
    saveVoices();
  });

  // After a preset re-render, put focus back on the same card's preset picker.
  function restoreCard(i) {
    const card = $("voices").querySelector(`.vcard[data-i="${i}"]`);
    card?.querySelector('[data-k="preset"]')?.focus();
  }

  $("voices").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    const card = e.target.closest(".vcard");
    if (!act || !card) return;
    const i = Number(card.dataset.i);
    if (act === "test") {
      Voice.test(voicesDraft[i], $("testText").value || "Testing.", key);
    } else if (act === "del" && confirm(`Delete the voice "${voicesDraft[i].name}"?`)) {
      voicesDraft.splice(i, 1);
      send({ t: "voices", voices: voicesDraft });
      voicesSentAt = 0;
    }
  });

  $("addVoice").onclick = () => {
    const p = S.voiceOptions.presets.intercom;
    const n = voicesDraft.length + 1;
    voicesDraft.push({
      id: `voice-${Date.now().toString(36)}`,
      name: `NEW VOICE ${n}`,
      style: "label",
      color: "",
      preset: "intercom",
      voice: { ...BASE_VOICE, ...p.voice },
      fx: Object.fromEntries(Object.entries(S.voiceOptions.fxParams).map(([k, [, , def]]) => [k, p.fx[k] ?? def])),
    });
    voicesSentAt = 0;
    send({ t: "voices", voices: voicesDraft });
  };

  $("playerUrl").textContent = `${location.origin}/`;
  connect();
})();
