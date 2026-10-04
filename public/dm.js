(() => {
  const $ = (id) => document.getElementById(id);
  const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  // ------------------------------------------------------------ session + token
  // The Warden token proves this console runs the session. It arrives once in a
  // link's #fragment (never sent to the server in a URL) and is kept per device.
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
    del: (k) => { try { localStorage.removeItem(k); } catch {} },
  };
  const tokenKey = (c) => `warden:${c}`;
  let code = normCode(new URLSearchParams(location.search).get("s"));
  const hashToken = new URLSearchParams(location.hash.slice(1)).get("token");
  if (code && hashToken) {
    store.set(tokenKey(code), hashToken);
    history.replaceState(null, "", `?s=${code}`);
  }
  let key = code ? store.get(tokenKey(code)) : null; // the Warden token for this session
  let ws, S = null;
  let appVersion = null; // the server's code version (see version.js)
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
  let autoKeySent = false;
  function connect() {
    const u = new URL(`ws?s=${encodeURIComponent(code)}&role=dm`, location.href);
    u.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(u);
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: "auth", token: key }));
      $("conn").textContent = "online"; $("conn").className = "pill ok";
    };
    ws.onclose = (ev) => {
      $("conn").textContent = "offline"; $("conn").className = "pill bad";
      if (ev.code === 4003 || ev.code === 4004) {
        store.del(tokenKey(code));
        return showStart(ev.code === 4004 ? `Session ${code} has ended or expired.` : `This device isn't the Warden for session ${code}. Use its Warden link.`);
      }
      setTimeout(connect, ev.code === 4029 ? 10000 : 1500);
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.t === "state") {
        // The server was updated while this page was open: load the new code.
        if (appVersion && msg.state.version && msg.state.version !== appVersion) return location.reload();
        appVersion = msg.state.version;
        S = msg.state;
        render();
        // After a server restart the session's key is gone: re-send a remembered one.
        const p = S.providers.find((x) => x.id === S.config.provider);
        const remembered = p && store.get(`wardenKey:${p.id}`);
        if (p && !p.configured && remembered && !autoKeySent) {
          autoKeySent = true;
          send({ t: "apiKey", provider: p.id, key: remembered });
        }
      } else if (msg.t === "toast") toast(msg.text, msg.level);
    };
  }

  function toast(text, level = "info") {
    const el = $("toast");
    el.textContent = text;
    el.className = `toast ${level}`;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.hidden = true), 5000);
  }

  // Player link for this session (relative to this page, so it works under /mothership/).
  const playerLink = () => new URL(`./?s=${code}`, location.href).href;
  const wardenLink = () => `${new URL(`dm?s=${code}`, new URL("./", location.href)).href}#token=${key}`;

  // In-page confirmation: ask(title, text, [[value, label, class?], ...]) resolves
  // to the clicked button's value, or "" if dismissed. (Not confirm(): browsers let
  // people block those, which silently answers "cancel".)
  // input: { value } shows an editable field (read it from $("askCopy") afterwards).
  function ask(title, text, buttons, copyText, input = null) {
    const dlg = $("askDialog");
    $("askTitle").textContent = title;
    $("askText").textContent = text;
    $("askCopy").hidden = !copyText && !input;
    $("askCopy").readOnly = !input;
    $("askCopy").value = input ? String(input.value ?? "") : copyText || "";
    $("askButtons").innerHTML = buttons.map(([v, label, cls]) => `<button value="${esc(v)}" class="${cls || ""}">${esc(label)}</button>`).join("")
      + '<span class="grow"></span><button value="" formnovalidate>Cancel</button>';
    dlg.showModal();
    if (copyText || input) $("askCopy").select();
    return new Promise((resolve) => {
      const done = (value) => {
        dlg.removeEventListener("close", onClose);
        $("askButtons").onclick = null;
        if (dlg.open) dlg.close();
        resolve(value);
      };
      const onClose = () => done(""); // Esc
      dlg.addEventListener("close", onClose);
      $("askButtons").onclick = (e) => {
        const btn = e.target.closest("button");
        if (!btn) return;
        e.preventDefault();
        done(btn.value);
      };
    });
  }
  const sure = async (title, text, label, cls = "danger") => (await ask(title, text, [["yes", label, cls]])) === "yes";

  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); toast(`${what} copied.`); }
    catch { ask(`Copy the ${what.toLowerCase()}`, "Your browser blocked copying. Select the text below and copy it.", [], text); }
  }

  // ------------------------------------------------------------ start screen
  let providerCatalog = [];
  async function loadProviders() {
    if (providerCatalog.length) return providerCatalog;
    const r = await fetch("api/providers").catch(() => null);
    providerCatalog = r?.ok ? await r.json() : [];
    return providerCatalog;
  }

  function mySessions() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith("warden:")) out.push(k.slice(7));
      }
    } catch {}
    return out;
  }

  async function showStart(error = "") {
    document.body.classList.add("starting");
    $("start").hidden = false;
    $("startErr").textContent = error;
    const provs = await loadProviders();
    const sel = $("newProvider");
    sel.innerHTML = provs.map((p) => `<option value="${esc(p.id)}">${esc(p.label)} · cheapest: ${esc(p.models[0].label)}</option>`).join("");
    const syncProv = () => {
      const p = provs.find((x) => x.id === sel.value);
      $("newKey").placeholder = p?.keyHint || "";
      $("keyLink").href = p?.keyUrl || "#";
      const rem = p && store.get(`wardenKey:${p.id}`);
      $("newKey").value = rem || "";
      $("newRemember").checked = !!rem;
    };
    sel.onchange = syncProv;
    syncProv();
    const mine = mySessions();
    $("mineCard").hidden = !mine.length;
    $("mine").innerHTML = mine.map((c) => `<li><code>${esc(c)}</code> <span class="muted" data-name="${esc(c)}"></span>
      <span class="grow"></span><a class="btn" href="dm?s=${esc(c)}">Open</a> <button data-forget="${esc(c)}" class="ghost">Forget</button></li>`).join("");
    for (const c of mine) {
      fetch(`api/sessions/${c}`).then((r) => (r.ok ? r.json() : null)).then((info) => {
        const el = $("mine").querySelector(`[data-name="${c}"]`);
        if (el) el.textContent = info ? info.stationName : "(ended)";
      }).catch(() => {});
    }
  }

  $("mine").addEventListener("click", async (e) => {
    const c = e.target.closest("[data-forget]")?.dataset.forget;
    if (c && await sure(`Forget session ${c}?`, "It keeps running on the server; you'd need its Warden link to get back in on this device.", "Forget")) {
      store.del(tokenKey(c));
      showStart();
    }
  });

  $("createForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const provider = $("newProvider").value, apiKey = $("newKey").value.trim();
    $("createBtn").disabled = true;
    $("startErr").textContent = "";
    try {
      const r = await fetch("api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, apiKey }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Couldn't create a session (${r.status}).`);
      if ($("newRemember").checked) store.set(`wardenKey:${provider}`, apiKey);
      else store.del(`wardenKey:${provider}`);
      store.set(tokenKey(data.code), data.token);
      location.href = `dm?s=${data.code}`;
    } catch (err) {
      $("startErr").textContent = err.message;
      $("createBtn").disabled = false;
    }
  });

  $("linkForm").addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      const u = new URL($("wardenLink").value.trim());
      const c = normCode(u.searchParams.get("s"));
      const t = new URLSearchParams(u.hash.slice(1)).get("token");
      if (!c || !t) throw new Error();
      store.set(tokenKey(c), t);
      location.href = `dm?s=${c}`;
    } catch {
      $("startErr").textContent = "That isn't a Warden link. It looks like …/dm?s=CODE#token=…";
    }
  });

  // ------------------------------------------------------------ API key dialog
  function openKeyDialog() {
    const sel = $("keyProvider");
    sel.innerHTML = S.providers.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}${p.configured ? " ✓" : ""}</option>`).join("");
    sel.value = S.config.provider;
    const sync = () => {
      const p = S.providers.find((x) => x.id === sel.value);
      $("keyValue").value = "";
      $("keyValue").placeholder = p.configured ? "•••••••• (set — paste to replace)" : p.keyHint;
      $("keyLink2").href = p.keyUrl || "#";
      $("keyRemember").checked = !!store.get(`wardenKey:${p.id}`);
      $("keyRemove").hidden = !p.configured;
      $("keyStatus").textContent = p.configured
        ? "A key is set for this session."
        : "No key yet. The agent can't reply with this provider until you add one.";
    };
    sel.onchange = sync;
    sync();
    $("keyDialog").showModal();
  }
  $("keyDialog").addEventListener("close", () => {
    const action = $("keyDialog").returnValue;
    const provider = $("keyProvider").value, k = $("keyValue").value.trim();
    if (action === "save" && k) {
      send({ t: "apiKey", provider, key: k });
      if ($("keyRemember").checked) store.set(`wardenKey:${provider}`, k);
      else store.del(`wardenKey:${provider}`);
      send({ t: "config", patch: { provider } });
    } else if (action === "save" && !$("keyRemember").checked) {
      store.del(`wardenKey:${provider}`);
    } else if (action === "remove") {
      send({ t: "apiKey", provider, key: "" });
      store.del(`wardenKey:${provider}`);
    }
  });

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
    renderOutcome();
    renderRoll();
    renderSounds();
    renderCastLists();
    renderMap();
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
    $("keywarn").textContent = `no ${p.label} key: click to add`;
  }

  let lastLogLen = -1;
  // A log entry's speaker label, who sent it (you or the agent) and its colour.
  // Null for Warden notes.
  function speaker(e) {
    const by = e.source === "dm" ? "you" : e.source === "agent" ? "agent" : "";
    const who = (name) => (e.character ? `${name} · ${e.character}` : name);
    switch (e.kind) {
      case "player": return { name: "Players", c: "var(--player)" };
      case "warden": return { name: "Warden → agent", c: "var(--warden)" };
      case "aside": return { name: "Note → agent", by: "private", c: "var(--aside)" };
      case "aside_reply": return { name: "Agent → you", by: "private", c: "var(--aside)" };
      case "roll": return { name: "Roll result", c: "var(--roll)" };
      case "terminal": return { name: who(voiceName("terminal")), by, c: "var(--accent)" };
      case "system": return { name: who(voiceName("broadcast")), by, c: "var(--warn)" };
      case "entity": {
        const v = S.config.voices.find((x) => x.id === e.entity);
        return { name: who(v?.name || e.entity), by, c: v?.color || "var(--entity)" };
      }
      default: return null;
    }
  }

  function renderLog() {
    const log = $("log");
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.innerHTML = S.log.map((e) => {
      const sp = speaker(e);
      const del = `<button class="del" data-del="${e.id}" title="Delete (also removes from agent memory)">✕</button>`;
      const when = `<span class="time">${time(e.ts)}</span>`;
      // Warden notes: one quiet line each.
      if (!sp) {
        // "Agent triggered effect: blackout (2s) before line #13" -> "⚡ blackout (2s)":
        // it's listed right under the line it plays with.
        const fx = /^Agent triggered effect: (.*?)(?: (before|after) line #\d+)?$/.exec(e.text);
        const txt = fx ? `⚡ ${esc(fx[1])}${fx[2] === "after" ? " · after this line" : ""}` : esc(e.text);
        return `<div class="entry note${fx ? " fx" : ""}"><span class="txt">${txt}</span>${when}${del}</div>`;
      }
      return `
      <div class="entry ${e.kind} ${e.hidden ? "hidden-on-player" : ""}" style="--c: ${sp.c}">
        <div class="who"><span class="tag">${esc(sp.name)}</span>${sp.by ? `<span class="by">${sp.by}</span>` : ""}${e.hidden ? '<span class="by">cleared from screen</span>' : ""}${when}</div>
        <div class="txt">${esc(e.text)}${e.kind === "aside_reply" && e.changes?.length ? `<div class="chg">${e.changes.map((c) => `${esc(c.path)} → ${esc(c.value)}`).join(" · ")}</div>` : ""}</div>${del}
      </div>`;
    }).join("") || `<div class="muted small">Nothing yet. Waiting for the crew to type something…</div>`;
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
      ${r.outcome_check?.needed ? `<div class="note">⚖ Leaves the outcome to you: <b>${esc(r.outcome_check.attempt)}</b>${r.outcome_check.suggested_check !== "none" ? ` · suggests ${esc(checkName(r.outcome_check.suggested_check))}${advMark(r.outcome_check.advantage)}` : ""}. Once it is sent you get It works / It fails / Roll.</div>` : ""}
      ${r.dm_note ? `<div class="note">🧠 ${esc(r.dm_note)}</div>` : ""}
      <div class="row"><button data-act="approve" class="primary">Send to players</button><button data-act="discard" class="ghost">Discard</button></div>
      ${steerRow()}
      <div class="row"><button data-act="regen">↻ Regenerate</button></div>`;
  }
  // One editable line of a draft: who says it, and what.
  // A line's effects fire as it begins (between lines of dialogue); untick to drop one.
  const draftLine = (l) => `
    <div class="dline" data-effects="${esc(JSON.stringify(l.effects || []))}">
      <div class="dwho">
        <select aria-label="Voice">${S.config.voices.map((v) => `<option value="${esc(v.id)}" ${v.id === l.voice ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select>
        <input class="dchar" list="chars-${esc(l.voice)}" value="${esc(l.character || "")}" placeholder="speaker" aria-label="Character" title="Who speaks this line (for voices several people share, like the intercom)" ${hasCast(l.voice) || l.character ? "" : "hidden"}>
      </div>
      <textarea rows="${Math.min(12, Math.max(2, l.text.split("\n").length))}" placeholder="${l.effects?.length ? "(effect only: no text)" : ""}">${esc(l.text)}</textarea>
      <button data-act="delLine" class="ghost" title="Remove line">✕</button>
      ${l.effects?.length ? `<div class="dfx">${l.effects.map((f, i) => `<label class="chip"><input type="checkbox" data-leff="${i}" ${S.config.agentEffects ? "checked" : ""}> ⚡ ${FX_META[f.type]?.[0] || ""} ${esc(f.type)}${f.text ? ` "${esc(f.text)}"` : ""} · ${f.seconds || "∞"}s <span class="muted">as this line starts</span></label>`).join("")}</div>` : ""}
    </div>`;
  const hasCast = (voiceId) => !!S.config.voices.find((v) => v.id === voiceId)?.characters?.length;
  // Name suggestions for each voice's speaker box.
  function renderCastLists() {
    $("castLists").innerHTML = S.config.voices.map((v) =>
      `<datalist id="chars-${esc(v.id)}">${(v.characters || []).map((c) => `<option value="${esc(c.name)}">`).join("")}</datalist>`).join("");
  }
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

  // ------------------------------------------------------------ station map
  let mapKey = "";
  function renderMap(force = false) {
    const key = JSON.stringify([S.station, S.config.map]);
    if (!force && key === mapKey) return;
    mapKey = key;
    StationMap.render($("map"), S.station, S.config.map);
    if ($("mapDialog").open) StationMap.render($("mapBig"), S.station, S.config.map);
    if (document.activeElement !== $("mapLayout") && !dirty.has("map")) $("mapLayout").value = S.config.map;
  }

  // Click a value: pick a likely one or type anything; it goes into the station state.
  async function editStationValue(path) {
    let cur = S.station;
    for (const k of path) cur = cur?.[k];
    const options = StationMap.choicesFor(path).filter((o) => o !== String(cur).toUpperCase());
    const picked = await ask(path.join(".").replace(/_/g, " ").toUpperCase(), `Now: ${cur}. Pick a value or type one. Players don't see this; the agent does on its next reply.`,
      [["set", "Set", "primary"], ...options.map((o) => [`opt:${o}`, o])], "", { value: cur }); // Set first: Enter in the field means Set
    if (!picked) return;
    const raw = picked === "set" ? $("askCopy").value.trim() : picked.slice(4);
    if (raw === "" || raw === String(cur)) return;
    const next = structuredClone(S.station);
    let o = next;
    for (const k of path.slice(0, -1)) o = o[k] ??= {};
    o[path.at(-1)] = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
    send({ t: "station", station: next });
  }
  for (const id of ["map", "mapBig"]) {
    $(id).addEventListener("click", (e) => {
      const p = e.target.closest("[data-path]")?.dataset.path;
      if (p) editStationValue(JSON.parse(p));
    });
  }
  $("mapExpand").onclick = (e) => {
    e.preventDefault(); // (it sits in the panel's summary)
    $("mapTitle").textContent = `${S.config.stationName} · station map`;
    $("mapDialog").showModal();
    renderMap(true);
  };
  $("mapClose").onclick = () => $("mapDialog").close();
  $("mapLayout").addEventListener("input", () => dirty.add("map"));
  $("mapLayoutSave").onclick = () => {
    dirty.delete("map");
    send({ t: "config", patch: { map: $("mapLayout").value } });
  };

  // ------------------------------------------------------------ sounds
  const soundUrl = (id) => `api/sessions/${code}/sounds/${id}`;
  let soundsKey = "";

  function renderSounds() {
    // Don't redraw the library under the Warden's fingers (renaming, dragging a slider).
    const list = $("soundList");
    const key = JSON.stringify(S.sounds);
    if (key !== soundsKey && !list.contains(document.activeElement)) {
      soundsKey = key;
      list.innerHTML = S.sounds.length
        ? S.sounds.map((s) => `<li data-id="${s.id}">
            <input class="sname" value="${esc(s.name)}" aria-label="Sound name" title="Rename">
            <input class="svol" type="range" min="0" max="1" step="0.05" value="${s.volume}" aria-label="Volume" title="Volume">
            <button class="ghost" data-sact="preview" title="Listen here (players don't hear it)">👂</button>
            <button data-sact="play" title="Play once on the players' screens">▶ Once</button>
            <button data-sact="loop" title="Loop on the players' screens until stopped (ambience, a growl…)">🔁 Loop</button>
            <button class="ghost" data-sact="del" title="Delete this sound">✕</button>
          </li>`).join("")
        : `<li class="none">No sounds yet. Upload growls, attacks, ambience…</li>`;
    }
    const playing = S.playing || [];
    const pl = $("soundPlaying");
    if (!pl.contains(document.activeElement)) {
      pl.innerHTML = playing.length
        ? playing.map((p) => `<li data-pid="${p.pid}"><span>${p.loop ? "🔁" : "▶"}</span>
            <span class="grow">${esc(p.name)}${p.loop ? "" : " · once"}</span>
            ${p.loop ? `<input class="pvol" type="range" min="0" max="1" step="0.05" value="${p.volume}" aria-label="Volume" title="Volume (live)">` : ""}
            <button data-stop="${p.pid}">Stop</button></li>`).join("")
        : `<li class="none">Silence</li>`;
    }
  }

  // How long a clip lasts (so a one-shot leaves the "Playing" list when it ends). 0 if unknown.
  let measureCtx = null;
  async function clipSeconds(file) {
    try {
      measureCtx ??= new (window.AudioContext || window.webkitAudioContext)();
      return (await measureCtx.decodeAudioData(await file.arrayBuffer())).duration;
    } catch {
      return 0;
    }
  }

  async function uploadSounds(files) {
    for (const file of files) {
      toast(`Uploading ${file.name}…`);
      try {
        const seconds = await clipSeconds(file);
        const r = await fetch(`api/sessions/${code}/sounds?name=${encodeURIComponent(file.name)}&seconds=${seconds.toFixed(2)}`, {
          method: "POST",
          headers: { "X-Warden-Token": key, "Content-Type": "application/octet-stream" },
          body: file,
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || `Upload failed (${r.status}).`);
        toast(`Added "${body.name}".`);
      } catch (err) {
        toast(`${file.name}: ${err.message}`, "error");
      }
    }
  }

  $("soundUpload").onclick = () => $("soundFile").click();
  $("soundFile").onchange = (e) => { uploadSounds([...e.target.files]); e.target.value = ""; };
  const drop = $("soundDrop");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    uploadSounds([...e.dataTransfer.files]);
  });

  $("soundList").addEventListener("click", async (e) => {
    const act = e.target.closest("[data-sact]")?.dataset.sact;
    const li = e.target.closest("li[data-id]");
    if (!act || !li) return;
    const s = S.sounds.find((x) => x.id === li.dataset.id);
    if (!s) return;
    const volume = Number(li.querySelector(".svol").value);
    if (act === "play" || act === "loop") send({ t: "soundPlay", id: s.id, loop: act === "loop", volume });
    else if (act === "preview") { if (!(await Sfx.preview(soundUrl(s.id), volume))) toast("Couldn't play that file in this browser.", "error"); }
    else if (act === "del" && await sure(`Delete "${s.name}"?`, "The sound file is removed from this session (and stops if it's playing).", "Delete")) {
      const r = await fetch(soundUrl(s.id), { method: "DELETE", headers: { "X-Warden-Token": key } });
      if (!r.ok && r.status !== 404) toast("Couldn't delete that sound.", "error");
    }
  });
  $("soundList").addEventListener("change", (e) => {
    const li = e.target.closest("li[data-id]");
    if (!li) return;
    if (e.target.classList.contains("sname")) send({ t: "soundEdit", id: li.dataset.id, name: e.target.value });
    if (e.target.classList.contains("svol")) send({ t: "soundEdit", id: li.dataset.id, volume: Number(e.target.value) });
    e.target.blur();
  });
  $("soundList").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.classList.contains("sname")) e.target.blur(); });
  $("soundPlaying").addEventListener("click", (e) => {
    const pid = e.target.closest("[data-stop]")?.dataset.stop;
    if (pid) send({ t: "soundStop", pid });
  });
  $("soundPlaying").addEventListener("input", (e) => {
    const li = e.target.closest("li[data-pid]");
    if (li && e.target.classList.contains("pvol")) send({ t: "soundVolume", pid: li.dataset.pid, volume: Number(e.target.value) });
  });
  $("soundPlaying").addEventListener("change", (e) => e.target.blur());
  $("soundStopAll").onclick = () => send({ t: "soundStop", all: true });

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
    else {
      const [as, character = ""] = $("sendAs").value.split("::");
      send({ t: "inject", as, character, text, clearPending: true });
    }
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
        .map((row) => {
          const fx = JSON.parse(row.dataset.effects || "[]").filter((_, i) => row.querySelector(`[data-leff="${i}"]`)?.checked);
          return { voice: row.querySelector("select").value, character: row.querySelector(".dchar").value.trim(), text: row.querySelector("textarea").value, effects: fx };
        })
        .filter((l) => l.text.trim() || l.effects.length), // effect-only beats count
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
  // Switching a line's voice: its speaker box follows (shown for shared voices).
  $("pending").addEventListener("change", (e) => {
    if (!e.target.matches(".dwho select")) return;
    const box = e.target.parentElement.querySelector(".dchar");
    box.setAttribute("list", `chars-${e.target.value}`);
    box.hidden = !hasCast(e.target.value) && !box.value;
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
  $("resetSession").onclick = async () => {
    const how = await ask("Restart the story?",
      "Clears the log and effects. Lore, voices and secrets are kept. Players stay connected and are logged back in as GUEST.",
      [["default", "Restart", "danger"], ["keep", "Restart, keep doors & systems"]]);
    if (how) send({ t: "resetSession", keepStation: how === "keep" });
  };
  $("resetAll").onclick = async () => (await sure("Factory reset?", "Everything (lore, personas, voices, secrets, station) goes back to the defaults.", "Factory reset")) && send({ t: "resetAll" });

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
    // Shared voices list each character too ("INTERCOM · Dr. Imre Salk").
    fillSelect(sel, S.config.voices.flatMap((v) => [
      [v.id, v.id === "terminal" ? `${v.name} (terminal)` : v.name],
      ...(v.characters || []).map((c) => [`${v.id}::${c.name}`, `${v.name} · ${c.name}`]),
    ]), prev);
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
        ${BUILTIN_IDS.includes(v.id) ? "" : castEditor(v)}
        <details class="fxd"><summary>Effects</summary>
          <div class="vgrid">${Object.entries(o.fxParams).map(([k, [min, max]]) =>
            slider(`fx.${k}`, FX_LABELS[k] || k, min, max, (max - min) / 100, v.fx[k])).join("")}</div>
        </details>
      </div>`).join("");
  }

  // People who speak through this voice, each with their own base voice. The
  // agent reads the list (with the persona) and picks who speaks each line.
  function castEditor(v) {
    const o = S.voiceOptions;
    const choices = v.voice.engine === "neural"
      ? Object.entries(o.speakers)
      : o.variants.filter((x) => /^[mf]\d$/.test(x)).map((x) => [x, x]);
    const own = v.voice.engine === "neural" ? o.speakers[v.voice.speaker] : v.voice.variant || "default";
    return `<div class="cast">
      <div class="row"><span class="grow castlabel">Characters <em>(people who speak through this voice; the agent switches between them)</em></span>
        <button data-act="addChar" class="ghost">+ Character</button></div>
      ${(v.characters || []).map((c, j) => `<div class="char" data-j="${j}">
        <input data-ck="name" value="${esc(c.name)}" placeholder="Name" aria-label="Character name">
        <select data-ck="voice" aria-label="Their voice"><option value="">same as ${esc(v.name)} (${esc(own)})</option>${choices.map(([id, label]) =>
          `<option value="${id}" ${id === c.voice ? "selected" : ""}>${esc(label)}</option>`).join("")}</select>
        <button data-act="testChar" title="Hear them (on this computer only)">▶</button>
        <button data-act="delChar" class="ghost" title="Remove">✕</button>
        <input data-ck="notes" class="cnotes" value="${esc(c.notes)}" placeholder="Who they are, how they talk (the agent reads this)" aria-label="Notes">
      </div>`).join("") || `<div class="muted small">Nobody yet. The agent adds people it brings in; you can pick their voices here.</div>`}
    </div>`;
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
    const ck = e.target.dataset.ck;
    if (card && ck) {
      const c = voicesDraft[Number(card.dataset.i)].characters[Number(e.target.closest(".char").dataset.j)];
      c[ck] = e.target.value;
      return saveVoices();
    }
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

  $("voices").addEventListener("click", async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    const card = e.target.closest(".vcard");
    if (!act || !card) return;
    let i = Number(card.dataset.i);
    if (act === "test") {
      Voice.test(voicesDraft[i], $("testText").value || "Testing.", `api/sessions/${code}/tts-test`, key);
    } else if (act === "addChar") {
      (voicesDraft[i].characters ||= []).push({ name: "", voice: "", notes: "" });
      renderVoices(true);
      $("voices").querySelector(`.vcard[data-i="${i}"] .char:last-of-type [data-ck="name"]`)?.focus();
    } else if (act === "delChar") {
      voicesDraft[i].characters.splice(Number(e.target.closest(".char").dataset.j), 1);
      saveVoices();
      renderVoices(true);
    } else if (act === "testChar") {
      const v = voicesDraft[i];
      const c = v.characters[Number(e.target.closest(".char").dataset.j)];
      const base = !c.voice ? v.voice : v.voice.engine === "neural" ? { ...v.voice, speaker: c.voice } : { ...v.voice, variant: c.voice };
      Voice.test({ ...v, voice: base }, $("testText").value || "Testing.", `api/sessions/${code}/tts-test`, key);
    } else if (act === "del") {
      const v = voicesDraft[i];
      if (!(await sure(`Delete "${v.name}"?`, "The voice and its persona are removed.", "Delete"))) return;
      i = voicesDraft.indexOf(v);
      if (i < 0) return;
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

  // ------------------------------------------------------------ rule of cool + ability rolls
  const checkName = (id) => S?.rollOptions?.checks[id]?.label || id;
  const advMark = (a) => (a === "advantage" ? " [+]" : a === "disadvantage" ? " [−]" : "");

  // An attempt the agent left open: the Warden rules on it, or calls for a roll.
  function renderOutcome() {
    const card = $("outcome");
    const oc = S.outcomeCheck;
    card.hidden = !oc;
    if (!oc) { card.dataset.id = ""; return; }
    if (card.dataset.id === oc.id) return;
    card.dataset.id = oc.id;
    card.innerHTML = `
      <div class="label">⚖ Your call: the players are attempting</div>
      <div class="attempt">${esc(oc.attempt || "(something uncertain)")}</div>
      ${oc.suggested_check !== "none" ? `<div class="muted small">Agent suggests: ${esc(checkName(oc.suggested_check))}${advMark(oc.advantage)}</div>` : ""}
      ${oc.why ? `<div class="note">${esc(oc.why)}</div>` : ""}
      <div class="row wrap">
        <button data-oc="success" class="primary">✓ It works</button>
        <button data-oc="failure" class="danger">✗ It fails</button>
        <button data-oc="roll">🎲 Call for a roll</button>
        <span class="grow"></span>
        <button data-oc="dismiss" class="ghost">Dismiss</button>
      </div>`;
  }

  $("outcome").addEventListener("click", (e) => {
    const act = e.target.closest("[data-oc]")?.dataset.oc;
    const oc = S?.outcomeCheck;
    if (!act || !oc) return;
    if (act === "success" || act === "failure") send({ t: "outcome", verdict: act });
    else if (act === "dismiss") send({ t: "outcomeDismiss" });
    else if (act === "roll") {
      // Pre-fill the roll form from the agent's suggestion.
      if (oc.suggested_check !== "none") $("rollCheck").value = oc.suggested_check;
      $("rollAdv").value = oc.advantage || "none";
      $("rollReason").value = oc.attempt || "";
      rollFromOutcome = true;
      $("rollCard").scrollIntoView({ behavior: "smooth", block: "center" });
      $("rollStat").focus();
    }
  });

  let rollFromOutcome = false;
  function renderRoll() {
    const sel = $("rollCheck");
    if (!sel.options.length) {
      const checks = Object.entries(S.rollOptions.checks);
      const group = (kind) => checks.filter(([, c]) => c.kind === kind).map(([id, c]) => `<option value="${id}">${c.label}</option>`).join("");
      sel.innerHTML = `<optgroup label="Stats">${group("Stat")}</optgroup><optgroup label="Saves">${group("Save")}</optgroup>`;
      sel.value = "intellect";
    }
    const r = S.roll;
    const box = $("rollStatus");
    box.hidden = !r;
    $("rollCall").disabled = r?.status === "waiting";
    if (!r) return;
    const label = `${checkName(r.check)}${advMark(r.advantage)}${r.bonus ? ` · ${r.skill || "skill"} +${r.bonus}` : ""}${r.reason ? ` · ${r.reason}` : ""}`;
    if (r.status === "waiting") {
      box.innerHTML = `<div><span class="spinner"></span>Waiting for the players to roll: <b>${esc(label)}</b>${r.stat === null ? " (they'll enter their value)" : ` vs ${r.stat + r.bonus}`}</div>
        <div class="row"><button data-roll="cancel" class="ghost">Cancel roll</button></div>`;
    } else {
      const res = r.result;
      const dice = res.dice.map((d) => String(d).padStart(2, "0")).join(" / ");
      box.innerHTML = `<div class="res ${res.success ? "ok" : "bad"}">🎲 ${esc(label)}
${dice}${res.dice.length > 1 ? ` → ${String(res.used).padStart(2, "0")}` : ""} vs ${res.target}${r.manual ? " (table dice)" : ""} — ${res.outcome.toUpperCase()}${res.success ? "" : " · +1 STRESS"}</div>
        <div class="row"><button data-roll="narrate" class="primary">Have the agent narrate it</button><span class="grow"></span><button data-roll="clear" class="ghost">Clear</button></div>`;
    }
  }

  $("rollCall").onclick = () => {
    send({
      t: "rollRequest",
      fromOutcome: rollFromOutcome,
      roll: {
        check: $("rollCheck").value,
        advantage: $("rollAdv").value,
        skill: $("rollSkill").value,
        skillLevel: $("rollSkillLevel").value,
        stat: $("rollStat").value,
        reason: $("rollReason").value,
      },
    });
    rollFromOutcome = false;
  };
  $("rollStatus").addEventListener("click", (e) => {
    const act = e.target.closest("[data-roll]")?.dataset.roll;
    if (act === "cancel" || act === "clear") send({ t: "rollCancel" });
    else if (act === "narrate") send({ t: "rollNarrate" });
  });

  // ------------------------------------------------------------ session controls
  $("keyBtn").onclick = openKeyDialog;
  $("keywarn").onclick = openKeyDialog;
  $("sessionCode").onclick = () => copy(playerLink(), "Player link");
  $("copyPlayer").onclick = () => copy(playerLink(), "Player link");
  $("copyWarden").onclick = async () => (await sure("Copy the Warden link?", "It opens this console on another device. Anyone who has it can run your session (but never sees your API key).", "Copy link", "primary")) && copy(wardenLink(), "Warden link");
  $("allSessions").onclick = () => { location.href = "dm"; };
  $("endSession").onclick = async () => {
    if (!(await sure(`End session ${code}?`, "For everyone: the log, voices and settings are deleted and players are disconnected.", "End session"))) return;
    send({ t: "endSession" });
  };

  if (code && key) {
    $("sessionCode").textContent = code;
    $("codeInline").textContent = code;
    $("playerUrl").textContent = playerLink();
    $("preview").src = `./?s=${code}&spectate=1`;
    document.title = `Warden · ${code}`;
    connect();
  } else {
    showStart(code ? `This device isn't the Warden for session ${code}. Open it with its Warden link.` : "");
  }
})();
