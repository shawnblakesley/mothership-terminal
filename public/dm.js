(() => {
  const $ = (id) => document.getElementById(id);
  const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

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
  let key = code ? store.get(tokenKey(code)) : null;
  let ws, S = null;
  let appVersion = null;
  let pendingKey = "";
  const dirty = new Set();

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const send = (msg) => ws?.readyState === 1 && ws.send(JSON.stringify(msg));
  async function upload(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "X-Warden-Token": key, "Content-Type": "application/octet-stream" }, body });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out.error || `Upload failed (${r.status}).`);
    return out;
  }
  const time = (ts) => new Date(ts).toTimeString().slice(0, 5);
  const screensAt = (id) => (S.screens || []).filter((s) => s.terminal === id).map((s) => s.character || "a screen");

  const skillStr = (s) => (typeof s === "string" ? s : `${s.name} +${s.bonus}`);
  const fxIcon = (inner) => `<svg class="fxi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const fxLabel = (f, icon) => `${FX_META[f.type]?.[0] || icon} ${esc(f.type)}${f.text ? ` "${esc(f.text)}"` : ""} · ${f.seconds || "∞"}s`;
  const FX_META = {
    blood: [fxIcon('<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>'), "Blood"],
    goo: [fxIcon('<path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/>'), "Goo"],
    crack: [fxIcon('<path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"/>'), "Crack"],
    ice: [fxIcon('<path d="m10 20-1.25-2.5L6 18"/><path d="M10 4 8.75 6.5 6 6"/><path d="m14 20 1.25-2.5L18 18"/><path d="m14 4 1.25 2.5L18 6"/><path d="m17 21-3-6h-4"/><path d="m17 3-3 6 1.5 3"/><path d="M2 12h6.5L10 9"/><path d="m20 10-1.5 2 1.5 2"/><path d="M22 12h-6.5L14 15"/><path d="m4 10 1.5 2L4 14"/><path d="m7 21 3-6-1.5-3"/><path d="m7 3 3 6h4"/>'), "Ice"],
    alarm: [fxIcon('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4"/><path d="M12 16h.01"/>'), "Hacker alarm"],
    redalert: [fxIcon('<path d="M7 18v-6a5 5 0 1 1 10 0v6"/><path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z"/><path d="M21 12h1"/><path d="M18.5 4.5 18 5"/><path d="M2 12h1"/><path d="M12 2v1"/><path d="m4.929 4.929.707.707"/><path d="M12 12v6"/>'), "Red alert"],
    glitch: [fxIcon('<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>'), "Glitch"],
    static: [fxIcon('<path d="m17 2-5 5-5-5"/><rect width="20" height="15" x="2" y="7" rx="2"/>'), "Static"],
    blackout: [fxIcon('<path d="M18.36 6.64A9 9 0 0 1 20.77 15"/><path d="M6.16 6.16a9 9 0 1 0 12.68 12.68"/><path d="M12 2v4"/><path d="m2 2 20 20"/>'), "Blackout"],
    lockout: [fxIcon('<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'), "Lockout"],
    banner: [fxIcon('<path d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/><path d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14"/><path d="M8 6v8"/>'), "Banner"],
  };

  let autoKeySent = false, autoSttSent = false;
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
        return showStart(ev.code === 4004 ? `Session ${code} has ended.` : `Not the Warden for ${code}. Use its Warden link.`);
      }
      setTimeout(connect, ev.code === 4029 ? 10000 : 1500);
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.t === "state") {
        if (appVersion && msg.state.version && msg.state.version !== appVersion) return location.reload();
        appVersion = msg.state.version;
        S = msg.state;
        render();
        const p = S.providers.find((x) => x.id === S.config.provider);
        const remembered = p && store.get(`wardenKey:${p.id}`);
        if (p && !p.configured && remembered && !autoKeySent) {
          autoKeySent = true;
          send({ t: "apiKey", provider: p.id, key: remembered });
        }
        const groq = S.discord?.enabled && !S.discord.sttKey && store.get("wardenKey:groq");
        if (groq && !autoSttSent) { autoSttSent = true; send({ t: "sttKey", key: groq }); }
        if (!ws.voicesAnnounced) { ws.voicesAnnounced = true; announceVoices(); }
      } else if (msg.t === "speak") speakHere(msg);
      else if (msg.t === "toast") toast(msg.text, msg.level);
      else if (msg.t === "handoutWriting") handoutWriting(msg.busy);
      else if (msg.t === "handoutDraft") {
        $("docTitle").value = msg.title;
        $("docText").value = msg.text;
        $("docText").rows = Math.min(14, Math.max(4, msg.text.split("\n").length + 1));
        toast("Handout drafted. Review it, then hand it out.");
      }
    };
  }

  const localVoices = () => store.get("localVoices") !== "0";
  function announceVoices() {
    const r = Speech.ready, on = localVoices();
    $("localVoices").checked = on;
    $("localVoicesNote").textContent = !on ? "off: the server makes them"
      : `${r.espeak ? "ready" : "starting"}; human voices ${r.neural ? "ready" : r.neuralFailed ? "made by the server (they didn't sound right in this browser)" : "loading (a one-time download)"}`;
    if (!on) return send({ t: "voiceEngine", on: false });
    Speech.start(announceVoices);
    send({ t: "voiceEngine", on: r.espeak, neural: r.neural });
  }
  $("localVoices").onchange = (e) => {
    store.set("localVoices", e.target.checked ? "1" : "0");
    if (!e.target.checked) Speech.stop();
    announceVoices();
  };
  async function speakHere({ id, engine, text, opts, fx }) {
    try {
      const { wav, seconds } = await Speech.make(engine, text, opts, fx);
      const r = await fetch(`api/sessions/${code}/spoken/${id}`, { method: "POST", headers: { "X-Warden-Token": key, "X-Speech-Seconds": String(seconds), "Content-Type": "application/octet-stream" }, body: wav });
      if (!r.ok) throw new Error(r.status);
    } catch {
      send({ t: "spokenFailed", id });
    }
  }

  function toast(text, level = "info") {
    const el = $("toast");
    el.textContent = text;
    el.className = `toast ${level}`;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.hidden = true), 5000);
  }

  const playerLink = () => new URL(`./?s=${code}`, location.href).href;
  const streamLink = () => `${new URL(`stream?s=${code}`, new URL("./", location.href)).href}#key=${S?.streamKey || ""}`;
  const wardenLink = () => `${new URL(`dm?s=${code}`, new URL("./", location.href)).href}#token=${key}`;

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
      const onClose = () => done("");
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
    catch { ask(`Copy the ${what.toLowerCase()}`, "Copying was blocked. Copy it from below.", [], text); }
  }

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

  let FREE_NOTE = "";
  async function showStart(error = "") {
    FREE_NOTE ||= $("newFreeNote").textContent;
    document.body.classList.add("starting");
    $("start").hidden = false;
    $("startErr").textContent = error;
    const provs = await loadProviders();
    const sel = $("newProvider");
    sel.innerHTML = provs.map((p) => `<option value="${esc(p.id)}">${esc(p.label)} · ${p.free ? "free, rate-limited" : p.localKey ? "local key" : `cheapest: ${esc(p.models[0].label)}`}</option>`).join("");
    const local = provs.find((p) => p.localKey);
    if (local) sel.value = local.id;
    const syncProv = () => {
      const p = provs.find((x) => x.id === sel.value);
      const free = !!p?.free || !!p?.localKey;
      $("newKeyFields").hidden = free;
      $("newKey").required = !free;
      $("newFreeNote").hidden = !free;
      $("newFreeNote").textContent = p?.localKey ? `Uses the ${p.label} key in your .env file.` : FREE_NOTE;
      $("newKeyNote").hidden = free;
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
    if (c && await sure(`Forget session ${c}?`, "It keeps running. You'll need its Warden link to return.", "Forget")) {
      store.del(tokenKey(c));
      showStart();
    }
  });

  $("createForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const provider = $("newProvider").value;
    const chosen = providerCatalog.find((p) => p.id === provider);
    const free = !!chosen?.free || !!chosen?.localKey;
    const apiKey = free ? "" : $("newKey").value.trim();
    $("createBtn").disabled = true;
    $("startErr").textContent = "";
    try {
      const r = await fetch("api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, apiKey }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Couldn't create a session (${r.status}).`);
      if (!free) {
        if ($("newRemember").checked) store.set(`wardenKey:${provider}`, apiKey);
        else store.del(`wardenKey:${provider}`);
      }
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
      $("startErr").textContent = "Not a Warden link. Expected …/dm?s=CODE#token=…";
    }
  });

  function openKeyDialog() {
    const sel = $("keyProvider");
    const keyed = S.providers.filter((p) => !p.free);
    sel.innerHTML = keyed.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}${p.configured ? " ✓" : ""}</option>`).join("");
    sel.value = keyed.some((p) => p.id === S.config.provider) ? S.config.provider : keyed[0].id;
    const sync = () => {
      const p = S.providers.find((x) => x.id === sel.value);
      $("keyValue").value = "";
      $("keyValue").placeholder = p.configured ? "•••••••• set, paste to replace" : p.keyHint;
      $("keyLink2").href = p.keyUrl || "#";
      $("keyRemember").checked = !!store.get(`wardenKey:${p.id}`);
      $("keyRemove").hidden = !p.configured;
      $("keyStatus").textContent = p.configured
        ? "Key set."
        : "No key. The agent can't reply without one.";
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

  function renderPanicTable() {
    const list = $("panicTable");
    if (list.childElementCount || !S.panicTable) return;
    list.innerHTML = S.panicTable.map((e) => `<li><b>${esc(e.name)}.</b> ${esc(e.effect[0].toUpperCase() + e.effect.slice(1))}</li>`).join("");
  }

  function render() {
    renderAgentPicker();
    renderPanicTable();
    for (const b of $("mode").children) b.classList.toggle("on", b.dataset.mode === S.config.mode);
    renderLog();
    renderPending();
    renderEffects();
    renderConfig();
    renderSendAs();
    renderVoices();
    renderOutcome();
    renderRoll();
    renderCombat();
    renderSounds();
    renderClocks();
    renderHazards();
    renderShip();
    renderHandouts();
    renderCastLists();
    renderMap();
    renderCrew();
    renderNewChars();
    renderMemorial();
    renderCast();
    renderAdversaries();
    renderTerminals();
    renderTerminalsPlay();
    renderConnections();
    renderCastPlay();
    renderBuilder();
    renderCampaign();
    renderSynopsis();
    renderRoom();
    renderMnavDot();
    renderDiscord();
    renderDiscordButton();
    renderVoicesOn();
    $("retcon").disabled = !S.canRetcon;
    $("retcon").textContent = S.canRetcon > 1 ? `↶ Retcon last response (${S.canRetcon})` : "↶ Retcon last response";
  }

  const DISCORD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>';
  const discordReady = () => !!(S?.discord?.enabled && S.discord.sttKey);

  let micMode = "", micTitle = null;
  function renderDiscordButton() {
    const d = S.discord || {}, btn = $("micBtn"), on = discordReady();
    micTitle ??= btn.title;
    if (on && listening) setListening(false);
    const mode = on ? `discord|${d.listening ? `${d.listening.channel}|${d.listening.guild}` : ""}` : "mic";
    if (mode !== micMode) {
      micMode = mode;
      btn.classList.toggle("discord", on);
      if (on) {
        btn.innerHTML = DISCORD_ICON;
        btn.setAttribute("aria-label", d.listening ? "Discord: listening. Stop it" : "Discord: copy the listen command");
        btn.setAttribute("aria-pressed", String(!!d.listening));
        btn.title = d.listening
          ? `Listening in ${d.listening.channel}. Click to stop.`
          : "Copy the Discord listen command";
      } else {
        btn.removeAttribute("aria-label");
        btn.title = micTitle;
        btn.textContent = listening ? "Listening" : "Listen";
        btn.setAttribute("aria-pressed", String(listening));
      }
    }
  }
  const listenCommand = () => `/terminal listen code:${code}`;
  function copyDiscordCommand() {
    const cmd = listenCommand();
    navigator.clipboard.writeText(cmd).then(() => toast("Copied. Send it in your voice channel's chat."), () => copy(cmd, "Command"));
  }

  function renderDiscord() {
    const d = S.discord || {};
    $("discordOff").hidden = !!d.enabled;
    $("discordOn").hidden = !d.enabled;
    if (!d.enabled) return;
    $("sttKey").placeholder = d.sttKey ? "Groq key set, paste to replace" : "Groq API key";
    $("sttRemember").checked = !!store.get("wardenKey:groq");
    $("discordInvite").href = d.invite || "#";
    $("discordInvite").hidden = !d.invite;
    $("discordState").textContent = d.listening
      ? `Listening in ${d.listening.channel} (${d.listening.guild}).${d.sttKey ? "" : " Add a Groq key to transcribe."}`
      : "Not listening.";
    $("discordStop").hidden = !d.listening;
    const roster = [d.listening?.warden && ["Warden", d.listening.warden], ...(d.players || []).map((p) => [p.as, p.name])].filter(Boolean);
    $("discordRoster").innerHTML = roster.map(([as, name]) => `<li><b>${esc(as)}</b>: ${esc(name)}</li>`).join("") || '<li class="muted">Nobody yet.</li>';
    $("discordCode").hidden = !!d.listening;
    $("discordCmd").value = listenCommand();
  }

  const optionsHtml = (pairs, current) => pairs.map(([v, label]) => `<option value="${esc(v)}" ${v === current ? "selected" : ""}>${esc(label)}</option>`).join("");
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
  }

  let lastLogLen = -1;
  function speaker(e) {
    const by = e.source === "dm" ? "you" : e.source === "agent" ? "agent" : "";
    const who = (name) => (e.inPerson && e.character ? `${e.character} (in person)` : e.character ? `${name} · ${e.character}` : name);
    switch (e.kind) {
      case "player": return { name: e.by ? `Player · ${e.by}` : "Players", c: "var(--player)" };
      case "warden": return { name: "Warden → agent", c: "var(--warden)" };
      case "aside": return { name: "Note → agent", by: "private", c: "var(--aside)" };
      case "aside_reply": return { name: "Agent → you", by: "private", c: "var(--aside)" };
      case "heard": return { name: "Warden · said aloud", by: e.speaker ? "on Discord → agent" : "speech → agent", c: "var(--heard)" };
      case "table": return { name: `${e.playing ? `${e.playing} · ${e.speaker || "player"}` : e.speaker || "Player"} · table talk`, by: "on Discord → agent", c: "var(--table)" };
      case "roll": return { name: "Roll result", c: "var(--roll)" };
      case "terminal": return { name: who(voiceName("terminal")), by, c: "var(--accent)" };
      case "system": return { name: who(voiceName("broadcast")), by, c: "var(--warn)" };
      case "entity": {
        const v = S.config.voices.find((x) => x.id === e.entity);
        return { name: who(v?.name || e.entity), by: [by, (e.shownAs ?? (v?.adversary && !v.adversary.revealed ? "???" : "")) === "???" ? "seen as ???" : "", e.reveal ? "revealed here" : ""].filter(Boolean).join(" · "), c: v?.color || "var(--entity)" };
      }
      default: return null;
    }
  }

  const crewName = (id) => S.config.crew.find((c) => c.id === id)?.name || id;
  const variantsHtml = (e) => (e.variants || []).map((v) =>
    `<div class="var"><span class="vfor">↳ ${esc(v.to.map(crewName).join(", "))}${v.for && !v.to.some((id) => crewName(id).toLowerCase() === v.for.toLowerCase()) ? ` (${esc(v.for)})` : ""}</span>\n${esc(v.text)}</div>`).join("");

  const netKey = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const systemName = (net) => (net === "*" ? "All" : S.config.terminals.find((t) => t.system && netKey(t.system) === net)?.system || net);

  function renderLog() {
    const log = $("log");
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.innerHTML = S.log.map((e) => {
      const sp = speaker(e);
      const del = `<button class="del" data-del="${e.id}" title="Delete, also from agent memory">✕</button>`;
      const when = `<span class="time">${time(e.ts)}</span>`;
      if (!sp) {
        const fx = /^Agent triggered effect: (.*?)(?: (before|after) line #\d+)?$/.exec(e.text);
        const txt = fx ? `${FX_META[fx[1].split(" ")[0]]?.[0] || "⚡"} ${esc(fx[1])}${fx[2] === "after" ? " · after this line" : ""}` : esc(e.text);
        return `<div class="entry note${fx ? " fx" : ""}"><span class="txt">${txt}</span>${when}${del}</div>`;
      }
      return `
      <div class="entry ${e.kind} ${e.hidden ? "hidden-on-player" : ""} ${e.cut ? "cut" : ""}" style="--c: ${sp.c}" ${e.cut ? `title="${e.retcon ? "Retconned: removed from screens and agent memory" : "Cut off by a player: never shown or remembered"}"` : ""}>
        <div class="who"><span class="tag">${esc(sp.name)}</span>${sp.by ? `<span class="by">${sp.by}</span>` : ""}${e.net ? `<span class="by" title="${e.net === "*" ? "Sent to every system" : "Shown only on this system"}">${e.net === "*" ? "to All" : `on ${esc(systemName(e.net))}`}</span>` : ""}${e.hidden ? '<span class="by">cleared from screen</span>' : ""}${e.cut ? `<span class="by">${e.retcon ? "retconned" : "cut off"}</span>` : ""}${when}</div>
        <div class="txt">${e.text ? esc(e.text) : e.variants?.length ? '<span class="muted">(everyone else sees nothing)</span>' : ""}${variantsHtml(e)}${e.kind === "aside_reply" && e.changes?.length ? `<div class="chg">${e.changes.map((c) => `${esc(c.path)} → ${esc(c.value)}`).join(" · ")}</div>` : ""}</div>${del}
      </div>`;
    }).join("") || `<div class="muted small">Nothing yet. Waiting for the crew.</div>`;
    if (atBottom || S.log.length !== lastLogLen) log.scrollTop = log.scrollHeight;
    lastLogLen = S.log.length;
  }

  const hasKey = () => !!S.providers?.find((p) => p.id === S.config.provider)?.configured;

  function renderPending() {
    const p = S.pending;
    const card = $("pending");
    const k = p ? `${p.status}|${p.forEntry}|${JSON.stringify(p.reply || p.error || "")}` : `none|${hasKey()}`;
    $("noKeyNote").hidden = hasKey();
    if (k === pendingKey) return;
    pendingKey = k;
    card.hidden = !p;
    const forText = p?.forEntry ? S.log.find((e) => e.id === p.forEntry)?.text : null;
    const forLine = forText ? `<div class="label">Replying to: <span class="muted">${esc(forText.slice(0, 120))}</span></div>` : "";

    if (!p) { card.innerHTML = ""; return; }
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
      <div class="label">Draft reply <span class="muted">Ctrl+Enter sends</span></div>
      <div id="draftLines">${(r.lines.length ? r.lines : [{ voice: "terminal", text: "" }]).map(draftLine).join("")}</div>
      <div class="row"><button data-act="addLine" class="ghost">+ Line</button></div>
      ${p.directives?.length ? `<div class="note">⚑ Following your command${p.directives.length > 1 ? "s" : ""}: ${p.directives.map(esc).join(" · ")}</div>` : ""}
      ${r.crew_changes?.length ? `<div class="label">Crew condition</div><ul>${r.crew_changes.map((c, i) =>
        `<li><label><input type="checkbox" data-crw="${i}" ${S.config.agentCrew !== false ? "checked" : ""}> ${esc(c.for)}: ${esc(c.stat)} ${c.change > 0 ? "+" : ""}${c.change}${c.why ? ` <span class="muted">(${esc(c.why)})</span>` : ""}</label></li>`).join("")}</ul>` : ""}
      ${r.attacks?.length || r.crew_attacks?.length || r.reloads?.length || r.round || r.reveal_death_save?.length ? `<div class="label">Combat <span class="muted">rolled by the app when you send</span></div><ul>${[
        ...(r.attacks || []).map((a) => `${esc(a.by)} attacks ${esc(a.target)}${a.attack ? ` with ${esc(a.attack)}` : ""}`),
        ...(r.crew_attacks || []).map((a) => `${esc(a.by)} hits ${esc(a.target)} with ${esc(a.weapon || "Unarmed")}`),
        ...(r.reloads || []).map((a) => `${esc(a.by)} reloads ${esc(a.weapon || "their weapon")}`),
        ...(r.round ? ["A round passes: Bleeding hurts"] : []),
        ...(r.reveal_death_save || []).map((n) => `Death Save revealed: ${esc(n)}`),
      ].map((t) => `<li>${t}</li>`).join("")}</ul>` : ""}
      ${alsoList(r).length ? `<div class="label">Also happens when you send</div><ul>${alsoList(r).map((x) => `<li>${x}</li>`).join("")}</ul>` : ""}
      ${r.ship_fight ? `<div class="label">Ship fight <span class="muted">applied when you send</span></div><ul>${[
        r.ship_fight.start && `Starts a ship fight with ${esc(r.ship_fight.start.ship)} at ${esc(r.ship_fight.start.range)} range`,
        r.ship_fight.enemy_move && `The enemy chooses ${esc(r.ship_fight.enemy_move)}${r.ship_fight.fuel ? `, ${r.ship_fight.fuel} fuel` : ""}`,
        typeof r.ship_fight.enemy_fire === "boolean" && `The enemy ${r.ship_fight.enemy_fire ? "fires" : "holds fire"}`,
        r.ship_fight.end && "Ends the ship fight",
      ].filter(Boolean).map((t) => `<li>${t}</li>`).join("")}</ul>` : ""}
      ${r.station_changes.length ? `<div class="label">Station changes</div><ul>${r.station_changes.map((c, i) =>
        `<li><label><input type="checkbox" data-chg="${i}" checked> ${esc(c.path)} → ${esc(c.value)}</label></li>`).join("")}</ul>` : ""}
      ${r.effects.length ? `<div class="label">Effects</div><ul>${r.effects.map((f, i) =>
        `<li><label><input type="checkbox" data-eff="${i}" ${S.config.agentEffects ? "checked" : ""}> ${fxLabel(f, "")}</label></li>`).join("")}</ul>` : ""}
      ${r.outcome_check?.needed ? `<div class="note">⚖ Your call: <b>${esc(r.outcome_check.attempt)}</b>${r.outcome_check.suggested_check !== "none" ? ` · suggests ${esc(checkName(r.outcome_check.suggested_check))}${advMark(r.outcome_check.advantage)}` : ""}</div>` : ""}
      ${r.dm_note ? `<div class="note">Agent note: ${esc(r.dm_note)}</div>` : ""}
      <div class="row"><button data-act="approve" class="primary">Send to players</button><button data-act="discard" class="ghost">Discard</button></div>
      ${steerRow()}
      <div class="row"><button data-act="regen">↻ Regenerate</button></div>`;
  }
  // The parts of an agent draft that have no checkbox: they are applied as written when the Warden sends.
  function alsoList(r) {
    const n = (c) => esc(c.name || c.for || "");
    return [
      ...(r.item_changes || []).map((c) => `${esc(c.for)} ${c.action === "add" ? "gets" : c.action === "use" ? "uses" : "loses"} ${esc(c.item)}`),
      ...(r.hazards || []).map((h) => (h.type === "none" ? `Hazard ends in ${esc(h.room)}` : `Hazard in ${esc(h.room)}: ${esc(h.type)}${h.level ? ` (level ${h.level})` : ""}`)),
      ...(r.time_passes?.hours > 0 ? [`${r.time_passes.hours} hour${r.time_passes.hours > 1 ? "s" : ""} pass`] : []),
      ...(r.moves || []).map((m) => `${esc(m.for)} moves to ${esc(m.terminal)}`),
      ...(r.cast_changes || []).map((c) => `${n(c)}: ${[c.room && (c.room === "none" ? "leaves the map" : `to ${esc(c.room)}`), c.notes && esc(c.notes), c.attitude_change && `attitude ${c.attitude_change > 0 ? "+" : ""}${c.attitude_change}`, c.stress_change && `Stress ${c.stress_change > 0 ? "+" : ""}${c.stress_change}`, c.panic_check && "Panic Check"].filter(Boolean).join(", ") || "no change"}`),
      ...(r.clocks || []).map((c) => (c.action === "stop" ? `Clock stops: ${esc(c.label)}` : `Clock starts: ${esc(c.label)} (${c.seconds}s)`)),
      ...(r.handouts || []).map((h) => `Handout${h.for ? ` for ${esc(h.for)}` : ""}: ${esc(h.title)}`),
      ...(r.found_docs || []).map((f) => `File found: ${esc(f.id)}`),
      ...(r.layout ? ["The map layout changes"] : []),
      ...(r.room_plans || []).map((p) => `Floor plan redrawn: ${esc(p.room)}`),
      ...(r.story_end?.ended ? [`The story ends: ${esc(r.story_end.how)}`] : []),
    ];
  }
  const systemNames = () => [...new Set([S.config.stationName, ...S.config.terminals.filter((t) => t.system).map((t) => t.system)])];
  const sysSelect = (system) => {
    const names = systemNames();
    if (names.length < 2) return "";
    const want = netKey(system);
    const sel = want === "all" ? "ALL" : names.find((n) => netKey(n) === want) || "";
    const opts = [["", "(where they are)"], ...names.map((n) => [n, n]), ["ALL", "to All"]];
    return `<select class="dsys" aria-label="System" title="System that shows this line">${optionsHtml(opts, sel)}</select>`;
  };

  const draftLine = (l) => `
    <div class="dline" data-effects="${esc(JSON.stringify(l.effects || []))}" data-reveal="${esc(l.reveal || "")}">
      <div class="dwho">
        <select aria-label="Voice">${optionsHtml(S.config.voices.map((v) => [v.id, v.name]), l.voice)}</select>
        ${sysSelect(l.system)}
        <input class="dchar" list="castNames" value="${esc(l.character || "")}" placeholder="who" aria-label="Character" title="Speaking character" ${l.voice === S.config.castChannel || l.character ? "" : "hidden"}>
      </div>
      <textarea rows="${Math.min(12, Math.max(2, l.text.split("\n").length))}" placeholder="${l.effects?.length ? "effect only" : ""}">${esc(l.text)}</textarea>
      <button data-act="delLine" class="ghost" title="Remove line">✕</button>
      <div class="dvars">${(l.variants || []).map(variantRow).join("")}
        <button data-act="addVar" class="ghost small" title="Alternate line for a player or class">+ Variant</button></div>
      ${l.effects?.length ? `<div class="dfx">${l.effects.map((f, i) => `<label class="chip"><input type="checkbox" data-leff="${i}" ${S.config.agentEffects ? "checked" : ""}> ${fxLabel(f, "⚡")} <span class="muted">as this line starts</span></label>`).join("")}</div>` : ""}
      ${l.reveal ? `<div class="dfx"><span class="chip">Shows the players ${esc(l.reveal)} as this line starts</span></div>` : ""}
    </div>`;
  const variantRow = (v) => `<div class="dvar">
      <input class="dvfor" list="variantTargets" value="${esc(v.for)}" placeholder="for: name or class" aria-label="Variant for">
      <textarea class="dvtext" rows="${Math.min(8, Math.max(1, v.text.split("\n").length))}" aria-label="Their version">${esc(v.text)}</textarea>
      <button data-act="delVar" class="ghost" title="Remove variant">✕</button></div>`;
  function renderCastLists() {
    const targets = [...S.config.crew.map((c) => c.name), ...new Set(S.config.crew.map((c) => c.className)), "Humans"];
    $("castLists").innerHTML = `<datalist id="variantTargets">${targets.map((t) => `<option value="${esc(t)}">`).join("")}</datalist>` +
      `<datalist id="castNames">${(S.config.cast || []).map((c) => `<option value="${esc(c.name)}">`).join("")}</datalist>`;
  }
  const steerRow = () => `<input id="steer" placeholder="Steer the rewrite">`;

  function renderEffects() {
    const list = $("fxActive");
    list.innerHTML = S.effects.length
      ? S.effects.map((f) => `<li><span>${FX_META[f.type]?.[0] || ""}</span>
          <span class="grow">${esc(f.type)}${f.text ? ` · "${esc(f.text)}"` : ""}${f.source === "agent" ? " · <em>agent</em>" : ""}
          · ${f.seconds ? `${Math.max(0, Math.ceil(f.seconds - (Date.now() - f.startedAt) / 1000))}s` : "∞"}</span>
          <button data-endfx="${f.id}">End</button></li>`).join("")
      : `<li class="none">None</li>`;
  }

  const CREW_CLASSES = ["Teamster", "Android", "Scientist", "Marine"];
  let crewDraft = null, crewTimer = null, crewSentAt = 0;
  const sendCrewNow = () => { crewSentAt = 0; send({ t: "crew", crew: crewDraft }); };

  function renderCrew(fromDraft = false) {
    const panel = $("crew");
    if (!fromDraft) {
      const editing = panel.contains(document.activeElement) || crewTimer !== null || Date.now() - crewSentAt < 1500;
      const json = JSON.stringify([S.config.crew, S.claims, S.screens, S.config.terminals.map((t) => t.name), discordReady() && S.discord.players, S.deathSaves]);
      if ((crewDraft && editing) || panel.dataset.json === json) return;
      panel.dataset.json = json;
      crewDraft = structuredClone(S.config.crew);
    }
    const num = (k, v, label) => `<label>${label}<input type="number" data-c="${k}" value="${v}" min="0" max="99"></label>`;
    const txt = (k, v, label, rows = 0) => rows
      ? `<label class="wide">${label}<textarea data-c="${k}" rows="${rows}">${esc(v)}</textarea></label>`
      : `<label class="wide">${label}<input data-c="${k}" value="${esc(v)}"></label>`;
    panel.innerHTML = crewDraft.map((c, i) => {
      const playing = S.claims?.[c.id] || 0;
      const onDiscord = discordReady() && S.discord.players?.find((p) => p.crew === c.id);
      return `<details class="pc" data-i="${i}">
        <summary>${pickButton(c, `class="pick small" data-pcpic="${i}"`)}<span class="pcname ${playing ? "online" : "offline"}" title="${playing ? `Playing on ${playing} screen${playing > 1 ? "s" : ""}` : "No player has picked them"}">${esc(c.name || "Unnamed")}</span>${onDiscord ? `<span class="dlogo" title="Played on Discord by ${esc(onDiscord.name)}" aria-label="On Discord: ${esc(onDiscord.name)}">${DISCORD_ICON}</span>` : ""}
          <span class="muted small">${esc(c.className)} · High Score ${c.highScore || 0} · Stress ${c.stress} · HP ${c.health.current}/${c.health.max} · AP ${c.armor?.destroyed ? 0 : c.armor?.ap ?? 0}${c.cond?.dead ? " · DECEASED" : ""}${c.retired ? " · RETIRED" : ""}</span>
          ${playing ? `<span class="muted small where">at <select data-move="${esc(c.id)}" title="Move to another terminal" aria-label="Move ${esc(c.name)} to">${
            (whereIs(c.id) ? "" : '<option value="" selected>(none yet)</option>') + S.config.terminals.map((t) =>
            `<option value="${esc(t.id)}" ${S.screens?.find((s) => s.characterId === c.id)?.terminal === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></span>` : ""}</summary>
        ${pcSheet(c)}
        <div class="pcgrid edit-only">
          ${txt("name", c.name, "Name")}
          <label>Pronouns<input data-c="pronouns" value="${esc(c.pronouns)}"></label>
          <label>Class<select data-c="className">${CREW_CLASSES.map((k) => `<option ${k === c.className ? "selected" : ""}>${k}</option>`).join("")}</select></label>
          ${txt("role", c.role, "Role")}
          ${Object.entries(c.stats).map(([k, v]) => num(`stats.${k}`, v, k[0].toUpperCase() + k.slice(1))).join("")}
          ${Object.entries(c.saves).map(([k, v]) => num(`saves.${k}`, v, `${k[0].toUpperCase() + k.slice(1)} save`)).join("")}
          ${num("health.current", c.health.current, "Health")}${num("health.max", c.health.max, "Max health")}
          ${num("wounds.current", c.wounds.current, "Wounds")}${num("wounds.max", c.wounds.max, "Max wounds")}
${num("stress", c.stress, "Stress")}${num("minStress", c.minStress, "Min stress")}${num("startStress", c.startStress, "Starting stress")}
          <label title="Sessions survived (PSG 18.3). Changes no roll.">High Score<input type="number" data-c="highScore" value="${c.highScore || 0}" min="0" max="9999"></label>

          ${txt("armor.name", c.armor.name, "Armor")}${num("armor.ap", c.armor.ap, "Armor AP")}${num("armor.dr", c.armor.dr, "Armor DR")}
          <label>Armor destroyed<input type="checkbox" data-c="armor.destroyed" ${c.armor.destroyed ? "checked" : ""}></label>
          ${txt("skills", c.skills.map(skillStr).join(", "), "Skills")}
          ${txt("crime", c.crime, "Conviction", 2)}
          ${txt("backstory", c.backstory, "Backstory", 4)}
          ${txt("loadout", c.loadout, "Starting loadout", 2)}
          ${txt("items", c.items.join(", "), "Items carried")}
          ${txt("trinket", c.trinket, "Trinket")}
          ${txt("patch", c.patch, "Patch")}
          ${txt("notes", c.notes, "Warden notes, hidden from players", 2)}
          <label>Standing<select data-cstate="${esc(c.id)}"><option value="">Playing</option>${["deceased", "retired"].map((k) => `<option value="${k}" ${(k === "deceased" ? c.cond?.dead : c.retired) ? "selected" : ""}>${cap(k)}</option>`).join("")}</select></label>
        </div>
        <div class="row edit-only"><span class="grow"></span><button data-cact="del" class="danger">Remove character</button></div>
      </details>`;
    }).join("") || `<p class="muted small">No player characters. Add some, or build a story.</p>`;
    for (const i of openCrew) panel.querySelector(`.pc[data-i="${i}"]`)?.setAttribute("open", "");
    $("addCrew").disabled = crewDraft.filter((c) => !c.cond?.dead && !c.retired).length >= 4;
  }
  // The memorial wall: a CRT crew manifest of the dead and retired, names struck through. High Score is sessions survived (PSG 18.3).
  function memorialHtml(crew) {
    const list = crew.filter((c) => c.cond?.dead || c.retired);
    if (!list.length) return '<p class="muted small">Nobody yet.</p>';
    return `<div class="memorial">${list.map((c) => `<div class="memo">
      ${c.portrait ? `<img class="memo-pic" src="${esc(portraitUrl(c.portrait))}" alt="">` : ""}
      <div class="memo-body"><div><s class="memo-name">${esc(c.name)}</s> <span class="muted small">${esc(c.className)}</span></div>
        <div class="small"><span class="k">HIGH SCORE</span> <b>${c.highScore || 0}</b></div>
        <div class="small">${esc(c.cond?.dead ? (c.cond.dead === "Warden" ? "Marked deceased by the Warden" : `Died: ${c.cond.dead}`) : "Retired from play")}${c.endedIn ? ` · ${esc(c.endedIn)}` : ""}</div>
        ${c.finalWords ? `<div class="small memo-final">Final transmission: "${esc(c.finalWords)}"</div>` : ""}
        <input data-epitaph="${esc(c.id)}" value="${esc(c.epitaph || "")}" placeholder="Epitaph, one line" maxlength="140" aria-label="Epitaph for ${esc(c.name)}"></div></div>`).join("")}</div>`;
  }
  let memorialKey = "";
  function renderMemorial() {
    const el = $("memorial"), crew = S.config.crew, key = JSON.stringify(crew.map((c) => [c.id, c.name, c.cond?.dead, c.retired, c.highScore, c.endedIn, c.finalWords, c.epitaph, c.portrait]));
    if (key === memorialKey || el.contains(document.activeElement)) return;
    memorialKey = key;
    el.innerHTML = memorialHtml(crew);
  }
  document.addEventListener("change", (e) => {
    const id = e.target.closest?.("[data-epitaph]")?.dataset.epitaph;
    if (id) send({ t: "epitaph", pc: id, text: e.target.value });
  });
  $("endNight").onclick = () => send({ t: "endNight" });
  let newCharsKey = "";
  function renderNewChars() {
    const list = S.newChars || [], key = JSON.stringify(list);
    if (key === newCharsKey) return;
    newCharsKey = key;
    const nums = (o) => Object.entries(o).map(([k, v]) => `${cap(k)} ${v}`).join(", ");
    $("newChars").innerHTML = list.map((n) => {
      const c = n.sheet, old = n.replaces && S.config.crew.find((x) => x.id === n.replaces);
      return `<div class="pc newchar" data-id="${esc(n.id)}"><h3>New character waiting: ${esc(c.name)}</h3>
        <div class="muted small">${esc(c.className)}${esc(c.pronouns ? `, ${c.pronouns}` : "")}${old ? `. Replaces ${esc(old.name)} (${old.cond?.dead ? "deceased" : "retired"}).` : ""}</div>
        <div class="small">Stats: ${esc(nums(c.stats))}<br>Saves: ${esc(nums(c.saves))}<br>Health ${c.health.max}, Wounds ${c.wounds.max}, Stress ${c.stress} (min ${c.minStress}).<br>Skills: ${esc(c.skills.map(skillStr).join(", "))}<br>Loadout: ${esc(c.loadout || "(not filled in)")}<br>Trinket: ${esc(c.trinket || "(not filled in)")}<br>Patch: ${esc(c.patch || "(not filled in)")}<br>${esc(c.notes)}</div>
        <details><summary class="muted small">Every roll</summary><ul class="small">${n.history.map((h) => `<li>${esc(h)}</li>`).join("")}</ul></details>
        <div class="row wrap"><button data-cg="accept" class="primary">Accept</button><input data-cg-note placeholder="Note for the player, if rejecting" size="28" aria-label="Rejection note"><button data-cg="reject" class="danger">Reject with a note</button></div></div>`;
    }).join("");
  }
  $("crew").addEventListener("change", (e) => {
    const id = e.target.dataset?.cstate;
    if (id) send({ t: "crewState", pc: id, state: e.target.value });
  });
  $("newChars").addEventListener("click", (e) => {
    const act = e.target.closest("[data-cg]")?.dataset.cg, card = e.target.closest(".newchar");
    if (act && card) send({ t: act === "accept" ? "cgAccept" : "cgReject", id: card.dataset.id, note: card.querySelector("[data-cg-note]").value });
  });
  let castDraft = null, castTimer = null, castSentAt = 0;
  const ATTITUDES = [[-3, "Hostile"], [-2, "Resentful"], [-1, "Wary"], [0, "Neutral"], [1, "Friendly"], [2, "Trusting"], [3, "Loyal"]];
  const portraitUrl = (file) => (file.startsWith("kit/") ? `portraits/${file.slice(4)}` : `api/sessions/${code}/portraits/${file}`);
  const initials = (name) => { const w = name.split(/\s+/).filter(Boolean); return ((w[0]?.[0] || "") + (w.length > 1 ? w.at(-1)[0] : "")).toUpperCase(); };
  const pickButton = (m, attrs) => `<button ${attrs} title="${m.portrait ? "Change their picture" : "Add a picture"}" aria-label="Picture of ${esc(m.name)}">${m.portrait ? `<img src="${esc(portraitUrl(m.portrait))}" alt="">` : `<span>${esc(initials(m.name) || "+")}</span>`}</button>`;
  function renderCast(fromDraft = false) {
    const panel = $("cast");
    if (!fromDraft) {
      const editing = panel.contains(document.activeElement) || castTimer !== null || Date.now() - castSentAt < 1500;
      const json = JSON.stringify([S.config.cast, S.config.castChannel, S.config.map, S.screens, S.config.terminals.map((t) => t.room), S.config.voices.map((v) => [v.id, v.name])]);
      if ((castDraft && editing) || panel.dataset.json === json) return;
      panel.dataset.json = json;
      castDraft = structuredClone(S.config.cast || []);
    }
    fillSelect($("castChannel"), S.config.voices.filter((v) => !["terminal", "narrator"].includes(v.id)).map((v) => [v.id, v.name]), S.config.castChannel);
    const rooms = roomLabels();
    const withPlayers = new Set((S.screens || []).map((sc) => S.config.terminals.find((t) => t.id === sc.terminal)?.room).filter(Boolean));
    const speakers = Object.entries(S.voiceOptions.speakers);
    panel.innerHTML = castDraft.map((m, i) => `<div class="castm" data-i="${i}">
        ${pickButton(m, `class="pick" data-mact="pic"`)}
        <div class="castbody">
          <div class="row wrap">
            <input data-m="name" class="edit-only cname" value="${esc(m.name)}" placeholder="Name" aria-label="Name">
            <b class="play-only">${esc(m.name)}</b>
            <label class="small muted where">in <select data-m="room" aria-label="Where ${esc(m.name)} is"><option value="">nowhere on the map</option>${
              optionsHtml([...rooms], m.room)}${
              m.room && !rooms.has(m.room) ? `<option value="${esc(m.room)}" selected>${esc(m.room)}</option>` : ""}</select></label>
            <label class="small muted mood" title="Attitude to the players (this app's scale, not a Mothership rule), hidden from them">feels <select data-m="attitude" data-num aria-label="How ${esc(m.name)} feels about the players" class="att${m.attitude > 0 ? " up" : m.attitude < 0 ? " down" : ""}">${
              ATTITUDES.map(([n, label]) => `<option value="${n}" ${n === (m.attitude || 0) ? "selected" : ""}>${label} (${n > 0 ? "+" : ""}${n})</option>`).join("")}</select></label>
            <label class="small muted stress" title="Stress, 0-20">Stress <input type="number" data-m="stress" data-num min="0" max="20" value="${m.stress ?? 2}" aria-label="${esc(m.name)}'s Stress"></label>
            <button data-mact="panic" class="small" title="Roll d20: at or under Stress, they panic">Panic check</button>
            ${withPlayers.has(m.room) ? '<span class="pill ok" title="Face to face with players">in person</span>' : '<span class="pill" title="Heard over the intercom">intercom</span>'}
          </div>
          <div class="row wrap edit-only small">
            <select data-m="voice" aria-label="Their voice"><option value="">(a voice of their own)</option>${speakers.map(([id, label]) => `<option value="${id}" ${id === m.voice ? "selected" : ""}>${esc(label)}</option>`).join("")}</select>
            <button data-mact="test" title="Preview voice here">▶</button>
            <span class="grow"></span><button data-mact="del" class="ghost" title="Remove ${esc(m.name)}">✕</button>
          </div>
          <input data-m="why" class="why" value="${esc(m.why || "")}" placeholder="Affinity reason" aria-label="Why ${esc(m.name)} feels that way">
          <textarea data-m="notes" class="edit-only" rows="2" placeholder="Who they are, how they talk" aria-label="Notes">${esc(m.notes)}</textarea>
          ${m.notes ? `<div class="play-only small muted">${esc(m.notes)}</div>` : ""}
        </div>
      </div>`).join("") || `<p class="muted small">No characters yet. The agent adds them as needed.</p>`;
  }
  function saveCast(now = false) {
    clearTimeout(castTimer);
    const go = () => {
      castTimer = null;
      castSentAt = Date.now();
      send({ t: "cast", cast: castDraft, channel: $("castChannel").value });
    };
    if (now) go();
    else castTimer = setTimeout(go, 500);
  }
  $("cast").addEventListener("input", (e) => {
    const key = e.target.dataset.m;
    const card = e.target.closest(".castm");
    if (!key || !card) return;
    castDraft[Number(card.dataset.i)][key] = "num" in e.target.dataset ? Number(e.target.value) : e.target.value;
    saveCast(e.target.tagName === "SELECT");
  });
  $("cast").addEventListener("focusout", () => setTimeout(() => S && renderCast(), 1600));
  $("castChannel").addEventListener("change", () => saveCast(true));
  let picFor = null;
  $("cast").addEventListener("click", async (e) => {
    const act = e.target.closest("[data-mact]")?.dataset.mact;
    const card = e.target.closest(".castm");
    if (!act || !card) return;
    const i = Number(card.dataset.i), m = castDraft[i];
    if (act === "pic") openPortraits({ cast: i });
    else if (act === "panic") send({ t: "castPanic", id: m.id });
    else if (act === "test") Voice.test({ name: "test", voice: { engine: "neural", speaker: m.voice || "am_michael", pace: 1 }, fx: {} }, $("testText").value || "Testing.", `api/sessions/${code}/tts-test`, key);
    else if (act === "del") {
      if (!(await sure(`Remove ${m.name || "this character"}?`, "The agent forgets them.", "Remove"))) return;
      castDraft.splice(castDraft.indexOf(m), 1);
      saveCast(true);
      renderCast(true);
    }
  });
  $("addCast").onclick = () => {
    let n = castDraft.length + 1;
    while (castDraft.some((c) => c.name === `New character ${n}`)) n++;
    castDraft.push({ id: "", name: `New character ${n}`, voice: "", notes: "", room: "", portrait: "", attitude: 0, why: "", stress: 2 });
    saveCast(true);
    renderCast(true);
    $("cast").querySelector(".castm:last-of-type .cname")?.select();
  };
  const picTarget = () => (picFor?.crew !== undefined ? crewDraft[picFor.crew] : castDraft[picFor?.cast]);
  function setPortrait(file) {
    const m = picTarget();
    if (!m) return;
    m.portrait = file;
    if (picFor.crew !== undefined) { saveCrew(); renderCrew(true); }
    else { saveCast(true); renderCast(true); }
    $("portraitDialog").close();
  }
  let pack = null;
  async function openPortraits(target) {
    picFor = target;
    const m = picTarget();
    if (!m) return;
    $("portraitTitle").textContent = `Picture: ${m.name || "unnamed"}`;
    $("portraitNone").disabled = !m.portrait;
    $("portraitDialog").showModal();
    pack ??= await fetch("portraits/pack.json").then((r) => r.json()).catch(() => []);
    $("portraitGrid").innerHTML = pack.map((id) => `<button data-face="${esc(id)}" class="${m.portrait === `kit/${id}.png` ? "on" : ""}" title="No. ${esc(id.replace("sfcp-", ""))}"><img src="portraits/${esc(id)}.png" alt="Portrait ${esc(id.replace("sfcp-", ""))}" loading="lazy"></button>`).join("");
    $("portraitGrid").querySelector(".on")?.scrollIntoView({ block: "center" });
  }
  $("portraitGrid").addEventListener("click", (e) => {
    const id = e.target.closest("[data-face]")?.dataset.face;
    if (id) setPortrait(`kit/${id}.png`);
  });
  $("portraitUpload").onclick = () => { $("portraitFile").value = ""; $("portraitFile").click(); };
  $("portraitNone").onclick = () => setPortrait("");

  $("portraitFile").addEventListener("change", async () => {
    const file = $("portraitFile").files[0];
    if (!file || !picTarget()) return;
    try {
      const img = await createImageBitmap(file);
      const side = Math.min(img.width, img.height), SIZE = 128;
      const cv = Object.assign(document.createElement("canvas"), { width: SIZE, height: SIZE });
      const g = cv.getContext("2d");
      g.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
      const px = g.getImageData(0, 0, SIZE, SIZE), d = px.data;
      for (let i = 0; i < d.length; i += 4) {
        const light = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        d[i + 3] = Math.min(255, Math.round((255 - light) * 1.15 * (d[i + 3] / 255)));
        d[i] = d[i + 1] = d[i + 2] = 255;
      }
      g.putImageData(px, 0, 0);
      const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
      setPortrait((await upload(`api/sessions/${code}/portraits`, blob)).file);
    } catch (err) {
      toast(err.message || "That picture couldn't be used.", "error");
    }
  });

  let advTimer = null, advFor = null;
  const advSrc = (pic) => (/^https:\/\//.test(pic) ? pic : `api/sessions/${code}/portraits/${pic}`);
  function renderAdversaries() {
    const panel = $("adversaries");
    const editing = panel.contains(document.activeElement) && document.activeElement.matches("input:not([type=checkbox]), textarea");
    const list = S.config.voices.filter((v) => v.adversary);
    const json = JSON.stringify(list);
    if (editing || advTimer || panel.dataset.json === json) return;
    panel.dataset.json = json;
    const presets = Object.keys(S.voiceOptions.presets);
    panel.innerHTML = list.map((v) => `<div class="castm advm" data-id="${esc(v.id)}">
        <button class="pick big" data-aact="pic" title="${v.adversary.picture ? "Change its picture" : "Add a picture"}" aria-label="Picture of ${esc(v.name)}">${v.adversary.picture ? `<img src="${esc(advSrc(v.adversary.picture))}" alt="" referrerpolicy="no-referrer">` : "<span>+</span>"}</button>
        <div class="castbody">
          <div class="row wrap">
            <input data-a="name" class="edit-only cname" value="${esc(v.name)}" aria-label="Its name">
            <b class="play-only" style="color: ${esc(v.color || "inherit")}">${esc(v.name)}</b>
            <label class="small check" title="Seen by players? If not, shown as ???">
              <input type="checkbox" data-a="revealed" ${v.adversary.revealed ? "checked" : ""}> revealed</label>
            <span class="pill ${v.adversary.revealed ? "ok" : ""}">${v.adversary.revealed ? "players see its name" : "players see ???"}</span>
            ${v.adversary.picture ? `<button data-aact="show" class="small" title="Show on every screen. Reveals it.">Show players</button>` : ""}
          </div>
          <div class="row wrap edit-only small">
            <select data-a="preset" aria-label="How it sounds">${presets.map((p) => `<option ${p === v.preset ? "selected" : ""}>${p}</option>`).join("")}${v.preset === "custom" ? '<option selected value="custom">custom (Story tab)</option>' : ""}</select>
            <button data-aact="test" title="Preview voice here">▶</button>
            <input type="color" data-a="color" value="${esc(v.color || "#ff5a5a")}" aria-label="Its colour">
            ${v.adversary.picture ? '<button data-aact="nopic" class="ghost">Remove picture</button>' : ""}
            <span class="grow"></span><button data-aact="del" class="ghost" title="Remove ${esc(v.name)}">✕</button>
          </div>
          <input data-a="picture" class="edit-only why" value="${esc(/^https:\/\//.test(v.adversary.picture) ? v.adversary.picture : "")}" placeholder="Or a picture link (https://…)" aria-label="Picture link">
          ${v.adversary.picture ? `<input data-a="credit" class="edit-only why" value="${esc(v.adversary.credit || "")}" placeholder="Picture credit" aria-label="Picture credit">` : ""}
          ${advStats(v)}
          <textarea data-a="persona" class="edit-only" rows="3" aria-label="What it is" placeholder="What it is, how it acts">${esc(v.persona)}</textarea>
          <div class="play-only small advinfo">${esc(v.persona)}</div>
        </div>
      </div>`).join("") || '<p class="muted small">No adversaries yet.</p>';
  }
  let combatKey = "";
  function renderCombat() {
    const advs = S.config.voices.filter((v) => v.adversary?.stats);
    const crew = S.config.crew;
    const side = $("atkSide").value;
    const key = JSON.stringify([advs.map((v) => [v.id, v.name, v.adversary.stats.attacks, v.adversary.stats.dead]), crew.map((c) => [c.id, c.name, c.cond?.bleeding, c.cond?.dead]), S.weaponsOf, S.deathSaves, side]);
    if (key === combatKey) return;
    combatKey = key;
    const [by, with_, target] = [$("atkBy"), $("atkWith"), $("atkTarget")];
    const was = [by.value, with_.value, target.value];
    $("atkAdvWrap").hidden = side !== "crew";
    $("atkWithLabel").textContent = side === "crew" ? "Weapon" : "Attack";
    const crewOpts = crew.filter((c) => !c.cond?.dead).map((c) => [c.id, c.name]);
    const advOpts = advs.filter((v) => !v.adversary.stats.dead).map((v) => [v.id, v.name]);
    fillSelect(by, side === "crew" ? crewOpts : advOpts, was[0]);
    fillSelect(target, side === "crew" ? advOpts : crewOpts, was[2]);
    for (const sel of [by, target]) if (sel.selectedIndex < 0 && sel.options.length) sel.selectedIndex = 0;
    attackChoices();
    $("atkGo").disabled = !by.options.length || !target.options.length;
    $("atkNote").textContent = !advs.length ? "No adversary has combat numbers yet: add them on the Crew tab, under Adversaries." : side === "crew" ? "Use it after the character's Combat check has succeeded. Its damage is rolled and taken off the adversary. A character in a Rage (Panic Table 16) has [+] on Damage rolls for 1d10 hours: pick [+] below." : "";
    const saves = crew.filter((c) => S.deathSaves?.[c.id]);
    $("deathSaveList").innerHTML = saves.map((c) => `<li>Death Save rolled (hidden): ${esc(c.name)} <button data-cmb="reveal" data-pc="${esc(c.id)}" class="ghost" title="Someone spent a turn checking their vitals">Reveal</button></li>`).join("");
  }
  function attackChoices() {
    const side = $("atkSide").value, by = $("atkBy").value;
    const opts = side === "crew" ? (S.weaponsOf?.[by] || ["Unarmed"]) : (S.config.voices.find((v) => v.id === by)?.adversary.stats?.attacks || []).map((a) => `${a.name} (${a.damage} ${a.woundType}${a.woundAdv ? ` [${a.woundAdv}]` : ""})`);
    const values = side === "crew" ? opts : (S.config.voices.find((v) => v.id === by)?.adversary.stats?.attacks || []).map((a) => a.name);
    fillSelect($("atkWith"), values.map((v, i) => [v, opts[i]]), $("atkWith").value);
    if ($("atkWith").selectedIndex < 0 && $("atkWith").options.length) $("atkWith").selectedIndex = 0;
  }
  for (const id of ["atkSide"]) $(id).addEventListener("change", () => { combatKey = ""; renderCombat(); });
  $("atkBy").addEventListener("change", attackChoices);
  $("atkGo").onclick = () => {
    const side = $("atkSide").value;
    send({ t: "attack", attack: side === "crew"
      ? { side, pc: $("atkBy").value, weapon: $("atkWith").value, target: $("atkTarget").value, damageAdv: $("atkAdv").value }
      : { side, by: $("atkBy").value, attack: $("atkWith").value, target: $("atkTarget").value } });
  };
  $("deathSaveList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cmb]");
    if (b) send({ t: "revealDeathSave", pc: b.dataset.pc });
  });

  const ATTACK_TIP ="One attack per line: Name | damage dice | wound type | [+] or [-] on its Wounds Table roll | special. Wound types: blunt, bleeding, gunshot, fire, gore.";
  const attackLines = (s) => s.attacks.map((a) => [a.name, a.damage, a.woundType, a.woundAdv, a.special].join(" | ")).join("\n");
  const parseAttacks = (text) => text.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p[0] && p[1])
    .map(([name, damage, woundType, woundAdv, special]) => ({ name, damage, woundType: (woundType || "blunt").toLowerCase(), woundAdv: woundAdv === "+" || woundAdv === "-" ? woundAdv : "", special: special || "" }));
  function advStats(v) {
    const s = v.adversary.stats;
    if (!s) return `<div class="row edit-only small"><button data-aact="addstats" title="Combat, Instinct, armor, Wounds and attacks (PSG 40-41)">Add combat numbers</button></div>`;
    const track = Array.from({ length: s.woundsMax }, (_, i) => `<i class="${i < s.wounds ? "on" : ""}"></i>`).join("");
    const num = (k, label, min = 0, max = 999) => `<label>${label}<input type="number" data-s="${k}" value="${s[k]}" min="${min}" max="${max}"></label>`;
    return `<div class="advstats ${s.dead ? "dead" : ""}">
        <div class="row wrap small">
          <span><b>Combat ${s.combat}</b> · Instinct ${s.instinct} · ${s.ap ? `AP ${s.ap}${s.armorDestroyed ? " (destroyed)" : ""}` : "no armor"}${s.dr ? ` · DR ${s.dr}` : ""}${s.count ? ` · ${s.count} of them` : ""}</span>
          <span class="wtrack" title="Wounds left (${s.wounds} of ${s.woundsMax}), ${s.healthPerWound} Health each">${track}</span>
          <label class="inl">Health <input type="number" data-s="health" value="${s.health}" min="0" max="${s.healthPerWound}"> / ${s.healthPerWound}</label>
          <label class="inl">Wounds <input type="number" data-s="wounds" value="${s.wounds}" min="0" max="${s.woundsMax}"> / ${s.woundsMax}</label>
          ${s.dead ? '<b class="bad">DEAD OR DESTROYED</b>' : ""}
          <button data-aact="resetstats" class="ghost" title="Full Wounds, full Health, armor back">Reset</button>
        </div>
        <div class="small advinfo">${s.attacks.map((a) => `${esc(a.name)} ${esc(a.damage)} ${esc(a.woundType)}${a.woundAdv ? ` [${a.woundAdv}]` : ""}${a.special ? ` (${esc(a.special)})` : ""}`).join(" · ") || "No attacks."}${s.special ? `<br>${esc(s.special)}` : ""}${s.note ? `<br>${esc(s.note)}` : ""}</div>
        <div class="edit-only advedit">
          <div class="pcgrid">${num("combat", "Combat", 1, 300)}${num("instinct", "Instinct", 1, 300)}${num("ap", "Armor AP", 0, 99)}${num("dr", "DR", 0, 99)}${num("woundsMax", "Wounds", 1, 20)}${num("healthPerWound", "Health per Wound", 1, 999)}${num("count", "Count (groups)", 0, 99)}</div>
          <textarea data-s="attacks" rows="3" aria-label="Attacks" title="${esc(ATTACK_TIP)}" placeholder="${esc(ATTACK_TIP)}">${esc(attackLines(s))}</textarea>
          <textarea data-s="special" rows="2" aria-label="Special" placeholder="Special: how it is beaten, what it does">${esc(s.special)}</textarea>
          <input data-s="note" value="${esc(s.note || "")}" aria-label="Note" placeholder="Note (a group is written per individual)">
        </div>
      </div>`;
  }
  const advPatch = (id, patch) => send({ t: "adversary", id, patch });
  $("adversaries").addEventListener("input", (e) => {
    const sk = e.target.dataset.s, sid = e.target.closest(".advm")?.dataset.id;
    if (sk && sid) {
      clearTimeout(advTimer);
      advTimer = setTimeout(() => {
        advTimer = null;
        const el = e.target;
        advPatch(sid, { stats: { [sk]: sk === "attacks" ? parseAttacks(el.value) : el.type === "number" ? Number(el.value) : el.value } });
      }, 600);
      return;
    }
    const key = e.target.dataset.a, id = e.target.closest(".advm")?.dataset.id;
    if (!key || !id) return;
    if (key === "revealed") return advPatch(id, { revealed: e.target.checked });
    if (key === "preset" || key === "color") return advPatch(id, { [key]: e.target.value });
    clearTimeout(advTimer);
    advTimer = setTimeout(() => { advTimer = null; advPatch(id, { [key]: e.target.value }); }, 600);
  });
  $("adversaries").addEventListener("focusout", () => setTimeout(() => S && renderAdversaries(), 1200));
  $("adversaries").addEventListener("click", async (e) => {
    const act = e.target.closest("[data-aact]")?.dataset.aact, id = e.target.closest(".advm")?.dataset.id;
    const v = S.config.voices.find((x) => x.id === id);
    if (!act || !v) return;
    if (act === "pic") { advFor = id; $("advFile").value = ""; $("advFile").click(); }
    else if (act === "nopic") advPatch(id, { picture: "" });
    else if (act === "show") send({ t: "adversaryShow", id });
    else if (act === "addstats") advPatch(id, { stats: {} });
    else if (act === "resetstats") { const s = v.adversary.stats; advPatch(id, { stats: { wounds: s.woundsMax, health: s.healthPerWound, dead: false, armorDestroyed: false } }); }
    else if (act === "test") Voice.test(v, $("testText").value || "i can hear you.", `api/sessions/${code}/tts-test`, key);
    else if (act === "del" && (await sure(`Remove ${v.name}?`, "Removes it and its voice from the story.", "Remove"))) send({ t: "adversaryDel", id });
  });
  $("addAdversary").onclick = () => send({ t: "adversaryAdd" });
  $("advFile").addEventListener("change", async () => {
    const file = $("advFile").files[0];
    if (!file || !advFor) return;
    try {
      const img = await createImageBitmap(file);
      const scale = Math.min(1, 720 / Math.max(img.width, img.height));
      const cv = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      const blob = await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.82));
      advPatch(advFor, { picture: (await upload(`api/sessions/${code}/portraits`, blob)).file });
    } catch (err) {
      toast(err.message || "That picture couldn't be used.", "error");
    }
  });

  const cap = (k) => k[0].toUpperCase() + k.slice(1);
  function pcSheet(c) {
    const nums = (o) => Object.entries(o).map(([k, v]) => `<span>${cap(k)} <b>${v}</b></span>`).join("");
    const line = (label, v) => (v ? `<div><span class="k">${label}:</span> ${esc(v)}</div>` : "");
    return `<div class="pcsheet play-only">
      <div class="nums"><span class="k">Stats</span>${nums(c.stats)}</div>
      <div class="nums"><span class="k">Saves</span>${nums(c.saves)}</div>
      <div class="vitals">
        <label>Health <input type="number" data-c="health.current" value="${c.health.current}" min="0" max="99"> / ${c.health.max}</label>
        <label>Wounds <input type="number" data-c="wounds.current" value="${c.wounds.current}" min="0" max="99"> / ${c.wounds.max}</label>
        <label>Stress <input type="number" data-c="stress" value="${c.stress}" min="0" max="99"> Min <input type="number" data-c="minStress" value="${c.minStress}" min="0" max="20" title="Minimum Stress: Stress never goes below it" aria-label="Minimum Stress"></label>
      </div>
      ${combatLine(c)}
      ${line("Skills", c.skills.map(skillStr).join(", "))}${itemsLine(c)}${condLine(c)}${line("Trinket", c.trinket)}${line("Patch", c.patch)}${line("Credits", `${(c.credits || 0).toLocaleString("en-US")}cr`)}${line("Notes", c.notes)}${line("Trauma response", S.traumaResponses?.[c.className])}
    </div>`;
  }
  const combatLine = (c) => {
    const a = c.armor || { name: "None", ap: 0, dr: 0 };
    const btn = (cmd, text, title) => `<button type="button" class="small" data-cmb="${cmd}" data-pc="${esc(c.id)}" title="${esc(title)}">${text}</button>`;
    const bits = [`<span><span class="k">Armor:</span> ${esc(a.name)} AP ${a.ap}${a.dr ? ` DR ${a.dr}` : ""}${a.destroyed ? ' <b class="bad">destroyed</b>' : ""}</span>`];
    if (a.destroyed) bits.push(btn("repair", "Mark repaired", "Armor repair costs half the armor's original cost"));
    if (c.cond?.dead) bits.push(`<b class="bad">DECEASED</b> <span class="muted">${esc(c.cond.dead)}</span>`);
    if (c.status) bits.push(`<b class="bad">${esc(cap(c.status))}</b>${c.statusNote ? ` <span class="muted">${esc(c.statusNote)}</span>` : ""}`);
    if (c.deathSaveIn) bits.push(`<b class="bad">Death Save due in ${c.deathSaveIn} rounds</b>`);
    if (S.deathSaves?.[c.id]) bits.push("<b>Death Save rolled (hidden)</b>", btn("reveal", "Reveal", "Someone spent a turn checking their vitals: reveal and apply the result"));
    if (c.deathSaveIn || c.cond?.dying || c.status) bits.push(btn("dealt", "Dealt with", "Clear the countdown and the status"));
    for (const w of S.ammo?.[c.id] || []) bits.push(`<span><span class="k">${esc(w.name)}:</span> <b class="${w.loaded ? "" : "bad"}">${w.loaded}/${w.shots}</b> shots, ${w.spare} spare</span> <button type="button" class="small" data-cmb="reload" data-pc="${esc(c.id)}" data-weapon="${esc(w.name)}" title="Reloading is an action: swap in a spare magazine (Ammo is 50cr a magazine)" ${w.spare && w.loaded < w.shots ? "" : "disabled"}>Reload</button>`);
    return `<div class="combatline">${bits.join(" ")}</div>`;
  };
  const COND_ACTIONS = [["puncture", "Puncture suit"], ["patch", "Patch suit"], ["air", "Breathing again"], ["putout", "Put out fire"], ["bleed", "+1 Bleeding"], ["stopbleed", "Stop bleeding (First Aid Kit)"], ["ate", "Has eaten"], ["thirst", "Water at the minimum (toggle)"], ["strenuouscheck", "Strenuous activity on minimum water"], ["strenuous", "Strenuous activity (toggle)"], ["rest", "Rested 8 hours"], ["cryosleep", "Into cryosleep"], ["wake", "Wake from cryosleep"], ["stimpak", "Use a stimpak (PSG effect, overdose roll)"], ["tankout", "Oxygen tank used up"],["pills", "Radiation Pills"], ["clearrad", "Clear radiation penalty"], ["cleartags", "Clear story conditions"]];
  const condLine = (c) => `<div class="conds"><span class="k">Conditions:</span> ${(S.conds?.[c.id] || []).map((x) => `<span class="chip">${esc(x)}</span>`).join("") || '<span class="muted">none</span>'}
    <select data-cond-pick aria-label="Condition for ${esc(c.name)}">${COND_ACTIONS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}</select><button data-cond-go="${esc(c.id)}">Apply</button></div>`;
  $("crew").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cmb]");
    if (b?.dataset.cmb === "reload") send({ t: "reload", pc: b.dataset.pc, weapon: b.dataset.weapon });
    else if (b) {
      const t = { repair: "repairArmor", stop: "stopBleeding", reveal: "revealDeathSave", dealt: "dealtWith" }[b.dataset.cmb];
      if (t) send({ t, pc: b.dataset.pc });
    }
    const go = e.target.closest("[data-cond-go]");
    if (go) send({ t: "condition", pc: go.dataset.condGo, action: go.parentElement.querySelector("[data-cond-pick]").value });
  });
  const itemsLine = (c) => `<div class="items"><span class="k">Items:</span> ${c.items.map((x, j) => `<span class="chip">${esc(x)}<button data-item-del="${j}" title="Drop it" aria-label="Drop ${esc(x)}">✕</button></span>`).join("")}<input data-item-add placeholder="+ add" aria-label="Add an item" size="10"></div>`;
  const openCrew = new Set();
  const whereIs = (crewId) => {
    const id = S.screens?.find((s) => s.characterId === crewId)?.terminal;
    return S.config.terminals.find((t) => t.id === id)?.name || "";
  };
  $("crew").addEventListener("click", (e) => {
    const pic = e.target.closest("[data-pcpic]");
    if (!pic) return;
    e.preventDefault();
    openPortraits({ crew: Number(pic.dataset.pcpic) });
  });
  $("crew").addEventListener("change", (e) => {
    const who = e.target.dataset.move;
    if (who && e.target.value) { send({ t: "moveScreens", character: who, terminal: e.target.value }); e.target.blur(); }
  });
  for (const type of ["click", "keydown", "keyup"]) {
    $("crew").addEventListener(type, (e) => {
      if (!e.target.matches?.("summary select[data-move]")) return;
      if (type === "click") e.preventDefault();
      else if (e.key === " " || e.key === "Enter") e.stopPropagation();
    });
  }
  $("crew").addEventListener("toggle", (e) => {
    const i = e.target.dataset?.i;
    if (i !== undefined) e.target.open ? openCrew.add(i) : openCrew.delete(i);
  }, true);

  function saveCrew() {
    clearTimeout(crewTimer);
    crewTimer = setTimeout(() => {
      crewTimer = null;
      crewSentAt = Date.now();
      send({ t: "crew", crew: crewDraft });
      setTimeout(() => S && renderCrew(), 1600);
    }, 500);
  }
  $("crew").addEventListener("focusout", () => setTimeout(() => S && renderCrew(), 1600));
  $("crew").addEventListener("input", (e) => {
    const card = e.target.closest(".pc");
    const key = e.target.dataset.c;
    if (!card || !key) return;
    const c = crewDraft[Number(card.dataset.i)];
    const [a, b] = key.split(".");
    const val = e.target.type === "checkbox" ? e.target.checked : e.target.type === "number" ? Number(e.target.value) : key === "skills" || key === "items" ? e.target.value.split(",").map((x) => x.trim()).filter(Boolean) : e.target.value;
    if (b) c[a][b] = val;
    else c[a] = val;
    saveCrew();
  });
  $("crew").addEventListener("click", (e) => {
    const del = e.target.closest("[data-item-del]")?.dataset.itemDel;
    if (del === undefined) return;
    crewDraft[Number(e.target.closest(".pc").dataset.i)].items.splice(Number(del), 1);
    sendCrewNow();
  });
  $("crew").addEventListener("keydown", (e) => {
    if (!e.target.matches("[data-item-add]") || e.key !== "Enter" || !e.target.value.trim()) return;
    crewDraft[Number(e.target.closest(".pc").dataset.i)].items.push(e.target.value.trim());
    e.target.value = "";
    e.target.blur();
    sendCrewNow();
  });
  $("crew").addEventListener("click", async (e) => {
    if (e.target.closest("[data-cact]")?.dataset.cact !== "del") return;
    const i = Number(e.target.closest(".pc").dataset.i);
    if (!(await sure(`Remove ${crewDraft[i].name || "this character"}?`, "Deletes their crew file. Its player picks again.", "Remove"))) return;
    crewDraft.splice(i, 1);
    openCrew.clear();
    sendCrewNow();
  });
  $("addCrew").onclick = () => {
    if (crewDraft.filter((c) => !c.cond?.dead && !c.retired).length >= 4) return;
    crewDraft.push({
      name: "New convict", pronouns: "", className: "Teamster", role: "", crime: "", backstory: "",
      stats: { strength: 30, speed: 30, intellect: 30, combat: 30 }, saves: { sanity: 25, fear: 25, body: 25 },
      health: { current: 12, max: 12 }, wounds: { current: 0, max: 2 }, stress: 2, skills: [], loadout: "", items: [], trinket: "", patch: "", notes: "",
    });
    openCrew.add(String(crewDraft.length - 1));
    sendCrewNow();
  };

  let builderKey = "";
  function renderBuilder() {
    if (!$("builderDialog").open) return;
    const b = S.builder, busy = S.builderBusy;
    const key = JSON.stringify([b, busy]);
    if (key === builderKey) return;
    builderKey = key;
    const msgs = $("bmsgs");
    const intro = `<div class="bmsg agent"><b>Agent</b><div>Let's build a scenario. Tell me your idea, or say "surprise me". Press <b>Draft it</b> when ready.</div></div>`;
    msgs.innerHTML = intro + b.messages.map((m) => `<div class="bmsg ${m.role}${m.error ? " err" : ""}"><b>${m.role === "warden" ? "You" : "Agent"}</b><div>${esc(m.text)}</div></div>`).join("")
      + (busy ? `<div class="bmsg agent"><b>Agent</b><div><span class="spinner"></span>${busy === "draft" ? "Writing the scenario…" : "Thinking…"}</div></div>` : "");
    msgs.scrollTop = msgs.scrollHeight;
    for (const id of ["bSend", "bDraft", "bReset"]) $(id).disabled = !!busy;
    $("bDraft").classList.toggle("primary", !!b.messages.at(-1)?.ready);
    $("bDraft").textContent = b.draft ? "Redraft" : "Draft it";
    renderDraft(b.draft);
  }

  function renderDraft(d) {
    const el = $("bdraft");
    if (!d) { el.innerHTML = `<div class="muted bempty">The draft appears here.</div>`; return; }
    const voices = d.voices.map((v) => `<div class="bcard"><b>${esc(v.name)}</b> <span class="muted small">${esc(v.preset)}</span>
        <div class="small">${esc(v.persona)}</div></div>`).join("");
    const cast = (d.cast || []).length ? `<ul class="small">${d.cast.map((c) => `<li><b>${esc(c.name)}</b> <span class="muted">${esc(S.voiceOptions.speakers[c.voice] || c.sex)} · ${esc(c.room || "nowhere on the map")}</span> · ${esc(c.notes)}</li>`).join("")}</ul>` : "";
    const crew = d.crew.map((c) => `<div class="bcard"><b>${esc(c.name)}</b> <span class="muted small">${esc([c.pronouns, c.className, c.role].filter(Boolean).join(" · "))}</span>
        <div class="small">${esc(c.crime)}</div><div class="small muted">${esc(c.backstory)}</div>
        <div class="small mono">${["strength", "speed", "intellect", "combat"].map((k) => `${k.slice(0, 3).toUpperCase()} ${c.stats?.[k]}`).join(" · ")} | ${["sanity", "fear", "body"].map((k) => `${k.slice(0, 3).toUpperCase()} ${c.saves?.[k]}`).join(" · ")} | HP ${c.health_max}</div>
        <div class="small muted">${esc((c.skills || []).map(skillStr).join(", "))}</div></div>`).join("");
    el.innerHTML = `
      <div class="row"><div class="grow"><div class="btitle">${esc(d.title)}</div><div class="muted">${esc(d.stationName)} · ${esc(d.theme)} screen</div></div>
        <button id="bApply" class="primary">Apply story</button></div>
      <p>${esc(d.pitch)}</p>
      <details open><summary>Map</summary><div id="bmap" class="smap"></div></details>
      <details><summary>Lore <span class="muted">(public)</span></summary><pre class="bpre">${esc(d.lore)}</pre></details>
      <details><summary>Secrets</summary><pre class="bpre">${esc(d.secrets)}</pre></details>
      <details><summary>Computer: ${esc(d.computer.name)}</summary><pre class="bpre">${esc(d.computer.persona)}</pre>${d.standingOrders ? `<div class="small"><b>Standing orders:</b> ${esc(d.standingOrders)}</div>` : ""}</details>
      <details open><summary>Characters</summary>${cast || '<p class="muted">None.</p>'}</details>
      <details open><summary>Adversaries</summary>${(d.adversaries || []).map((a) => `<div class="bcard"><b>${esc(a.name)}</b> <span class="muted small">${esc(a.preset)}</span><div class="small">${esc(a.persona)}</div></div>`).join("") || '<p class="muted">None.</p>'}</details>
      <details><summary>Voices</summary>${voices || '<p class="muted">None.</p>'}</details>
      <details><summary>Terminals</summary><ul class="small">${(d.terminals || []).map((t) => `<li><b>${esc(t.name)}</b> <span class="muted">${esc(t.room)}${t.look?.length ? ` · ${esc(t.look.join(", "))}` : " · clean"}${t.open ? "" : " · not reachable at first"}</span> · ${esc(t.notes)}</li>`).join("")}<li class="muted">+ a handheld terminal</li></ul></details>
      <details open><summary>Player characters</summary>${crew || '<p class="muted">None.</p>'}</details>
      <details><summary>Starting documents</summary>${(d.documents || []).map((x) => `<div class="small"><b>${esc(x.title)}</b></div><pre class="bpre">${esc(x.text)}</pre>`).join("") || '<p class="muted">None.</p>'}</details>`;
    const st = {};
    for (const { path, value } of d.station) {
      const ks = path.split(".");
      let o = st;
      for (const k of ks.slice(0, -1)) o = o[k] = typeof o[k] === "object" ? o[k] : {};
      o[ks.at(-1)] = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
    }
    StationMap.draw($("bmap"), withCast(st, d.cast), d.map, { editable: false });
  }

  $("builderBtn").onclick = () => { builderKey = ""; $("builderDialog").showModal(); renderBuilder(); $("bInput").focus(); };
  const builderSend = () => {
    const text = $("bInput").value.trim();
    if (!text || S.builderBusy) return;
    send({ t: "builderSay", text });
    $("bInput").value = "";
  };
  $("bSend").onclick = builderSend;
  $("bInput").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); builderSend(); } });
  $("bDraft").onclick = () => send({ t: "builderDraft" });
  $("bReset").onclick = async () => (await sure("Start over?", "Clears the builder chat and draft. Your story stays.", "Start over")) && send({ t: "builderReset" });
  $("bdraft").addEventListener("click", async (e) => {
    if (e.target.id !== "bApply") return;
    if (!(await sure(`Apply "${S.builder.draft.title}"?`, "Replaces the story and crew, and clears the log. Players pick new crew files.", "Apply story", "primary"))) return;
    send({ t: "builderApply" });
    $("builderDialog").close();
    toast("New story applied.");
  });

  let campaignData = null, campaignKey = "", cmpSel = { kind: "overview", id: "" }, cmpOutcome = "";
  async function loadCampaigns() {
    if (campaignData) return campaignData;
    const r = await fetch("api/campaigns").catch(() => null);
    campaignData = r?.ok ? await r.json() : { acts: [], campaigns: [] };
    return campaignData;
  }
  const cmpLoc = (c, id) => c.locations.find((l) => l.id === id);
  const cmpPlace = (c, s) => (s.at ? `at ${cmpLoc(c, s.at).name}` : `in transit, ${cmpLoc(c, s.from).name} to ${cmpLoc(c, s.to).name}`);
  const cmpFaction = (c, id) => c.factions.find((f) => f.id === id);
  const TIERS = { 1: "early", 2: "mid campaign", 3: "late" };
  const STANDING = { "-3": "Enemy", "-2": "Hostile", "-1": "Wary", 0: "Neutral", 1: "Friendly", 2: "Trusted", 3: "Ally" };
  const signed = (n) => (n > 0 ? `+${n}` : String(n));
  let cmpTicks = new Set();
  // Pay, debt and dues are campaign house rules; the formulas mirror money.js.
  let cmpFin = { delivery: "full", late: false, skipDues: false, fee: "" };
  let cmpMove = { from: "", to: "rig", amount: "", what: "" };
  const DELIVERY = { full: ["Delivered in full", 1], partly: ["Delivered in part (half the fee)", 0.5], none: ["Not delivered", 0] };
  const kcr = (n) => (Math.abs(n) >= 1000 ? `${+(n / 1000).toFixed(2)}kcr` : `${Math.round(n)}cr`);
  const acctName = (p, a) => (a === "rig" ? "Rig account" : a === "debt" ? "Gallow-Mercer note" : p.crew.find((x) => x.id === a)?.name || "Outside the crew");
  function finishView(s, p) {
    const paid = p.upfront?.[s.id] || 0;
    const total = s.late && cmpFin.late ? 0 : Math.round((s.pay || 0) * DELIVERY[cmpFin.delivery][1]);
    const left = Math.max(0, total - paid);
    const fee = cmpFin.fee === "" ? left : Math.max(0, Math.round(Number(cmpFin.fee) || 0));
    const dues = Math.round(fee * 0.04);
    return { paid, total, left, fee, dues, net: fee - (cmpFin.skipDues ? 0 : dues) };
  }
  function cmpFinishBox(c, s, p) {
    const o = (k) => `<label class="cmpfx"><input type="radio" name="cmpDelivery" data-fin="delivery" value="${k}" ${cmpFin.delivery === k ? "checked" : ""}> ${DELIVERY[k][0]}</label>`;
    if (s.payoff) {
      const cleared = Math.round(p.debt * DELIVERY[cmpFin.delivery][1]);
      return `<div class="small"><b>The finale's pay</b> <span class="muted">(house rule: it pays off the note to Gallow-Mercer Finance instead of a fee)</span>${Object.keys(DELIVERY).map(o).join("")}
        <div>The note: ${cr(p.debt)} owed${cleared ? `; this clears ${cr(cleared)}` : "; nothing is cleared"}.</div></div>`;
    }
    const v = finishView(s, p);
    return `<div class="small"><b>Pay</b> <span class="muted">(house rule: the fee goes to the rig account less ${4}% union dues)</span>${Object.keys(DELIVERY).map(o).join("")}
      ${s.late ? `<label class="cmpfx"><input type="checkbox" data-fin="late" ${cmpFin.late ? "checked" : ""}> Delivered late (this job's fee is void if late)</label>` : ""}
      <label class="cmpfx"><input type="checkbox" data-fin="skipDues" ${cmpFin.skipDues ? "checked" : ""}> Skip dues (keeps the 4%, costs The Union -1 standing)</label>
      <div class="row"><label class="grow">Fee to pay now <span class="muted">(blank: ${cr(v.left)})</span></label><input type="number" min="0" style="width:7em" data-fin="fee" value="${esc(cmpFin.fee)}" placeholder="${v.left}" aria-label="Fee to pay now"></div>
      <div class="mono">Fee for the job ${cr(v.total)}${v.paid ? ` · paid up front ${cr(v.paid)}` : ""} · now ${cr(v.fee)}<br>Union dues ${cmpFin.skipDues ? "skipped" : `-${cr(v.dues)}`}<br>To the rig account ${cr(v.net)}</div></div>`;
  }
  function cmpMoney(c, p) {
    const sel = (key, extra) => `<select data-move="${key}">${extra}${[["rig", "Rig account"], ...p.crew.map((x) => [x.id, x.name])].map(([id, n]) => `<option value="${esc(id)}" ${cmpMove[key] === id ? "selected" : ""}>${esc(n)}${id === "rig" ? ` (${cr(p.money)})` : ` (${cr(p.crew.find((x) => x.id === id).credits || 0)})`}</option>`).join("")}</select>`;
    const out = (key, label) => `<option value="" ${cmpMove[key] === "" ? "selected" : ""}>${label}</option>`;
    const left = DEBT_EVERY - (p.finished % DEBT_EVERY);
    const rows = [...(p.ledger || [])].reverse().slice(0, 24).map((e) => `<tr><td>${esc(acctName(p, e.acct))}</td><td class="num ${e.amount < 0 ? "bad" : ""}">${e.amount > 0 ? "+" : "-"}${Math.abs(e.amount).toLocaleString("en-US")}cr</td><td class="num">${e.bal.toLocaleString("en-US")}cr</td><td class="small">${esc(e.what)}</td></tr>`).join("");
    return `<details open><summary>Money <span class="muted small">(pay, debt and dues are house rules; credits and starting credits are PSG)</span></summary>
      <div class="bcard"><div class="row wrap"><b>Rig account ${cr(p.money)}</b><span class="small">Debt ${cr(p.debt)} to Gallow-Mercer Finance</span></div>
        <div class="small muted">House rule: ${cr(6000)} is due every ${DEBT_EVERY} finished stories (${p.debt > 0 ? `next after ${left} more` : "paid off"}); a missed payment costs Gallow-Mercer standing -1 and sends a letter${p.missed ? `. Missed so far: ${p.missed}` : ""}.</div>
        <div class="small">${p.crew.map((x) => `${esc(x.name)} ${cr(x.credits || 0)}`).join(" · ")}</div></div>
      <div class="bcard"><div class="small muted">Move credits (the Warden's call): income, expenses, shore leave, medical treatment, ammo at 50cr a magazine, a payment on the note.</div>
        <div class="row wrap"><label class="small">From ${sel("from", out("from", "Outside the crew (income)"))}</label><label class="small">To <select data-move="to">${out("to", "Outside the crew (expense)")}<option value="debt" ${cmpMove.to === "debt" ? "selected" : ""}>Gallow-Mercer note (${cr(p.debt)})</option>${[["rig", "Rig account"], ...p.crew.map((x) => [x.id, x.name])].map(([id, n]) => `<option value="${esc(id)}" ${cmpMove.to === id ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label></div>
        <div class="row"><input type="number" min="1" style="width:7em" data-move="amount" value="${esc(cmpMove.amount)}" placeholder="credits" aria-label="Credits"><input class="grow" data-move="what" value="${esc(cmpMove.what)}" placeholder="What for" aria-label="What for"><button data-move-go>Move credits</button></div></div>
      <div class="bcard"><b>Ledger</b>${rows ? `<table class="small ledger"><tbody>${rows}</tbody></table>` : '<p class="muted small">Nothing yet.</p>'}</div></details>`;
  }

  function sectorSvg(c, p) {
    const done = new Set(p.done.map((d) => d.id));
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const stars = Array.from({ length: 140 }, () => `<circle cx="${(rnd() * 1100).toFixed(0)}" cy="${(rnd() * 560).toFixed(0)}" r="${(rnd() * 1.3 + 0.3).toFixed(1)}" opacity="${(rnd() * 0.5 + 0.15).toFixed(2)}"/>`).join("");
    const offered = p.offered || [], votes = S.sectorVotes || {};
    const cls = (s) => ["story", offered.includes(s.id) && "offered", done.has(s.id) && "done", p.current === s.id && "current", cmpSel.kind === "story" && cmpSel.id === s.id && "sel", S.campaignBusy === s.id && "busy"].filter(Boolean).join(" ");
    const lanes = c.lanes.map((l) => {
      const a = cmpLoc(c, l.a), b = cmpLoc(c, l.b);
      return `<line class="lane${l.dark ? " dark" : ""}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"><title>${esc(l.name)} · ${l.days} days</title></line>`;
    }).join("");
    const transit = c.stories.filter((s) => !s.at).map((s) => {
      const a = cmpLoc(c, s.from), b = cmpLoc(c, s.to);
      const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
      return `<g class="${cls(s)}" data-story="${s.id}" transform="translate(${x} ${y})" tabindex="0" role="button" aria-label="${esc(s.title)}">
        <title>${s.n}. ${esc(s.title)} (${esc(cmpPlace(c, s))})</title>
        <rect x="-11" y="-11" width="22" height="22" rx="3" transform="rotate(45)"/><text y="4">${s.n}</text>${votes[s.id] ? `<text class="vote" y="-18">${votes[s.id].length}</text>` : ""}</g>`;
    }).join("");
    const nodes = c.locations.map((l) => {
      const here = c.stories.filter((s) => s.at === l.id);
      const f = cmpFaction(c, l.faction);
      const pills = here.map((s, i) => `<g class="${cls(s)}" data-story="${s.id}" transform="translate(${(i - (here.length - 1) / 2) * 30} 52)" tabindex="0" role="button" aria-label="${esc(s.title)}">
          <title>${s.n}. ${esc(s.title)}</title><rect x="-13" y="-10" width="26" height="20" rx="10"/><text y="4">${s.n}</text>${votes[s.id] ? `<text class="vote" y="-14">${votes[s.id].length}</text>` : ""}</g>`).join("");
      return `<g class="loc${cmpSel.kind === "loc" && cmpSel.id === l.id ? " sel" : ""}" transform="translate(${l.x} ${l.y})">
        <g data-loc="${l.id}" tabindex="0" role="button" aria-label="${esc(l.name)}"><title>${esc(l.name)}: ${esc(l.kind)}</title>
          <circle class="halo" r="24" style="stroke:${f?.color || "#888"}"/><circle class="core" r="9" style="fill:${f?.color || "#888"}"/>
          <text class="name" y="-32">${esc(l.name)}</text>${f ? `<text class="stand s${Math.sign(p.factions?.[f.id] || 0)}" x="32" y="4"><title>${esc(f.short)}: ${STANDING[p.factions?.[f.id] || 0]} (house rule)</title>${signed(p.factions?.[f.id] || 0)}</text>` : ""}</g>${pills}</g>`;
    }).join("");
    const at = cmpLoc(c, p.at);
    const ship = at ? `<g class="ship" transform="translate(${at.x - 44} ${at.y - 16})"><title>${esc(c.ship.name)} is here</title><path d="M-9 6 L0 -10 L9 6 Z"/><text y="20">${esc(c.ship.computer)}</text></g>` : "";
    return `<svg class="sector" viewBox="0 0 1100 560" role="img" aria-label="Sector map"><g class="stars">${stars}</g>${lanes}${transit}${nodes}${ship}</svg>`;
  }

  function cmpStoryLink(c, s, p) {
    const d = p.done.find((x) => x.id === s.id);
    return `<button class="cmplink${p.current === s.id ? " current" : ""}" data-story="${s.id}"><b>${s.n}. ${esc(s.title)}</b> <span class="muted">${esc(s.event)}${d ? " · played" : p.current === s.id ? " · now playing" : ""}</span></button>`;
  }

  const BUY = { fuel: ["Fuel (units)", null], ammo: ["Ammo (magazines)", 50], aid: ["First aid kit", 75], stimpak: ["Stimpak", 1000], mre: ["MREs (pack of 7)", 70], tank: ["Oxygen tank", 50] };
  const cmpBuy = { lines: {}, ammoFor: "", fuelPrice: 500, to: "", pay: "rig" };
  const fuelCostOf = (days) => Math.max(1, Math.ceil(days / 3));
  const cr = (n) => `${Number(n).toLocaleString("en-US")}cr`;
  function buyTotal() {
    const rs = S.resupply;
    if (!rs?.trade) return 0;
    const q = (k) => Math.max(0, Math.round(Number(cmpBuy.lines[k]) || 0));
    return q("fuel") * Math.round((Number(cmpBuy.fuelPrice) || 0) * rs.fuelFactor) + ["ammo", "aid", "stimpak", "mre", "tank"].reduce((n, k) => n + q(k) * rs.prices[k], 0);
  }
  function cmpRig(c, p) {
    const r = p.current && S.rig ? { fuel: S.rig.fuel, stores: S.rig.stores } : p.resources, rs = S.resupply, idle = !p.current;
    const lanes = c.lanes.filter((l) => l.a === p.at || l.b === p.at);
    const stores = Object.entries({ parts: "Parts", explosives: "Explosives", flares: "Flares", rations: "Rations (MREs)" }).map(([k, n]) => `${n} ${r.stores[k]}`).join(" · ");
    const travel = lanes.map((l) => {
      const to = cmpLoc(c, l.a === p.at ? l.b : l.a), cost = fuelCostOf(l.days);
      return `<div class="row"><span class="grow small">${esc(l.name)} to ${esc(to.name)}: ${l.days} days, ${cost} fuel${l.dark ? " (uncharted)" : ""}</span><button class="small" data-travel="${to.id}" ${!idle || r.fuel < cost ? "disabled" : ""} title="${!idle ? "Finish the story being played first" : r.fuel < cost ? "Not enough fuel" : "Move the rig; no story"}">Travel</button></div>`;
    }).join("");
    const row = ([k, [label, base]]) => {
      const unit = k === "fuel" ? Math.round((Number(cmpBuy.fuelPrice) || 0) * (rs.fuelFactor || 0)) : rs.prices[k];
      return `<div class="row"><label class="grow small">${label} <span class="muted">${k === "fuel" ? `${cr(unit)} each (base price set below)` : `${cr(unit)} each (PSG ${cr(base)})`}</span></label><input type="number" min="0" max="20" size="3" style="width:4.5em" data-buy="${k}" value="${cmpBuy.lines[k] || 0}" aria-label="${esc(label)}"></div>`;
    };
    const shop = !rs ? "" : !rs.trade ? `<p class="small bad">${esc(rs.name)} won't trade with the crew.</p>` : `
      <div class="small muted">Prices at ${esc(rs.name)}: the PSG price x port class ${esc(rs.portClass || "?")} (x${rs.classMult}, house rule) x the faction's standing (house rule). The price is taken from the account you pick.</div>
      ${Object.entries(BUY).map(row).join("")}
      <div class="row"><label class="grow small">Fuel price per unit, before the port's multiplier <span class="muted">(house rule: the PSG has no fuel price; 500cr unless you change it)</span></label><input type="number" min="0" style="width:6em" data-buy-fuelprice value="${cmpBuy.fuelPrice || 0}" aria-label="Base fuel price per unit"></div>
      <div class="row"><label class="small grow">Ammo for <select data-buy-ammofor>${rs.firearms.map((w) => `<option ${cmpBuy.ammoFor === w ? "selected" : ""}>${esc(w)}</option>`).join("")}</select></label>
        <label class="small grow">Carried by <select data-buy-to>${p.crew.map((pc) => `<option value="${esc(pc.id)}" ${cmpBuy.to === pc.id ? "selected" : ""}>${esc(pc.name)}</option>`).join("")}</select></label>
        <label class="small grow">Paid from <select data-buy-pay><option value="rig" ${cmpBuy.pay === "rig" ? "selected" : ""}>Rig account (${cr(p.money)})</option>${p.crew.map((pc) => `<option value="${esc(pc.id)}" ${cmpBuy.pay === pc.id ? "selected" : ""}>${esc(pc.name)} (${cr(pc.credits || 0)})</option>`).join("")}</select></label></div>
      <div class="row"><b class="grow" id="cmpBuyTotal">Total ${cr(buyTotal())}</b><button class="primary" data-buy-go ${idle ? "" : "disabled"} title="${idle ? "Adds the goods to the rig and the crew's sheets" : "Finish the story being played first"}">Buy</button></div>`;
    return `<details open><summary>The rig: fuel and supplies <span class="muted small">(house rules, except the PSG gear prices)</span></summary>
      <div class="bcard"><div class="row wrap"><b>Fuel ${r.fuel} of ${TANK_UNITS}</b><span class="small muted">house rule: a lane costs 1 unit per started 3 days (3 days = 1, 9 days = 3)</span></div>
        ${r.fuel <= 0 ? '<div class="small bad">Out of fuel: the rig is stranded until it is refuelled.</div>' : ""}
        <div class="small">${stores}</div></div>
      <h3 class="cmph">Travel from ${esc(cmpLoc(c, p.at)?.name || "")}</h3>${travel || '<p class="muted small">No lanes.</p>'}
      <h3 class="cmph">Resupply</h3>${shop}
    </details>${window.ShipUI?.rig(S) || ""}`;
  }
  const TANK_UNITS = 10, DEBT_EVERY = 2, DUES_PCT = 4;

  // Downtime between stories: short-term recovery, Rest Saves, Shore Leave and medical treatment (PSG 20.2, 34-39). Day counting and Condition durations are house rules.
  const cmpDt = { leisure: false, helped: false, unsafe: false, safe: false, days: "" };
  const cmpTr = { pc: "", id: "counselor", choice: "", pay: "" };
  const cmpSpread = {};
  const TR_CHOICES = {
    slicksim: [["combat", "Combat"], ["fear", "Fear Save"]],
    pseudoflesh: [["speed", "Speed"], ["strength", "Strength"], ["body", "Body Save"], ["wounds", "All Wounds"]],
    psychosurgery: [["intellect", "Intellect"], ["sanity", "Sanity Save"], ["fear", "Fear Save"], ["minstress", "Minimum Stress to 2"]],
  };
  function cmpDowntime(c, p) {
    const d = S.downtime, crew = S.config.crew.filter((x) => !x.cond?.dead && !x.retired);
    if (!d) return "";
    const off = d.ready ? "" : "disabled";
    const tip = d.ready ? "" : ` title="Downtime comes between stories: finish a story first"`;
    const chk = (k, label) => `<label class="cmpfx"><input type="checkbox" data-dt="${k}" ${cmpDt[k] ? "checked" : ""}> ${label}</label>`;
    const sh = d.shore;
    const rows = crew.map((x) => `<div class="bcard"><div class="row wrap"><b class="grow">${esc(x.name)}</b>
        <span class="small mono">HP ${x.health.current}/${x.health.max} · Wounds ${x.wounds.current}/${x.wounds.max} · Stress ${x.stress} (min ${x.minStress ?? 2}) · ${cr(x.credits || 0)}</span></div>
        ${x.cond?.tags?.length ? `<div class="small">Conditions: ${x.cond.tags.map(esc).join("; ")}</div>` : ""}
        <div class="row wrap"><button class="small" data-dt-go="recovery" data-pc="${esc(x.id)}" ${off}${tip}>Short-term recovery</button><button class="small" data-dt-go="rest" data-pc="${esc(x.id)}" ${off}${tip}>Rest Save</button><button class="small" data-dt-go="shore" data-pc="${esc(x.id)}" ${off}${tip}>Shore Leave</button></div></div>`).join("");
    const pend = Object.entries(p.downtime?.pending || {}).map(([id, v]) => {
      const x = crew.find((y) => y.id === id);
      if (!x) return "";
      const sp = cmpSpread[id] || {};
      return `<div class="bcard"><b>${esc(x.name)}</b> has ${v.points} Stress converted at ${esc(v.port)}: spread exactly ${v.points} points over the Saves (+1 each).
        <div class="row wrap">${["sanity", "fear", "body"].map((k) => `<label class="small">${k[0].toUpperCase() + k.slice(1)} (${x.saves[k]}) <input type="number" min="0" max="${v.points}" style="width:4em" data-spread="${esc(id)}" data-save="${k}" value="${sp[k] || 0}"></label>`).join("")}<button class="small primary" data-spread-go="${esc(id)}">Apply</button></div></div>`;
    }).join("");
    const pcT = crew.find((x) => x.id === cmpTr.pc) || crew[0];
    const tr = d.treatments.find((t) => t.id === cmpTr.id) || d.treatments[0];
    const opts = tr.id === "defrag" ? (pcT?.cond?.tags || []).map((t) => [t, t]) : TR_CHOICES[tr.id] || [];
    const choice = opts.some(([v]) => v === cmpTr.choice) ? cmpTr.choice : opts[0]?.[0] || "";
    const payer = cmpTr.pay || pcT?.id || "rig";
    return `<details open><summary>Downtime <span class="muted small">(optional; skip any part)</span></summary>
      ${d.ready ? "" : `<p class="small muted">Downtime comes between stories: finish the story being played, then the crew rest, recover, take Shore Leave and see a doctor before the next job.</p>`}
      <div class="bcard"><div class="small"><b>${esc(d.port || "?")}</b>${d.portClass ? ` · port class ${esc(d.portClass)}` : ""} · day ${p.downtime?.day || 0} <span class="muted">(house rule: a day count so that treatment limits and Condition durations can run out)</span></div>
        <div class="row wrap"><input type="number" min="1" max="365" style="width:5em" data-dt="days" value="${esc(cmpDt.days)}" placeholder="days" aria-label="Days to pass"><button class="small" data-dt-days>Pass days</button></div></div>
      <div class="bcard"><div class="small"><b>Rest Save</b> (PSG 20.2): the character's worst Save; success reduces Stress by the ones digit of the roll (never below Minimum Stress), failure +1 Stress. The roll goes to the player's screen.</div>
        ${chk("leisure", "A suitable leisure activity [+]")}${chk("helped", "A crewmate gives up their own rest to help [+]")}${chk("unsafe", "An unsafe place [-]")}
        <div class="small muted">The Nightmares Condition makes it [-] automatically.</div>
        <div class="small"><b>Short-term recovery</b> (PSG 34.1): after 6+ hours of rest, once per day, a Body Save; success brings Health back to Maximum. Wounds stay.</div></div>
      <div class="bcard"><div class="small"><b>Shore Leave</b> (PSG 39) ${sh ? `at a class ${esc(sh.cls)} port (${esc(sh.name)}): costs ${esc(sh.cost)}; a Sanity Save converts up to ${esc(sh.convert)} (critical success: ${esc(sh.max)}), the rest relieved down to Minimum Stress; about 2d10 days.` : "needs a port with a class."}</div>
        ${chk("safe", `The port is relatively safe (required)`)}</div>
      <div class="row wrap"><button class="small" data-dt-go="recovery" data-pc="all" ${off}${tip}>Recovery: everyone</button><button class="small" data-dt-go="rest" data-pc="all" ${off}${tip}>Rest Save: everyone</button></div>
      ${rows || '<p class="muted small">No playable crew.</p>'}${pend}
      <div class="bcard"><b>Medical treatment</b> <span class="small muted">(PSG 35; at a port, paid from the account you pick)</span>
        <div class="row wrap"><label class="small">Who <select data-tr="pc">${crew.map((x) => `<option value="${esc(x.id)}" ${pcT?.id === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
          <label class="small">Treatment <select data-tr="id">${d.treatments.map((t) => `<option value="${t.id}" ${tr.id === t.id ? "selected" : ""}>${esc(t.name)} (${cr(t.cost)})</option>`).join("")}</select></label>
          ${opts.length ? `<label class="small">Choice <select data-tr="choice">${opts.map(([v, n]) => `<option value="${esc(v)}" ${choice === v ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>` : ""}
          <label class="small">Paid from <select data-tr="pay"><option value="rig" ${payer === "rig" ? "selected" : ""}>Rig account (${cr(p.money)})</option>${p.crew.map((x) => `<option value="${esc(x.id)}" ${payer === x.id ? "selected" : ""}>${esc(x.name)} (${cr(x.credits || 0)})</option>`).join("")}</select></label>
          <button class="small primary" data-tr-go ${off}${tip}>Treat</button></div>
        <div class="small">${esc(tr.text)}${tr.time ? ` (${esc(tr.time)})` : ""} Side effects are recorded as Conditions with an end day (house rule: the PSG gives the durations but not a calendar).</div></div>
    </details>`;
  }

  function cmpOverview(c, p) {
    const played = p.done.map((d) => ({ d, s: c.stories.find((x) => x.id === d.id) })).filter((x) => x.s);
    return `<div class="btitle">${esc(c.title)}</div>
      <p class="muted"><i>${esc(c.tagline)}</i></p><p>${esc(c.pitch)}</p>
      <p class="small muted">Offer jobs to put them on the players' job board, then Show players; their votes appear on the map. Click a port or a numbered job on the map. Numbers on a lane are jobs in transit; under a port, jobs there.</p>
      ${cmpRig(c, p)}
      ${cmpDowntime(c, p)}
      ${cmpMoney(c, p)}
      ${cmpRecords(p)}
      <details open><summary>Played (${played.length} of ${c.stories.length})</summary>${played.length ? played.map(({ d, s }) => `<div class="bcard"><button class="cmplink" data-story="${s.id}"><b>${s.n}. ${esc(s.title)}</b></button><div class="small">${esc(d.outcome || "No notes.")}</div></div>`).join("") : '<p class="muted small">Nothing yet. A good first job: 1. FIRST SHIFT at Port Gallow, where the rig starts.</p>'}</details>
      <details open><summary>Factions <span class="muted small">(house rule: standing with the crew)</span></summary>
        <p class="small muted">Mothership 1e has no faction rules; this is a campaign house rule. At +2 or more their people give the crew [+] on social rolls, a one-off favour per story and better prices at their ports; at -2 or less, [-], trouble and worse prices; at -3 they won't trade. Their recurring characters start a step friendlier or cooler.</p>
        ${c.factions.map((f) => { const n = p.factions?.[f.id] || 0; return `<div class="bcard"><div class="row"><b class="grow" style="color:${f.color}">${esc(f.name)}</b><span class="stand-pill s${Math.sign(n)}">${STANDING[n]} ${signed(n)}</span><button class="small" data-faction="${f.id}" data-delta="-1" ${n <= -3 ? "disabled" : ""} aria-label="Lower ${esc(f.short)}">-</button><button class="small" data-faction="${f.id}" data-delta="1" ${n >= 3 ? "disabled" : ""} aria-label="Raise ${esc(f.short)}">+</button></div><div class="small">${esc(f.about)}</div>${p.current && n >= 2 ? `<div class="row"><span class="small muted grow">One favour this story (a forged permit, a docking slot, a tip-off, a hiding place).</span><button class="small" data-favour="${f.id}">${p.favours?.[f.id] ? "Favour used" : "Mark favour used"}</button></div>` : ""}</div>`; }).join("")}</details>
      <details><summary>Recurring characters</summary>${c.cast.map((m) => `<div class="bcard"><b>${esc(m.name)}</b> <span class="muted small">${esc(cmpFaction(c, m.faction)?.short || "")}${p.cast[m.id] ? ` · ${esc(attLabel(p.cast[m.id].attitude))}` : ""}</span><div class="small">${esc(m.notes)}</div>${p.cast[m.id]?.history ? `<div class="small muted">${esc(p.cast[m.id].history)}</div>` : ""}</div>`).join("")}</details>
      <details><summary>The crew</summary>${p.crew.map((pc) => `<div class="bcard"><b>${esc(pc.name)}</b> <span class="muted small">${esc([pc.className, pc.role].filter(Boolean).join(" · "))}</span><div class="small mono">HP ${pc.health.current}/${pc.health.max} · Wounds ${pc.wounds.current}/${pc.wounds.max} · Stress ${pc.stress} · ${cr(pc.credits || 0)}</div></div>`).join("")}<p class="small muted">They carry their condition, items and stress from story to story. Edit them on the Crew tab while a story is playing.</p></details>`;
  }
  // Campaign records and the memorial wall. High Score is sessions survived (PSG 18.3) and changes no roll.
  function cmpRecords(p) {
    const crew = S.config.crew.length ? S.config.crew : p.crew;
    const best = crew.reduce((b, c) => ((c.highScore || 0) > (b?.highScore || 0) ? c : b), null);
    const gone = crew.filter((c) => c.cond?.dead || c.retired).length;
    return `<div class="bcard"><div class="small"><span class="k">SESSIONS PLAYED</span> <b>${p.sessions || 0}</b> · <span class="k">LONGEST SURVIVOR</span> <b>${best ? `${esc(best.name)}, High Score ${best.highScore}` : "nobody yet"}</b></div>
      <div class="small muted">High Score is the number of sessions a character has survived (PSG 18.3). It affects no roll.</div></div>
      <details open><summary>Memorial wall (${gone})</summary>${memorialHtml(crew)}</details>`;
  }
  const attLabel = (n) => ({ "-3": "Hostile", "-2": "Resentful", "-1": "Wary", 0: "Neutral", 1: "Friendly", 2: "Trusting", 3: "Loyal" })[n] || "Neutral";

  function cmpLocation(c, l, p) {
    const f = cmpFaction(c, l.faction);
    const here = c.stories.filter((s) => s.at === l.id);
    const lanes = c.lanes.filter((x) => x.a === l.id || x.b === l.id);
    const transit = c.stories.filter((s) => !s.at && (s.from === l.id || s.to === l.id));
    return `<div class="btitle">${esc(l.name)}</div><div class="muted">${esc(l.kind)} · <span style="color:${f?.color}">${esc(f?.name || "")}</span>${p.at === l.id ? ` · ${esc(c.ship.name)} is here` : ""}</div>
      <p>${esc(l.description)}</p>
      <h3 class="cmph">Jobs here</h3>${here.map((s) => cmpStoryLink(c, s, p)).join("") || '<p class="muted small">None.</p>'}
      <h3 class="cmph">Jobs on the lanes from here</h3>${transit.map((s) => cmpStoryLink(c, s, p)).join("") || '<p class="muted small">None.</p>'}
      <h3 class="cmph">Lanes</h3><ul class="small">${lanes.map((x) => `<li>${esc(x.name)} to ${esc(cmpLoc(c, x.a === l.id ? x.b : x.a).name)}, ${x.days} days${x.dark ? " (uncharted)" : ""}</li>`).join("")}</ul>
      <details><summary>Map</summary><div class="smap" id="cmpMap"></div></details>`;
  }

  function cmpStory(c, s, p) {
    const d = p.done.find((x) => x.id === s.id);
    const busy = S.campaignBusy;
    const acts = campaignData.acts.map(([k, label]) => `<li><b>${esc(label)}.</b> ${esc(s.acts[k])}</li>`).join("");
    const cast = s.cast.map((id) => c.cast.find((m) => m.id === id)).filter(Boolean);
    const stakes = (s.affinity || []).map((a) => `<li><span style="color:${cmpFaction(c, a.faction)?.color}">${esc(cmpFaction(c, a.faction)?.short)}</span> ${a.change > 0 ? "+" : ""}${a.change} if ${esc(a.when)}</li>`).join("");
    const action = busy === s.id
      ? `<span class="small"><span class="spinner"></span>Building ${esc(s.title)} around its arc… (a minute or two)</span>`
      : p.current === s.id ? `<span class="pill ok">Now playing</span><button data-replay="${s.id}" ${busy ? "disabled" : ""} title="Build it again from scratch">Rebuild</button>`
        : `<button class="primary" data-play="${s.id}" ${busy ? "disabled" : ""}>${d ? "Play it again" : "Play this story"}</button>`;
    const on = (p.offered || []).includes(s.id), votes = S.sectorVotes?.[s.id] || [];
    const offer = `<button data-offer="${s.id}" aria-pressed="${on}" title="Put this job on the players' job board (title, hook and job only)">${on ? "Offered" : "Offer"}</button>${votes.length ? `<span class="small">${votes.length} vote${votes.length > 1 ? "s" : ""}: ${esc(votes.join(", "))}</span>` : ""}`;
    return `<div class="row"><div class="grow"><div class="btitle">${s.n}. ${esc(s.title)}</div>
        <div class="muted">${esc(cmpPlace(c, s))} · ${esc(TIERS[s.tier] || "")}</div></div></div>
      <div class="row wrap">${action}${offer}</div>
      ${d ? `<div class="bcard"><b>Played</b><div class="small">${esc(d.outcome || "No notes.")}</div></div>` : ""}
      <p>${esc(s.hook)}</p>
      <div class="bcard"><b>The job</b><div class="small">${esc(s.job)}</div><div class="small muted">${s.payoff ? "Pay (house rule): it pays off the note to Gallow-Mercer Finance." : `Pay (house rule): ${cr(s.pay || 0)}${s.upfront ? `, ${s.upfront === 1 ? "all" : "half"} paid up front` : ""}${s.late ? ", void if delivered late" : ""}; ${DUES_PCT}% union dues come off.`}</div></div>
      <div class="small"><b>Event:</b> ${esc(s.event)} · <b>Horror:</b> ${esc(s.horror)}</div>
      <div class="chips">${s.factions.map((id) => cmpFaction(c, id)).filter(Boolean).map((f) => `<span class="pill" style="color:${f.color}">${esc(f.name)}</span>`).join("")}</div>
      <details open><summary>Adversary: ${esc(s.adversary.name)} <span class="muted">(${esc(s.adversary.type)})</span></summary><div class="small">${esc(s.adversary.persona)}</div></details>
      <details open><summary>The arc</summary><ol class="cmpacts small">${acts}</ol></details>
      <details><summary>Secrets</summary><ul class="small">${s.secrets.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>
      ${cast.length ? `<details><summary>Recurring characters</summary><ul class="small">${cast.map((m) => `<li><b>${esc(m.name)}</b> ${esc(m.notes)}</li>`).join("")}</ul></details>` : ""}
      ${stakes ? `<details><summary>Faction stakes</summary><ul class="small">${stakes}</ul></details>` : ""}
      <div class="small muted">${s.hazards?.length ? `Hazards: ${esc(s.hazards.join(", "))}. ` : ""}${s.resources?.length ? `Resources: ${esc(s.resources.join(", "))}.` : ""}</div>
      <details><summary>Map</summary><div class="smap" id="cmpMap"></div></details>`;
  }

  function renderCampaign() {
    if (!$("campaignDialog").open || !campaignData) return;
    const p = S.campaign, c = p && campaignData.campaigns.find((x) => x.id === p.id);
    const key = JSON.stringify([p, S.campaignBusy, cmpSel, S.sectorShown, S.sectorVotes, S.rig, S.ships?.rig, cmpFin, cmpMove.from, cmpMove.to, S.downtime, cmpDt, cmpTr, S.config.crew.map((x) => [x.stress, x.minStress, x.health, x.wounds, x.saves, x.stats, x.cond?.tags, x.credits]), S.config.crew.map((x) => [x.id, x.cond?.dead, x.retired, x.highScore, x.endedIn, x.finalWords, x.epitaph])]);
    if (key === campaignKey || document.activeElement?.matches?.("#cmpBody [data-epitaph]")) return;
    campaignKey = key;
    $("cmpLeave").hidden = !c;
    if (!c) {
      $("cmpTitle").textContent = "Campaigns";
      $("cmpStatus").textContent = "";
      $("cmpBody").innerHTML = `<div class="cmplist"><p class="muted small">A campaign is many stories on one sector map, with the same crew, their rig and people they meet again. KESTREL-9 stays the one-shot: starting a campaign changes nothing until you play its first story.</p>
        ${campaignData.campaigns.map((x) => `<div class="bcard cmpcard"><div class="btitle">${esc(x.title)}</div><p><i>${esc(x.tagline)}</i></p><p class="small">${esc(x.pitch)}</p>
          <div class="small muted">${x.locations.length} ports · ${x.stories.length} stories · ${x.factions.length} factions · ${x.crew.length} crew</div>
          <div class="row"><button class="primary" data-start="${x.id}">Start campaign</button></div></div>`).join("")}</div>`;
      return;
    }
    const now = c.stories.find((s) => s.id === p.current);
    $("cmpTitle").textContent = c.title;
    $("cmpStatus").textContent = `${p.done.length} of ${c.stories.length} played · ${c.ship.name} at ${cmpLoc(c, p.at)?.name || "?"} · fuel ${(p.current && S.rig ? S.rig.fuel : p.resources.fuel)}/${TANK_UNITS}`;
    const banner = now
      ? `<div class="bcard cmpnow"><div><b>Now playing:</b> ${now.n}. ${esc(now.title)} <span class="muted">(${esc(cmpPlace(c, now))})</span></div>
          <textarea id="cmpOutcome" rows="2" placeholder="How did it end? Who lived, what they did, what they owe. Later stories are built on it."></textarea>
          ${now.affinity?.length ? `<div class="small"><b>Faction standing</b> <span class="muted">(house rule; tick what happened)</span>${now.affinity.map((a, i) => `<label class="cmpfx"><input type="checkbox" data-aff="${i}" ${cmpTicks.has(i) ? "checked" : ""}> <span style="color:${cmpFaction(c, a.faction)?.color}">${esc(cmpFaction(c, a.faction)?.short)}</span> ${signed(a.change)}: ${esc(a.when)}</label>`).join("")}</div>` : ""}
          ${cmpFinishBox(c, now, p)}
          <div class="row"><span class="small muted grow">Finishing keeps the crew's sheets and the recurring characters' attitudes, and moves the rig.</span><button id="cmpRecap" ${p.recap?.for === now.id ? "" : "disabled"} title="Play the 'Previously on' cold open on every player screen">Previously on</button><button id="cmpFinish" class="primary">Finish story</button></div></div>`
      : `<div class="small muted">${S.campaignBusy ? `<span class="spinner"></span>Building a story…` : "No campaign story is being played. Pick a job on the map."}</div>`;
    const side = cmpSel.kind === "story" ? cmpStory(c, c.stories.find((s) => s.id === cmpSel.id), p)
      : cmpSel.kind === "loc" ? cmpLocation(c, cmpLoc(c, cmpSel.id), p) : cmpOverview(c, p);
    $("cmpBody").innerHTML = `<div class="cmpgrid"><section class="cmpmapcol">${banner}${sectorSvg(c, p)}
        <div class="cmplegend small muted"><span><i class="lg loc"></i>port (colour: who runs it)</span><span><i class="lg pill"></i>job at a port</span><span><i class="lg dia"></i>job in transit</span><span><i class="lg done"></i>played</span><span><i class="lg cur"></i>now playing</span><span><i class="lg ship"></i>${esc(c.ship.name)}</span><button class="ghost small" data-overview>Overview</button><button class="small" data-sector="show" title="Put the sector map and the offered jobs on every player screen">Show players</button>${S.sectorShown ? '<button class="ghost small" data-sector="hide">Hide</button>' : ""}</div>
      </section><section class="cmpside">${side}</section></div>`;
    if ($("cmpOutcome")) {
      $("cmpOutcome").value = cmpOutcome;
      $("cmpOutcome").oninput = (e) => (cmpOutcome = e.target.value);
    }
    const mapEl = $("cmpMap");
    if (mapEl) StationMap.draw(mapEl, {}, cmpSel.kind === "story" ? campaignData.campaigns.find((x) => x.id === c.id).maps[cmpSel.id] : cmpLoc(c, cmpSel.id).map, { editable: false });
  }

  $("campaignBtn").onclick = async () => {
    campaignKey = "";
    $("campaignDialog").showModal();
    await loadCampaigns();
    renderCampaign();
  };
  $("cmpLeave").onclick = async () => {
    if (!(await sure("Leave the campaign?", "Forgets the campaign's progress: what was played, the crew it carries and how its people feel. The story being played stays.", "Leave campaign"))) return;
    send({ t: "campaignLeave" });
    cmpSel = { kind: "overview", id: "" };
  };
  const cmpPick = (e) => {
    const t = e.target.closest("[data-story], [data-loc], [data-overview]");
    if (!t) return false;
    cmpSel = t.dataset.story ? { kind: "story", id: t.dataset.story } : t.dataset.loc ? { kind: "loc", id: t.dataset.loc } : { kind: "overview", id: "" };
    renderCampaign();
    return true;
  };
  $("cmpBody").addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.buy) cmpBuy.lines[t.dataset.buy] = Number(t.value) || 0;
    else if (t.matches("[data-buy-fuelprice]")) cmpBuy.fuelPrice = Number(t.value) || 0;
    else if (t.matches("[data-buy-ammofor]")) cmpBuy.ammoFor = t.value;
    else if (t.matches("[data-buy-to]")) cmpBuy.to = t.value;
    else if (t.matches("[data-buy-pay]")) cmpBuy.pay = t.value;
    else if (t.dataset.move) cmpMove[t.dataset.move] = t.value;
    else if (t.dataset.dt) {
      cmpDt[t.dataset.dt] = t.type === "checkbox" ? t.checked : t.value;
      campaignKey = "";
      return;
    } else if (t.dataset.tr) {
      cmpTr[t.dataset.tr] = t.value;
      campaignKey = "";
      renderCampaign();
      return;
    } else if (t.dataset.spread) {
      (cmpSpread[t.dataset.spread] ||= {})[t.dataset.save] = Math.max(0, Math.round(Number(t.value) || 0));
      campaignKey = "";
      return;
    }
    else if (t.dataset.fin) {
      cmpFin[t.dataset.fin] = t.type === "checkbox" ? t.checked : t.value;
      if (t.dataset.fin !== "fee") { campaignKey = ""; renderCampaign(); } else campaignKey = "";
      return;
    } else return;
    if ($("cmpBuyTotal")) $("cmpBuyTotal").textContent = `Total ${cr(buyTotal())}`;
  });
  $("cmpBody").addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches("g[role=button]")) { e.preventDefault(); cmpPick(e); } });
  $("cmpBody").addEventListener("click", async (e) => {
    const shipBtn = e.target.closest("[data-ship]");
    if (shipBtn) return window.ShipUI.rigClick(shipBtn, S, send, sure);
    const start = e.target.closest("[data-start]")?.dataset.start;
    if (start) {
      cmpSel = { kind: "overview", id: "" };
      return send({ t: "campaignStart", id: start });
    }
    const sec = e.target.closest("[data-sector]")?.dataset.sector;
    if (sec) {
      send({ t: "campaignShow", hide: sec === "hide" });
      if (sec === "show") toast("Showing the players the sector map and job board.");
      return;
    }
    if (e.target.closest("[data-move-go]")) {
      send({ t: "campaignMoney", ...cmpMove });
      cmpMove.amount = "";
      cmpMove.what = "";
      campaignKey = "";
      return;
    }
    const dtGo = e.target.closest("[data-dt-go]");
    if (dtGo) return send({ t: "campaignDowntime", kind: dtGo.dataset.dtGo, pc: dtGo.dataset.pc, opts: { leisure: cmpDt.leisure, helped: cmpDt.helped, unsafe: cmpDt.unsafe, safe: cmpDt.safe } });
    if (e.target.closest("[data-dt-days]")) {
      send({ t: "campaignDays", days: Number(cmpDt.days) || 0 });
      cmpDt.days = "";
      campaignKey = "";
      return;
    }
    const spreadGo = e.target.closest("[data-spread-go]")?.dataset.spreadGo;
    if (spreadGo) {
      send({ t: "campaignShoreSpread", pc: spreadGo, alloc: cmpSpread[spreadGo] || {} });
      delete cmpSpread[spreadGo];
      return;
    }
    if (e.target.closest("[data-tr-go]")) {
      const d = S.downtime, crew = S.config.crew.filter((x) => !x.cond?.dead && !x.retired);
      const pcT = crew.find((x) => x.id === cmpTr.pc) || crew[0], tr = d.treatments.find((t) => t.id === cmpTr.id) || d.treatments[0];
      const opts = tr.id === "defrag" ? (pcT?.cond?.tags || []).map((t) => [t, t]) : TR_CHOICES[tr.id] || [];
      const choice = opts.some(([v]) => v === cmpTr.choice) ? cmpTr.choice : opts[0]?.[0] || "";
      const pay = cmpTr.pay || pcT?.id || "rig";
      if (!pcT) return;
      if (await sure(`${tr.name} for ${pcT.name}?`, `${tr.text} It costs ${cr(tr.cost)}, taken from ${pay === "rig" ? "the rig account" : (S.campaign.crew.find((x) => x.id === pay)?.name || "the account")}, and its side effects are real.`, "Treat", "primary")) send({ t: "campaignTreat", pc: pcT.id, treatment: tr.id, choice, pay });
      return;
    }
    const trav = e.target.closest("[data-travel]")?.dataset.travel;
    if (trav) return send({ t: "campaignTravel", to: trav });
    if (e.target.closest("[data-buy-go]")) {
      const total = buyTotal();
      if (!(await sure("Buy these supplies?", `Total ${cr(total)} at ${S.resupply.name}. The goods go onto the rig and the character's sheet now, and the price is taken from ${cmpBuy.pay === "rig" ? "the rig account" : (S.campaign.crew.find((x) => x.id === cmpBuy.pay)?.name || "the rig account")}.`, "Buy", "primary"))) return;
      send({ t: "campaignBuy", to: cmpBuy.to || S.campaign.crew[0]?.id, ammoFor: cmpBuy.ammoFor || S.resupply.firearms[0], fuelPrice: cmpBuy.fuelPrice, pay: cmpBuy.pay, lines: cmpBuy.lines });
      cmpBuy.lines = {};
      campaignKey = "";
      return;
    }
    const offer = e.target.closest("[data-offer]")?.dataset.offer;
    if (offer) return send({ t: "campaignOffer", story: offer, on: !S.campaign.offered?.includes(offer) });
    const fx = e.target.closest("[data-faction]");
    if (fx) return send({ t: "campaignFaction", faction: fx.dataset.faction, delta: Number(fx.dataset.delta) });
    const fav = e.target.closest("[data-favour]");
    if (fav) return send({ t: "campaignFavour", faction: fav.dataset.favour });
    const aff = e.target.closest("[data-aff]");
    if (aff) {
      cmpTicks[aff.checked ? "add" : "delete"](Number(aff.dataset.aff));
      return;
    }
    const play = e.target.closest("[data-play], [data-replay]");
    if (play) {
      const c = campaignData.campaigns.find((x) => x.id === S.campaign?.id);
      const s = c?.stories.find((x) => x.id === (play.dataset.play || play.dataset.replay));
      if (!s) return;
      const left = c.stories.find((x) => x.id === S.campaign.current);
      const text = `The agent builds it around its written arc (a minute or two, on the session's model and key). It replaces the story being played and clears the log; the crew carry over, and players pick their crew files again.${left && left !== s ? ` ${left.title} hasn't been finished: finish it first to keep how it ended.` : ""}`;
      if (await sure(`Play ${s.title}?`, text, "Play story", "primary")) send({ t: "campaignPlay", story: s.id });
      return;
    }
    if (e.target.id === "cmpRecap") return send({ t: "campaignRecap" });
    if (e.target.id === "cmpFinish") {
      send({ t: "campaignFinish", outcome: $("cmpOutcome").value, affinity: [...cmpTicks], delivery: cmpFin.delivery, late: cmpFin.late, skipDues: cmpFin.skipDues, ...(cmpFin.fee === "" ? {} : { fee: Number(cmpFin.fee) || 0 }) });
      cmpOutcome = "";
      cmpTicks = new Set();
      cmpFin = { delivery: "full", late: false, skipDues: false, fee: "" };
      toast("Story finished. Pick the next job on the map.");
      return;
    }
    cmpPick(e);
  });

  const SYN_KINDS = {
    prebrief: { label: "Prebrief", writing: "Writing the prebrief…",
      empty: "<b>Write it</b> to brief the players before play, with private notes for you." },
    sofar: { label: "The story so far", writing: "Writing the story so far…",
      empty: "<b>Write it</b> to catch the players up, with private notes for you." },
    wrapup: { label: "Wrap-up", writing: "Writing the wrap-up…",
      empty: "<b>Write it</b> when the one-shot ends: what happened and what became of the crew." },
  };
  let synKind = null;
  const synopsisOf = (k) => S.synopses?.[k] || null;
  let synopsisKey = "";
  function renderSynopsis() {
    if (!$("synopsisDialog").open) return;
    const kind = shownKind();
    const syn = synopsisOf(kind), busy = S.synopsisBusy, mine = busy === kind;
    const newer = syn && kind !== "prebrief" ? S.log.filter((e) => e.id > syn.logId && e.kind !== "note").length : 0;
    const key = JSON.stringify([kind, syn, busy, newer]);
    if (key === synopsisKey) return;
    synopsisKey = key;
    for (const b of $("synKinds").children) {
      b.classList.toggle("on", b.dataset.kind === kind);
      b.setAttribute("aria-selected", String(b.dataset.kind === kind));
    }
    const when = syn && new Date(syn.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    $("synStatus").textContent = mine || !syn ? "" : `written ${when}${newer ? ` · ${newer} new log ${newer === 1 ? "entry" : "entries"} since` : ""}`;
    $("synWrite").disabled = !!busy;
    $("synWrite").textContent = syn ? (newer ? "↻ Update to now" : "↻ Rewrite") : "↻ Write it";
    $("synWrite").classList.toggle("primary", !syn || newer > 0);
    $("synCopy").disabled = mine || !syn?.sections.some((x) => x.audience === "players");
    const body = $("synBody");
    if (mine) { body.innerHTML = `<div class="synempty"><span class="spinner"></span>${SYN_KINDS[kind].writing}</div>`; return; }
    if (!syn) { body.innerHTML = `<div class="synempty muted">Not written yet. ${SYN_KINDS[kind].empty}${busy ? ` <br><br>(Writing ${SYN_KINDS[busy]?.label}. This one can go next.)` : ""}</div>`; return; }
    body.innerHTML = syn.sections.map((x) => x.audience === "warden"
      ? `<section class="synsec warden"><div class="synlabel">For the Warden only</div><h3>${esc(x.heading)}</h3><div class="syntext">${esc(x.text)}</div></section>`
      : `<section class="synsec"><h3>${esc(x.heading)}</h3><div class="syntext">${esc(x.text)}</div></section>`).join("");
  }
  const shownKind = () => synKind || (S.storyStartedAt ? "sofar" : "prebrief");
  const writeSynopsis = () => { if (!S.synopsisBusy) send({ t: "synopsis", kind: shownKind() }); };
  $("synopsisBtn").onclick = () => {
    synopsisKey = "";
    synKind = null;
    $("synopsisDialog").showModal();
    if (!synopsisOf(shownKind()) && !S.synopsisBusy) writeSynopsis();
    renderSynopsis();
  };
  $("synKinds").addEventListener("click", (e) => {
    const k = e.target.closest("[data-kind]")?.dataset.kind;
    if (!k) return;
    synKind = k;
    renderSynopsis();
  });
  $("synWrite").onclick = writeSynopsis;
  $("synCopy").onclick = async () => {
    const text = synopsisOf(shownKind()).sections.filter((x) => x.audience === "players").map((x) => `${x.heading.toUpperCase()}\n${x.text}`).join("\n\n");
    try { await navigator.clipboard.writeText(text); toast("Player sections copied."); }
    catch { toast("Copy blocked by the browser.", "error"); }
  };

  const LOOKS = { blood: "Blood", goo: "Goo", crack: "Cracked", flicker: "Flicker", dim: "Dim", grime: "Grime", portable: "Handheld" };
  let termDraft = null, termTimer = null, termSentAt = 0;
  const sendTermsNow = () => { termSentAt = 0; send({ t: "terminals", terminals: termDraft }); };
  function renderTerminals(fromDraft = false) {
    const panel = $("terminals");
    if (!fromDraft) {
      const editing = panel.contains(document.activeElement) || termTimer !== null || Date.now() - termSentAt < 1500;
      const json = JSON.stringify([S.config.terminals, S.screens, S.config.map]);
      if ((termDraft && editing) || panel.dataset.json === json) return;
      panel.dataset.json = json;
      termDraft = structuredClone(S.config.terminals);
    }
    const decks = StationMap.parseLayout(S.config.map);
    const deckRooms = decks.flatMap((d) => d.rooms.map((r) => [r.id, `${r.label} (${d.label.split("·")[0].trim()})`]));
    const labelOf = (id) => decks.flatMap((d) => d.rooms).find((r) => r.id === id)?.label || id;
    const rooms = [...deckRooms, ...StationMap.parseDocked(S.config.map).map((r) => [r.id, `${r.label} (docked at ${labelOf(r.parent)})`])];
    const doors = doorPaths();
    panel.innerHTML = termDraft.map((t, i) => {
      const here = screensAt(t.id);
      return `<div class="tcard" data-i="${i}">
        <div class="row"><input data-t="name" value="${esc(t.name)}" aria-label="Terminal name" class="tname">
          <label class="check small"><input type="checkbox" data-t="open" ${t.open ? "checked" : ""}> reachable</label>
          <button data-tact="del" class="ghost" title="Remove">✕</button></div>
        <div class="row wrap small">
          <label>Room <select data-t="room"><option value="">(none / portable)</option>${optionsHtml(rooms, t.room)}</select></label>
          <label title="Reachable once this door reads OPEN">Opens with <select data-t="requires"><option value="">(nothing)</option>${optionsHtml(doors.map((p) => [p, p]), t.requires)}</select></label>
          <label>Colour <select data-t="theme">${["", "green", "amber", "cyan", "white", "red"].map((x) => `<option value="${x}" ${x === t.theme ? "selected" : ""}>${x || "station's"}</option>`).join("")}</select></label>
        </div>
        <div class="looks">${Object.entries(LOOKS).map(([k, label]) => `<label class="chip"><input type="checkbox" data-look="${k}" ${t.look.includes(k) ? "checked" : ""}> ${label}</label>`).join("")}</div>
        <div class="row wrap small">
          <label title="Blank: station network. Else its own log and name.">System <input data-t="system" value="${esc(t.system || "")}" placeholder="the station's" size="14"></label>
          <label title="OS name in the header. Blank: the station's.">OS <input data-t="os" value="${esc(t.os || "")}" placeholder="the station's" size="18"></label>
        </div>
        <input data-t="notes" value="${esc(t.notes)}" placeholder="What's here, what happened" aria-label="Notes">
        ${here.length ? `<div class="muted small">Here now: ${here.map(esc).join(", ")}</div>` : ""}
      </div>`;
    }).join("");
  }
  function roomLabels() {
    const decks = StationMap.parseLayout(S.config.map);
    const out = new Map(decks.flatMap((d) => d.rooms.map((r) => [r.id, r.label])));
    for (const r of StationMap.parseDocked(S.config.map)) out.set(r.id, `${r.label}, docked at ${out.get(r.parent) || r.parent}`);
    return out;
  }
  const reachableNow = (t) => {
    if (t.open) return true;
    if (!t.requires) return false;
    const v = stationAt(t.requires.split("."));
    return /^(OPEN|OPENED|UNLOCKED)$/i.test(String(v ?? "").trim());
  };
  function renderTerminalsPlay() {
    const panel = $("terminalsPlay");
    const json = JSON.stringify([S.config.terminals, S.screens, S.config.map, S.station]);
    if (panel.dataset.json === json) return;
    panel.dataset.json = json;
    const rooms = roomLabels();
    panel.innerHTML = S.config.terminals.map((t) => {
      const here = screensAt(t.id);
      const access = reachableNow(t) ? "" : `<span class="pill">${t.requires ? `locked: ${esc(t.requires)}` : "not reachable"}</span>`;
      return `<div><b>${esc(t.name)}</b><span class="muted small">${esc(rooms.get(t.room) || (t.room ? t.room : "portable"))}${t.system ? ` · ${esc(t.system)}` : ""}</span>${access}${here.length ? `<span class="here small">${here.map(esc).join(", ")}</span>` : ""}</div>`;
    }).join("") || '<p class="muted small">No terminals.</p>';
  }
  function renderCastPlay() {
    const panel = $("castPlay");
    const json = JSON.stringify(S.config.voices.map((v) => [v.name, v.color, !!v.adversary]));
    if (panel.dataset.json === json) return;
    panel.dataset.json = json;
    panel.innerHTML = S.config.voices.filter((v) => !v.adversary).map((v) => `<div class="castv"><b style="color: ${esc(v.color || "var(--fg)")}">${esc(v.name)}</b></div>`).join("");
  }

  function renderConnections() {
    const panel = $("connections");
    const systems = [{ net: "", name: S.config.stationName }];
    for (const t of S.config.terminals) if (t.system && !systems.some((s) => s.net === netKey(t.system))) systems.push({ net: netKey(t.system), name: t.system });
    const json = JSON.stringify([S.config.voices.map((v) => [v.id, v.name, v.systems]), systems]);
    if (panel.dataset.json === json) return;
    panel.dataset.json = json;
    if (systems.length < 2) { panel.innerHTML = '<p class="muted small">Only one system. Give a terminal its own System to route voices.</p>'; return; }
    const on = (v, net) => (v.systems || [""]).includes(net);
    panel.innerHTML = `<table class="conns"><thead><tr><th>Voice</th>${systems.map((s) => `<th>${esc(s.name)}</th>`).join("")}<th title="Every system, including new ones">All</th></tr></thead><tbody>${
      S.config.voices.map((v) => { const all = on(v, "*"); return `<tr data-v="${esc(v.id)}"><td>${esc(v.name)}</td>${
        systems.map((s) => `<td class="${all ? "off" : ""}"><input type="checkbox" data-net="${esc(s.net)}" ${all || on(v, s.net) ? "checked" : ""} ${all ? "disabled" : ""} aria-label="${esc(v.name)} on ${esc(s.name)}"></td>`).join("")
      }<td><input type="checkbox" data-net="*" ${all ? "checked" : ""} aria-label="${esc(v.name)} on every system"></td></tr>`; }).join("")
    }</tbody></table>`;
  }
  $("connections").addEventListener("change", (e) => {
    const net = e.target.dataset.net;
    const id = e.target.closest("tr")?.dataset.v;
    if (net === undefined || !id) return;
    const voices = structuredClone(S.config.voices);
    const v = voices.find((x) => x.id === id);
    const set = new Set((v.systems || [""]).filter((n) => n !== "*"));
    if (net === "*") v.systems = e.target.checked ? ["*"] : [...set].length ? [...set] : [""];
    else {
      e.target.checked ? set.add(net) : set.delete(net);
      if (!set.size) { e.target.checked = true; return toast(`${v.name} needs at least one system.`, "error"); }
      v.systems = [...set];
    }
    send({ t: "voices", voices });
  });

  function doorPaths() {
    return stationLeaves().map(([p]) => p.join(".")).filter((p) => /door|hatch|airlock|lock|gate/i.test(p));
  }
  function stationLeaves() {
    const out = [];
    const walk = (o, path) => { for (const [k, v] of Object.entries(o || {})) { const p = [...path, k]; if (v && typeof v === "object") walk(v, p); else out.push([p, v]); } };
    walk(S.station, []);
    return out;
  }

  function saveTerminals() {
    clearTimeout(termTimer);
    termTimer = setTimeout(() => { termTimer = null; termSentAt = Date.now(); send({ t: "terminals", terminals: termDraft }); }, 500);
  }
  $("terminals").addEventListener("input", (e) => {
    const card = e.target.closest(".tcard");
    if (!card) return;
    const t = termDraft[Number(card.dataset.i)];
    if (e.target.dataset.look) {
      const k = e.target.dataset.look;
      t.look = e.target.checked ? [...new Set([...t.look, k])] : t.look.filter((x) => x !== k);
    } else if (e.target.dataset.t === "open") t.open = t.startOpen = e.target.checked;
    else if (e.target.dataset.t) t[e.target.dataset.t] = e.target.value;
    saveTerminals();
  });
  $("terminals").addEventListener("click", async (e) => {
    if (e.target.closest("[data-tact]")?.dataset.tact !== "del") return;
    const i = Number(e.target.closest(".tcard").dataset.i);
    if (!(await sure(`Remove ${termDraft[i].name}?`, "Players there stay until moved.", "Remove"))) return;
    termDraft.splice(i, 1);
    sendTermsNow();
  });
  $("addTerminal").onclick = () => {
    termDraft.push({ name: "NEW TERMINAL", room: "", look: [], theme: "", open: true, notes: "" });
    sendTermsNow();
    renderTerminals(true);
  };

  function setMview(v) {
    document.body.dataset.mview = v;
    for (const b of $("mnav").querySelectorAll("[data-mview]")) b.classList.toggle("on", b.dataset.mview === v);
    if (v !== "comms") document.querySelector(`.tabs[data-tabs="side"] [data-tab="${v}"]`)?.click();
    store.set("mview", v);
    renderMnavDot();
  }
  function renderMnavDot() {
    const waiting = [...$("tray").children].some((c) => !c.hidden);
    $("mnavDot").hidden = !waiting || document.body.dataset.mview === "comms";
  }
  $("mnav").addEventListener("click", (e) => { const v = e.target.closest("[data-mview]")?.dataset.mview; if (v) setMview(v); });
  setMview(store.get("mview") || "comms");

  const STORY_BOXES = ["lore", "secrets", "standingOrders"];
  function growBox(el) {
    if (!el.offsetParent) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }
  function growStory() { for (const id of STORY_BOXES) growBox($(id)); }
  for (const id of STORY_BOXES) $(id).addEventListener("input", (e) => growBox(e.target));
  addEventListener("resize", () => requestAnimationFrame(growStory));
  document.addEventListener("toggle", (e) => { if (e.target.open && STORY_BOXES.some((id) => e.target.contains($(id)))) growStory(); }, true);

  const LOCK_SVG = (open) => `<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="${open ? "M7 11V7a5 5 0 0 1 9.9-1" : "M7 11V7a5 5 0 0 1 10 0v4"}"/></svg>`;
  function setLock(btn, editing, what) {
    btn.innerHTML = LOCK_SVG(editing);
    btn.setAttribute("aria-label", editing ? `Done editing ${what}` : `Edit ${what}`);
  }

  const sideCol = document.querySelector(".col.side");
  function setEditing(on) {
    sideCol.classList.toggle("editing", on);
    $("editMode").setAttribute("aria-pressed", String(on));
    setLock($("editMode"), on, "the setup");
    for (const id of ["lore", "secrets"]) $(id).readOnly = !on;
    if (on) store.set("editMode", "1"); else store.del("editMode");
  }
  $("editMode").onclick = () => setEditing(!sideCol.classList.contains("editing"));
  setEditing(store.get("editMode") === "1");

  for (const bar of document.querySelectorAll(".tabs[data-tabs]")) {
    const group = bar.dataset.tabs;
    bar.classList.add("slider");
    const place = () => {
      const on = bar.querySelector("[data-tab].on");
      if (!on || !on.offsetWidth) return;
      bar.style.setProperty("--x", `${on.offsetLeft}px`);
      bar.style.setProperty("--w", `${on.offsetWidth}px`);
    };
    new ResizeObserver(place).observe(bar);
    let current = null;
    const show = (tab) => {
      for (const b of bar.querySelectorAll("[data-tab]")) b.classList.toggle("on", b.dataset.tab === tab);
      for (const p of document.querySelectorAll(`.tabpanel[data-tabs="${group}"]`)) {
        p.hidden = p.dataset.panel !== tab;
        p.classList.remove("enter");
        if (!p.hidden && current !== null && current !== tab) { void p.offsetWidth; p.classList.add("enter"); }
      }
      const col = bar.closest(".col");
      if (current !== null && current !== tab && col && col.scrollTop > 0) col.scrollTop = 0;
      current = tab;
      place();
      requestAnimationFrame(() => bar.classList.add("ready"));
      store.set(`tab:${group}`, tab);
      if (group === "side" && tab === "map" && S) renderMap(true);
      if (group === "side" && tab === "story") requestAnimationFrame(growStory);
    };
    bar.addEventListener("click", (e) => { const t = e.target.closest("[data-tab]")?.dataset.tab; if (t) show(t); });
    show(store.get(`tab:${group}`) || bar.querySelector("[data-tab]").dataset.tab);
  }

  let mapKey = "";
  let mapView = store.get("mapView") === "iso" ? "iso" : "draw";
  function withCast(station, cast = S.config.cast) {
    const st = structuredClone(station || {});
    const occ = (st.occupants = typeof st.occupants === "object" && st.occupants ? st.occupants : {});
    const by = {};
    for (const c of cast || []) if (c.room) (by[c.room] ||= []).push(c.name);
    for (const [room, names] of Object.entries(by)) occ[room] = [...names, occ[room]].filter(Boolean).join(", ");
    return st;
  }
  function renderMap(force = false) {
    const people = playersByRoom();
    const key = JSON.stringify([S.station, S.config.map, mapView, people, S.config.cast.map((c) => [c.name, c.room]), mapView === "iso" ? S.config.rooms : 0, S.mapShown]);
    if (!force && key === mapKey) return;
    mapKey = key;
    const show = (el) => (mapView === "iso" ? showIso(el, isoData(people))
      : (dropIso(el), StationMap.draw(el, withCast(S.station), S.config.map, { people })));
    for (const b of document.querySelectorAll(".mapShow")) {
      b.textContent = S.mapShown === mapView ? "Hide from players" : S.mapShown ? "Show players this view" : "Show players";
      b.classList.toggle("primary", S.mapShown === mapView);
    }
    for (const b of document.querySelectorAll(".mapview button")) b.classList.toggle("on", b.dataset.view === mapView);
    show($("map"));
    if ($("mapDialog").open) show($("mapBig"));
    if (document.activeElement !== $("mapLayout") && !dirty.has("map")) $("mapLayout").value = S.config.map;
  }

  async function editStationValue(path) {
    const cur = stationAt(path);
    const options = StationMap.choicesFor(path).filter((o) => o !== String(cur).toUpperCase());
    const picked = await ask(path.join(".").replace(/_/g, " ").toUpperCase(), `Now: ${cur}. Pick or type a value. Hidden from players.`,
      [["set", "Set", "primary"], ...options.map((o) => [`opt:${o}`, o])], "", { value: cur });
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
      if (p) return editStationValue(JSON.parse(p));
      const r = e.target.closest("[data-room]");
      if (r) openRoom(r.dataset.room, r.dataset.label, r.dataset.deck);
    });
  }
  $("mapExpand").onclick = (e) => {
    e.preventDefault();
    $("mapTitle").textContent = `${S.config.stationName} · station map`;
    $("mapDialog").showModal();
    renderMap(true);
  };
  $("mapDialog").addEventListener("close", () => dropIso($("mapBig")));
  let isoLib = null;
  const isoViews = new Map();
  const nick = (name) => (String(name).match(/["'“‘]([^"'”’]+)["'”’]/)?.[1] || String(name).split(" ")[0]).toUpperCase();
  const isoData = (people) => ({ station: withCast(S.station), layout: S.config.map, rooms: S.config.rooms, editable: true, people: Object.fromEntries(Object.entries(people).map(([room, names]) => [room, names.map(nick)])) });
  function fitIso(el) {
    const box = el.querySelector(":scope > .iso");
    if (!box) return;
    let sc = el.parentElement;
    while (sc && sc !== document.body && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
    const sibs = [...el.parentElement.children], after = sibs.slice(sibs.indexOf(el) + 1).reduce((n, s) => n + s.getBoundingClientRect().height, 0);
    const [top, height] = !sc || sc === document.body ? [box.getBoundingClientRect().top, innerHeight]
      : [box.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop,
        Math.max(sc.clientHeight, parseFloat(getComputedStyle(sc).maxHeight) || 0) - (parseFloat(getComputedStyle(sc).paddingBottom) || 0)];
    box.style.height = `${Math.max(320, height - top - after - 16)}px`;
  }
  function showIso(el, data) {
    let v = isoViews.get(el);
    if (!v || !el.contains(v.box)) {
      dropIso(el);
      el.innerHTML = '<div class="iso"></div>';
      v = { box: el.firstChild, view: null, data };
      isoViews.set(el, v);
      (isoLib ||= import("./isomap.js")).then((lib) => { if (isoViews.get(el) === v) v.view = lib.mount(v.box, v.data, { fg: "#3bff7a", dim: "#1d8a43" }); })
        .catch((err) => { v.box.textContent = `The 3D map couldn't load (${err.message}).`; });
    }
    v.data = data;
    v.view?.update(data);
    fitIso(el);
  }
  function dropIso(el) { isoViews.get(el)?.view?.dispose(); isoViews.delete(el); }
  for (const b of document.querySelectorAll(".mapShow")) b.onclick = () => send({ t: "mapShow", view: S.mapShown === mapView ? "" : mapView });
  for (const seg of document.querySelectorAll(".mapview")) {
    seg.addEventListener("click", (e) => {
      const v = e.target.closest("[data-view]")?.dataset.view;
      if (!v) return;
      e.preventDefault();
      mapView = v;
      store.set("mapView", v);
      renderMap(true);
    });
  }
  let mapResize = null;
  addEventListener("resize", () => { clearTimeout(mapResize); mapResize = setTimeout(() => S && renderMap(true), 200); });
  $("mapLayout").addEventListener("input", () => dirty.add("map"));
  $("mapLayoutSave").onclick = () => {
    dirty.delete("map");
    send({ t: "config", patch: { map: $("mapLayout").value } });
  };

  let room = null;
  let roomEditing = false, roomTool = "#", roomRows = null, roomKey = "", roomSaveTimer = null, roomPainting = false;
  function playersByRoom() {
    const out = {};
    for (const sc of S.screens || []) {
      const t = S.config.terminals.find((x) => x.id === sc.terminal);
      if (t?.room && sc.character) (out[t.room] ||= []).push(sc.character);
    }
    return out;
  }
  const stationAt = (path) => path.reduce((o, k) => o?.[k], S.station);

  function openRoom(id, label, deck) {
    room = { id, label, deck };
    roomEditing = false;
    roomRows = null;
    roomKey = "";
    if (!$("roomDialog").open) $("roomDialog").showModal();
    if (!S.config.rooms?.[id] && !S.roomBusy && hasKey()) send({ t: "roomDraft", room: id, label, deck });
    renderRoom(true);
  }

  function renderRoom(force = false) {
    if (!room || !$("roomDialog").open) return;
    const plan = S.config.rooms?.[room.id];
    const busy = S.roomBusy === room.id;
    const pcs = playersByRoom()[room.id] || [];
    const key = JSON.stringify([plan, busy, pcs, S.station, S.config.terminals, S.config.crew.map((c) => c.id), roomEditing]);
    if (!force && key === roomKey) return;
    roomKey = key;
    $("roomTitle").textContent = room.label;
    $("roomDeck").textContent = room.deck;
    if (!roomEditing) roomRows = plan ? [...plan.rows] : null;
    const box = $("roomPlan");
    if (busy) box.innerHTML = `<div class="rpempty muted"><span class="spinner"></span>The agent is drawing ${esc(room.label)}…</div>`;
    else if (!roomRows) box.innerHTML = `<div class="rpempty muted">No floor plan yet. Use <b>Redraw with agent</b>, or unlock to paint.</div>`;
    else box.innerHTML = RoomPlan.svg(roomRows, { cell: 24, title: room.label, cls: roomEditing ? "editing" : "" });
    $("roomLegend").innerHTML = roomRows ? RoomPlan.legend(roomRows).map(([c, n]) => `<span><b>${esc(c)}</b> ${esc(n)}</span>`).join("") : "";
    setLock($("roomEdit"), roomEditing, "the floor plan");
    $("roomEdit").classList.toggle("primary", roomEditing);
    $("roomRedraw").disabled = busy || !!S.roomBusy;
    $("roomShow").disabled = !plan;
    $("roomTools").hidden = !roomEditing;
    $("roomTools").innerHTML = roomEditing ? RoomPlan.CODES.filter((c) => c !== " ").concat(" ").map((c) =>
      `<button data-tool="${esc(c)}" class="${c === roomTool ? "on" : ""}" title="${esc(RoomPlan.TILES[c][0])}">${c === " " ? "␣ erase" : `${esc(c)} ${esc(RoomPlan.TILES[c][0].split(" ")[0])}`}</button>`).join("")
      + `<button data-tool="+col" title="Add a column">+ col</button><button data-tool="-col" title="Remove the last column">− col</button><button data-tool="+row" title="Add a row">+ row</button><button data-tool="-row" title="Remove the last row">− row</button>` : "";
    const sel = $("roomShowTo"), who = [["", "All players"], ...S.config.crew.map((c) => [c.id, c.name])];
    fillSelect(sel, who, who.some(([v]) => v === sel.value) ? sel.value : "");
    const castHere = S.config.cast.filter((c) => c.room === room.id).map((c) => c.name);
    $("roomPlayers").innerHTML = (pcs.length ? pcs.map((n) => `<span class="pcchip">${esc(n)}</span>`).join("") : `<span class="muted small">No player characters here.</span>`) +
      (castHere.length ? castHere.map((n) => `<span class="castchip" title="Character, move on the Crew tab">${esc(n)}</span>`).join("") : "");
    for (const [id, k] of [["roomOccupants", "occupants"], ["roomContents", "contents"]]) {
      if (document.activeElement !== $(id) && !dirty.has(id)) $(id).value = String(stationAt([k, room.id]) ?? "");
    }
    const vals = stationLeaves().filter(([q]) => q.includes(room.id) && !["occupants", "contents"].includes(q[0]));
    $("roomValues").innerHTML = vals.length ? vals.map(([p, v]) => `<button class="ghost small" data-path="${esc(JSON.stringify(p))}" title="${esc(p.join("."))}">${esc(p.filter((x) => x !== room.id).join(" ").replace(/_/g, " "))}: <b>${esc(v)}</b></button>`).join("") : `<span class="muted small">Nothing tracked here.</span>`;
    renderRoomHazard();
    const terms = S.config.terminals.filter((t) => t.room === room.id);
    $("roomTerminals").innerHTML = terms.length ? terms.map((t) => `<div><b>${esc(t.name)}</b>: ${esc(t.notes)}</div>`).join("") : "None.";
  }

  function renderRoomHazard() {
    const sel = $("hazType"), now = S.station?.hazards?.[room.id];
    if (!sel.options.length) {
      const group = (label, kind) => `<optgroup label="${label}">${Object.entries(S.hazardTypes).filter(([, v]) => v.kind === kind).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join("")}</optgroup>`;
      sel.innerHTML = `<option value="">None</option>${group("Mothership rules (PSG)", "psg")}${group("Story hazards (not Mothership rules)", "story")}`;
    }
    if (!room.hazDirty) {
      sel.value = now?.type || "";
      $("hazLevel").value = now?.level || "";
      $("hazSupply").value = now?.type === "oxygen" ? now.supply : "";
    }
    hazForm();
    $("hazClear").disabled = !now;
  }
  function hazForm() {
    const i = S.hazardTypes[$("hazType").value];
    $("hazLevelBox").hidden = !i?.levels;
    $("hazSupplyBox").hidden = $("hazType").value !== "oxygen";
    $("hazTrigger").hidden = !i || !["event", "exposure"].includes(i.per);
    $("hazTrigger").disabled = S.station?.hazards?.[room.id]?.type !== $("hazType").value;
    if (i?.levels) {
      $("hazLevel").min = i.levels[0];
      $("hazLevel").max = i.levels[1];
      if (!$("hazLevel").value) $("hazLevel").value = i.levels[0];
      $("hazLevelBox").title = i.levelLabel;
    }
    $("hazRule").innerHTML = i ? `<b>${esc(i.name)}</b> (${esc(hazardTag(i))}; ${esc(i.source)}${i.levelLabel ? `; level ${esc(i.levelLabel)}` : ""}). ${esc(i.rule)}${i.protect ? ` Protects: ${esc(i.protect)}.` : ""}${i.kind === "story" ? " A story hazard is not a Mothership rule." : ""}` : "";
  }
  $("hazType").addEventListener("change", () => { room.hazDirty = true; $("hazLevel").value = ""; hazForm(); });
  for (const id of ["hazLevel", "hazSupply"]) $(id).addEventListener("input", () => { room.hazDirty = true; });
  $("hazSet").onclick = () => {
    room.hazDirty = false;
    send({ t: "hazard", room: room.id, type: $("hazType").value || "none", level: Number($("hazLevel").value) || null, supply: $("hazSupply").value === "" ? undefined : Number($("hazSupply").value) });
  };
  $("hazClear").onclick = () => { room.hazDirty = false; send({ t: "hazard", room: room.id, type: "none" }); };
  $("hazTrigger").onclick = () => send({ t: "hazardTrigger", room: room.id });

  function paintAt(el) {
    const g = el?.closest("[data-x]");
    if (!g || !roomRows) return;
    const x = Number(g.dataset.x), yy = Number(g.dataset.y);
    const row = [...roomRows[yy]];
    if (row[x] === roomTool) return;
    row[x] = roomTool;
    roomRows[yy] = row.join("");
    $("roomPlan").innerHTML = RoomPlan.svg(roomRows, { cell: 24, title: room.label, cls: "editing" });
    saveRoomSoon();
  }
  function saveRoomSoon() {
    clearTimeout(roomSaveTimer);
    roomSaveTimer = setTimeout(() => send({ t: "roomLayout", room: room.id, rows: roomRows }), 400);
  }
  $("roomPlan").addEventListener("mousedown", (e) => { if (roomEditing) { roomPainting = true; paintAt(e.target); e.preventDefault(); } });
  $("roomPlan").addEventListener("mouseover", (e) => { if (roomEditing && roomPainting) paintAt(e.target); });
  addEventListener("mouseup", () => { roomPainting = false; });
  $("roomTools").addEventListener("click", (e) => {
    const t = e.target.closest("[data-tool]")?.dataset.tool;
    if (t === undefined) return;
    const w = roomRows[0]?.length || 0;
    if (t === "+col") roomRows = roomRows.map((r) => `${r}.`);
    else if (t === "-col" && w > 3) roomRows = roomRows.map((r) => r.slice(0, -1));
    else if (t === "+row") roomRows = [...roomRows, ".".repeat(w)];
    else if (t === "-row" && roomRows.length > 3) roomRows = roomRows.slice(0, -1);
    else roomTool = t;
    if (t.length > 1) saveRoomSoon();
    renderRoom(true);
  });
  const saveRoomNow = () => { clearTimeout(roomSaveTimer); send({ t: "roomLayout", room: room.id, rows: roomRows }); (S.config.rooms ||= {})[room.id] = { rows: [...roomRows] }; };
  $("roomEdit").onclick = () => {
    if (roomEditing) saveRoomNow();
    else if (!roomRows) roomRows = ["############", ...Array.from({ length: 6 }, () => "#..........#"), "#####DD#####"];
    roomEditing = !roomEditing;
    renderRoom(true);
  };
  $("roomRedraw").onclick = async () => {
    if (S.config.rooms?.[room.id] && !(await sure(`Redraw ${room.label}?`, "Replaces this floor plan.", "Redraw", "primary"))) return;
    roomEditing = false;
    send({ t: "roomDraft", room: room.id, label: room.label, deck: room.deck });
  };
  $("roomShow").onclick = () => {
    send({ t: "roomShow", room: room.id, label: room.label, pc: $("roomShowTo").value });
    toast(`Showing ${room.label} layout to ${$("roomShowTo").selectedOptions[0].text.toLowerCase()}.`);
  };
  $("roomHide").onclick = () => send({ t: "roomShow", room: room.id, hide: true, pc: $("roomShowTo").value });
  for (const id of ["roomOccupants", "roomContents"]) $(id).addEventListener("input", () => dirty.add(id));
  $("roomSaveWho").onclick = () => {
    const next = structuredClone(S.station);
    (next.occupants ||= {})[room.id] = $("roomOccupants").value.trim();
    (next.contents ||= {})[room.id] = $("roomContents").value.trim();
    dirty.delete("roomOccupants");
    dirty.delete("roomContents");
    send({ t: "station", station: next });
    toast("Saved for the agent's next reply.");
  };
  $("roomValues").addEventListener("click", (e) => {
    const p = e.target.closest("[data-path]")?.dataset.path;
    if (p) editStationValue(JSON.parse(p));
  });
  $("roomDialog").addEventListener("close", () => {
    if (roomEditing) saveRoomNow();
    room = null;
  });

  const soundUrl = (id) => `api/sessions/${code}/sounds/${id}`;
  let soundsKey = "";

  const volumeControl = (cls, volume, title) => {
    const pct = Math.round(volume * 100);
    return `<span class="volctl" title="${title}">
      <input class="${cls}" type="range" min="0" max="1" step="0.01" value="${volume}" aria-label="${title}">
      <input class="volpct" type="number" min="0" max="100" step="1" value="${pct}" aria-label="${title}, percent"><span class="muted">%</span>
    </span>`;
  };
  function syncVolume(target) {
    const ctl = target.closest(".volctl");
    const slider = ctl.querySelector('input[type="range"]'), pct = ctl.querySelector(".volpct");
    if (target === pct) {
      if (pct.value === "") return null;
      const v = Math.max(0, Math.min(100, Math.round(Number(pct.value) || 0)));
      pct.value = v;
      slider.value = v / 100;
      return v / 100;
    }
    pct.value = Math.round(Number(slider.value) * 100);
    return Number(slider.value);
  }

  function renderSounds() {
    const list = $("soundList");
    const key = JSON.stringify(S.sounds);
    if (key !== soundsKey && !list.contains(document.activeElement)) {
      soundsKey = key;
      list.innerHTML = S.sounds.length
        ? S.sounds.map((s) => `<li data-id="${s.id}">
            <input class="sname" value="${esc(s.name)}" aria-label="Sound name" title="Rename">
            ${volumeControl("svol", s.volume, "Volume")}
            <button data-sact="play" title="Play once for players">▶ Once</button>
            <button data-sact="loop" title="Loop until stopped">↻ Loop</button>
            <button class="ghost" data-sact="del" title="Delete sound">✕</button>
          </li>`).join("")
        : `<li class="none">No sounds yet.</li>`;
    }
    const playing = S.playing || [];
    const pl = $("soundPlaying");
    if (!pl.contains(document.activeElement)) {
      pl.innerHTML = playing.length
        ? playing.map((p) => `<li data-pid="${p.pid}"><span>${p.loop ? "↻" : "▶"}</span>
            <span class="grow">${esc(p.name)}${p.loop ? "" : " · once"}</span>
            ${p.loop ? volumeControl("pvol", p.volume, "Live volume") : ""}
            <button data-stop="${p.pid}">Stop</button></li>`).join("")
        : `<li class="none">Silence</li>`;
    }
  }

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
        const body = await upload(`api/sessions/${code}/sounds?name=${encodeURIComponent(file.name)}&seconds=${seconds.toFixed(2)}`, file);
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
    else if (act === "del" && await sure(`Delete "${s.name}"?`, "Removes the file and stops it.", "Delete")) {
      const r = await fetch(soundUrl(s.id), { method: "DELETE", headers: { "X-Warden-Token": key } });
      if (!r.ok && r.status !== 404) toast("Couldn't delete that sound.", "error");
    }
  });
  $("soundList").addEventListener("change", (e) => {
    const li = e.target.closest("li[data-id]");
    if (!li) return;
    if (e.target.classList.contains("sname")) send({ t: "soundEdit", id: li.dataset.id, name: e.target.value });
    if (e.target.closest(".volctl")) {
      const volume = syncVolume(e.target);
      if (volume !== null) send({ t: "soundEdit", id: li.dataset.id, volume });
    }
    e.target.blur();
  });
  $("soundList").addEventListener("input", (e) => { if (e.target.classList.contains("svol")) syncVolume(e.target); });
  $("soundList").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.target.classList.contains("sname") || e.target.classList.contains("volpct"))) e.target.blur(); });
  $("soundPlaying").addEventListener("click", (e) => {
    const stop = e.target.closest("[data-stop]");
    if (!stop) return;
    send({ t: "soundStop", pid: stop.dataset.stop });
    stop.blur();
    stop.closest("li").remove();
    if (!$("soundPlaying").children.length) $("soundPlaying").innerHTML = `<li class="none">Silence</li>`;
  });
  $("soundPlaying").addEventListener("input", (e) => {
    const li = e.target.closest("li[data-pid]");
    if (!li || !e.target.closest(".volctl")) return;
    const volume = syncVolume(e.target);
    if (volume !== null) send({ t: "soundVolume", pid: li.dataset.pid, volume });
  });
  $("soundPlaying").addEventListener("change", (e) => e.target.blur());
  $("soundPlaying").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.classList.contains("volpct")) e.target.blur(); });
  $("soundStopAll").onclick = () => send({ t: "soundStop", all: true });

  const SETTING_SWITCHES = ["narrator", "coldOpen", "agentEffects", "agentVariants", "agentCrew", "checkFirst", "playerVitals", "playerRolls", "panicScreens", "playerTerminals"];

  const voicesOn = () => (S.config.discordTalk ? "discord" : S.config.tts !== false ? "screens" : "off");
  function renderVoicesOn() {
    const on = voicesOn(), d = S.discord || {};
    for (const b of $("voicesOn").children) {
      b.classList.toggle("on", b.dataset.on === on);
      b.setAttribute("aria-checked", String(b.dataset.on === on));
    }
    const discordBtn = $("voicesOn").querySelector('[data-on="discord"]');
    discordBtn.disabled = !d.enabled && on !== "discord";
    discordBtn.title = d.enabled ? "Bot speaks in its voice channel, else the terminals" : "No Discord bot on this server";
    $("voicesNote").textContent = on === "discord"
      ? d.listening ? `Spoken in ${d.listening.channel} on Discord.` : "Bot not in a voice channel. Terminals speak for now."
      : on === "screens" ? "Each terminal speaks the lines aloud." : "Voices off. Lines are text only.";
  }
  $("voicesOn").addEventListener("click", (e) => {
    const on = e.target.closest("[data-on]")?.dataset.on;
    if (!on || on === voicesOn()) return;
    send({ t: "config", patch: { tts: on === "screens", discordTalk: on === "discord" } });
  });

  function renderConfig() {
    const c = S.config;
    $("talk").value = c.talk || "brief";
    for (const id of ["stationName", "lore", "secrets", "standingOrders", "theme"]) {
      const el = $(id);
      if (!dirty.has(id) && document.activeElement !== el && el.value !== c[id]) el.value = c[id];
    }
    growStory();
    for (const id of SETTING_SWITCHES) $(id).checked = c[id] !== false;
    for (const id of ["playerCreate", "createRerolls"]) $(id).checked = c[id] === true;
    renderVoicesOn();
    if (!dirty.has("station") && document.activeElement !== $("station")) $("station").value = JSON.stringify(S.station, null, 2);
  }

  $("mode").addEventListener("click", (e) => {
    const m = e.target.closest("button")?.dataset.mode;
    if (m) send({ t: "config", patch: { mode: m } });
  });

  for (const id of ["stationName", "lore", "secrets", "standingOrders"]) {
    const el = $(id);
    let t;
    const save = () => { clearTimeout(t); dirty.delete(id); send({ t: "config", patch: { [id]: el.value } }); };
    el.addEventListener("input", () => { dirty.add(id); clearTimeout(t); t = setTimeout(save, 800); });
    el.addEventListener("blur", () => dirty.has(id) && save());
  }
  for (const id of ["theme", "talk", "provider", "model", "effort"]) $(id).addEventListener("change", (e) => send({ t: "config", patch: { [id]: e.target.value } }));
  $("panicTryGo").onclick = () => send({ t: "panicShow", n: Number($("panicTry").value) });
  for (const id of [...SETTING_SWITCHES, "playerCreate", "createRerolls"]) $(id).addEventListener("change", (e) => send({ t: "config", patch: { [id]: e.target.checked } }));
  $("settingsBtn").onclick = () => $("settingsDialog").showModal();

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

  let composeMode = "command";
  const composeModes = () => ["command", "note", ...[...$("sendAs").options].map((o) => `voice:${o.value}`)];
  const currentComposeMode = () => (composeMode === "voice" ? `voice:${$("sendAs").value}` : composeMode);

  function setComposeMode(mode) {
    if (mode.startsWith("voice:")) {
      $("sendAs").value = mode.slice(6);
      composeMode = "voice";
    } else composeMode = mode;
    renderComposeMode();
  }

  function renderComposeMode() {
    for (const [id, mode] of [["sendCommand", "command"], ["sendVoice", "voice"], ["sendNote", "note"]]) $(id).classList.toggle("primary", composeMode === mode);
    $("sendAs").classList.toggle("on", composeMode === "voice");
    const who = $("sendAs").selectedOptions[0]?.text || "a voice";
    $("compose").placeholder = composeMode === "command" ? "Drive agent, not shown to players"
      : composeMode === "note" ? "Private note to agent"
      : `Speak as ${who.replace(/ \(terminal\)$/, "")}`;
    $("compose").dataset.mode = composeMode;
  }

  function compose(as) {
    const text = $("compose").value.trim();
    if (!text) return;
    if (as === "note") send({ t: "note", text });
    else if (as === "command") send({ t: "command", text });
    else {
      const as = $("sendAs").value, system = $("sendOn").hidden ? "" : $("sendOn").value;
      if (as.startsWith("cast:")) send({ t: "inject", cast: as.slice(5), text, clearPending: true, system });
      else send({ t: "inject", as, text, clearPending: true, system });
    }
    $("compose").value = "";
  }
  const sendIn = (mode) => () => { setComposeMode(mode === "voice" ? `voice:${$("sendAs").value}` : mode); compose(mode); $("compose").focus(); };
  $("sendCommand").onclick = sendIn("command");
  $("sendVoice").onclick = sendIn("voice");
  $("sendNote").onclick = sendIn("note");
  $("sendAs").addEventListener("change", () => { setComposeMode(`voice:${$("sendAs").value}`); $("compose").focus(); });
  $("compose").addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      const modes = composeModes();
      const i = modes.indexOf(currentComposeMode());
      setComposeMode(modes[(i + (e.shiftKey ? -1 : 1) + modes.length) % modes.length]);
    } else if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      compose(e.ctrlKey || e.metaKey ? "note" : composeMode);
    }
  });
  renderComposeMode();

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let listening = false, recog = null, quickEnds = 0;
  const micStatus = (text) => { $("micLive").textContent = text; };
  function setListening(on) {
    listening = on;
    quickEnds = 0;
    $("micBtn").setAttribute("aria-pressed", String(on));
    $("micBtn").textContent = on ? "Listening" : "Listen";
    $("micLive").hidden = !on;
    micStatus(on ? "Starting mic…" : "");
    if (on) startRecog();
    else recog?.abort();
  }
  function micFailed(text) {
    console.warn(`[listen] ${text}`);
    toast(text, "error");
    setListening(false);
  }
  const MIC_ERRORS = {
    "not-allowed": "Microphone blocked. Allow it in the address bar, then Listen again.",
    "service-not-allowed": "Speech recognition unavailable here. Use Chrome or Edge.",
    "audio-capture": "No microphone found.",
    network: "No speech service in this browser. Use Chrome or Edge.",
    "language-not-supported": `Speech recognition doesn't support ${navigator.language}.`,
  };
  function startRecog() {
    const r = (recog = new Recognition());
    const started = Date.now();
    let heardAny = false;
    recog.lang = navigator.language || "en-US";
    recog.continuous = true;
    recog.interimResults = true;
    recog.onaudiostart = () => micStatus("Listening…");
    recog.onresult = (e) => {
      heardAny = true;
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) { const text = res[0].transcript.trim(); if (text) send({ t: "heard", text }); }
        else interim += res[0].transcript;
      }
      micStatus(interim.trim() ? `${interim.trim()}…` : "Listening…");
    };
    recog.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (recog === r) micFailed(MIC_ERRORS[e.error] || `Speech recognition stopped: ${e.error}${e.message ? ` (${e.message})` : ""}.`);
    };
    recog.onend = () => {
      if (!listening || recog !== r) return;
      quickEnds = !heardAny && Date.now() - started < 1500 ? quickEnds + 1 : 0;
      if (quickEnds >= 4) return micFailed("Speech recognition keeps stopping. Use Chrome or Edge.");
      setTimeout(() => listening && recog === r && startRecog(), 250);
    };
    try { recog.start(); } catch (err) { micFailed(`Couldn't start speech recognition: ${err.message}`); }
  }
  const FIREFOX_HOW = "In about:config, set media.webspeech.recognition.enable to true, then reload.";
  const micUnavailable = !window.isSecureContext
    ? "Listen needs https or localhost."
    : !Recognition ? (/firefox/i.test(navigator.userAgent) ? FIREFOX_HOW : "No speech recognition here. Use Chrome, Edge or Firefox.") : "";
  if (micUnavailable) $("micBtn").title = micUnavailable;
  $("micBtn").onclick = () => (discordReady() ? (S.discord.listening ? send({ t: "discordStop" }) : copyDiscordCommand()) : micUnavailable ? toast(micUnavailable, "error") : setListening(!listening));

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
          const variants = [...row.querySelectorAll(".dvar")].map((d) => ({ for: d.querySelector(".dvfor").value.trim(), text: d.querySelector(".dvtext").value }))
            .filter((v) => v.for && v.text.trim());
          return { voice: row.querySelector("select").value, character: row.querySelector(".dchar").value.trim(), system: row.querySelector(".dsys")?.value || "", text: row.querySelector(".dwho + textarea").value, effects: fx, variants, reveal: row.dataset.reveal || "" };
        })
        .filter((l) => l.text.trim() || l.effects.length || l.variants.length),
      station_changes: r.station_changes.filter((_, i) => card.querySelector(`[data-chg="${i}"]`)?.checked),
      crew_changes: (r.crew_changes || []).filter((_, i) => card.querySelector(`[data-crw="${i}"]`)?.checked),
      effects: r.effects.filter((_, i) => card.querySelector(`[data-eff="${i}"]`)?.checked),
    };
    send({ t: "approve", reply });
  }
  $("pending").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "approve") approve();
    else if (act === "addLine") $("draftLines").insertAdjacentHTML("beforeend", draftLine({ voice: "terminal", text: "" }));
    else if (act === "delLine") e.target.closest(".dline").remove();
    else if (act === "addVar") { e.target.insertAdjacentHTML("beforebegin", variantRow({ for: "", text: "" })); e.target.previousElementSibling.querySelector("input").focus(); }
    else if (act === "delVar") e.target.closest(".dvar").remove();
    else if (act === "discard") send({ t: "discard" });
    else if (act === "regen") send({ t: "generate", steer: $("steer")?.value || "" });
  });
  $("pending").addEventListener("change", (e) => {
    if (!e.target.matches(".dwho select:not(.dsys)")) return;
    const box = e.target.parentElement.querySelector(".dchar");
    box.hidden = e.target.value !== S.config.castChannel && !box.value;
  });
  $("pending").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (e.target.id === "steer") send({ t: "generate", steer: e.target.value });
      else approve();
    }
  });
  $("retcon").onclick = () => send({ t: "retcon" });

  $("logDownload").onclick = () => {
    if (!S) return;
    const c = S.config;
    const game = {
      app: "Mothership Terminal",
      session: code,
      exported: new Date().toISOString(),
      storyStarted: S.storyStartedAt ? new Date(S.storyStartedAt).toISOString() : null,
      story: {
        station: c.stationName, lore: c.lore, secrets: c.secrets, standingOrders: c.standingOrders, map: c.map,
        voices: c.voices.map((v) => ({ id: v.id, name: v.name })),
        terminals: c.terminals.map((t) => ({ id: t.id, name: t.name, room: t.room, system: t.system })),
        rooms: c.rooms,
      },
      crew: c.crew,
      cast: c.cast,
      station: S.station,
      log: S.log,
      handouts: S.handouts,
      roomDocs: (c.roomDocs || []).map((d) => ({ ...d, found: (S.found || []).includes(d.id) })),
      clocks: S.clocks,
      synopses: S.synopses,
    };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(game, null, 2)], { type: "application/json" }));
    a.download = `${c.stationName || "game"}-${code}-${new Date().toISOString().slice(0, 10)}.json`.replace(/[^\w.-]+/g, "_");
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };

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
    const since = S.storyStartedAt ? new Date(S.storyStartedAt).toLocaleString() : "";
    const text = (since ? `Undoes every story change since play began (${since}).` : "Not played yet. Characters are made fresh.")
      + " Clears the log, rolls, clocks, effects and handouts. Players return to the start.";
    if (await sure("Restart the story?", text, "Restart")) send({ t: "resetSession" });
  };
  $("resetAll").onclick = async () => (await sure("Factory reset?", "Resets the whole story to the defaults.", "Factory reset")) && send({ t: "resetAll" });

  const BUILTIN_IDS = ["terminal", "broadcast", "narrator"];
  const BASE_VOICE = { engine: "espeak", speaker: "am_michael", pace: 1, variant: "", pitch: 50, speed: 170, wordgap: 0 };
  const presetSound = (p) => ({ voice: { ...BASE_VOICE, ...p.voice }, fx: Object.fromEntries(Object.entries(S.voiceOptions.fxParams).map(([k, [, , def]]) => [k, p.fx[k] ?? def])) });
  const FX_LABELS = {
    rate: "Speed / pitch", highpass: "Low cut (Hz)", lowpass: "High cut (Hz)", drive: "Distortion",
    ringMix: "Robot warble", ringFreq: "Warble freq (Hz)", comb: "Metallic", combMs: "Metallic tone (ms)",
    chorus: "Chorus", echo: "Echo", echoTime: "Echo time (s)", echoFeedback: "Echo repeats",
    reverb: "Reverb", noise: "Radio hiss", dry: "Direct level",
  };
  const VARIANT_LABELS = { "": "default", whisperf: "whisper (female)", klatt: "klatt (synthetic)", klatt2: "klatt 2", klatt3: "klatt 3" };

  let voicesDraft = null;
  let voicesSentAt = 0;
  const sendVoicesNow = () => { voicesSentAt = 0; send({ t: "voices", voices: voicesDraft }); };
  let voicesTimer = null;

  function voiceName(id) {
    return S?.config.voices.find((v) => v.id === id)?.name || id;
  }

  function renderSendAs() {
    const sel = $("sendAs");
    const prev = sel.value || "terminal";
    fillSelect(sel, [
      ...S.config.voices.map((v) => [v.id, v.id === "terminal" ? `${v.name} (terminal)` : v.adversary && !v.adversary.revealed ? `${v.name} (as ???)` : v.name]),
      ...(S.config.cast || []).map((c) => [`cast:${c.id}`, c.name]),
    ], prev);
    if (!sel.value) sel.value = "terminal";
    renderSendOn();
    renderComposeMode();
  }

  function renderSendOn() {
    const sel = $("sendOn");
    const nameOf = (id) => { const t = S.config.terminals.find((x) => x.id === id); return t?.system || S.config.stationName; };
    sel.hidden = !S.config.terminals.some((t) => t.system);
    if (sel.hidden) return;
    const here = [...new Set((S.screens || []).filter((x) => x.terminal).map((x) => nameOf(x.terminal)))];
    const opts = [...(here.length > 1 ? here.map((n) => [n, `on ${n}`]) : [["", here.length ? `on ${here[0]}` : "where the players are"]]), ["ALL", "to All"]];
    const prev = opts.some(([v]) => v === sel.value) ? sel.value : opts[0][0];
    fillSelect(sel, opts, prev);
  }

  function saveVoices() {
    clearTimeout(voicesTimer);
    voicesTimer = setTimeout(() => {
      voicesTimer = null;
      voicesSentAt = Date.now();
      send({ t: "voices", voices: voicesDraft });
    }, 350);
  }

  function renderVoices(fromDraft = false) {
    const panel = $("voices");
    if (!fromDraft) {
      const editing = panel.contains(document.activeElement) || voicesTimer !== null || Date.now() - voicesSentAt < 1500;
      if (voicesDraft && editing) return;
      const json = JSON.stringify(S.config.voices);
      if (panel.dataset.json === json) return;
      panel.dataset.json = json;
      voicesDraft = structuredClone(S.config.voices);
    }
    const o = S.voiceOptions;
    panel.innerHTML = voicesDraft.map((v, i) => v.adversary ? "" : `
      <div class="vcard" data-i="${i}">
        <div class="row">
          <input data-k="name" value="${esc(v.name)}" aria-label="Name" class="vname">
          <button data-act="test" title="Preview voice here">▶ Test</button>
          ${BUILTIN_IDS.includes(v.id) ? `<span class="pill">built-in</span>` : `<button data-act="del" class="danger" title="Delete voice">✕</button>`}
        </div>
        <label class="field"><span>Persona</span>
          <textarea data-k="persona" rows="${v.id === "terminal" ? 10 : 4}" placeholder="Who this is, how it talks">${esc(v.persona || "")}</textarea></label>
        <div class="vgrid">
          <label>Style
            <select data-k="style">${o.styles.map((st) => `<option value="${st}" ${st === v.style ? "selected" : ""}>${{ plain: "plain text", label: "NAME: label", boxed: "boxed", narration: "narration (italic, no name)" }[st]}</option>`).join("")}</select>
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
        Object.assign(v, presetSound(p));
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
        saveVoices();
        renderVoices(true);
        return restoreCard(card.dataset.i);
      }
      const out = e.target.parentElement.querySelector("output");
      if (out) out.textContent = Number(val).toFixed(Number(e.target.step) < 1 ? 2 : 0);
    }
    saveVoices();
  });

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
    } else if (act === "del") {
      const v = voicesDraft[i];
      if (!(await sure(`Delete "${v.name}"?`, "The voice and its persona are removed.", "Delete"))) return;
      i = voicesDraft.indexOf(v);
      if (i < 0) return;
      voicesDraft.splice(i, 1);
      sendVoicesNow();
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
      ...presetSound(p),
    });
    sendVoicesNow();
  };

  const checkName = (id) => (id === "panic" ? "Panic" : S?.rollOptions?.checks[id]?.label || id);
  const advMark = (a) => (a === "advantage" ? " [+]" : a === "disadvantage" ? " [−]" : "");

  function rollFormHome() {
    if ($("rollForm").parentElement !== $("rollCard")) $("rollCard").append($("rollForm"));
    $("rollAway").hidden = true;
    rollFromOutcome = false;
  }

  function renderOutcome() {
    const card = $("outcome");
    const oc = S.outcomeCheck;
    if (!oc || card.dataset.id !== oc.id) rollFormHome();
    card.hidden = !oc;
    if (!oc) { card.dataset.id = ""; return; }
    if (card.dataset.id === oc.id) return;
    card.dataset.id = oc.id;
    card.innerHTML = `
      <div class="label">⚖ Your call: the players are attempting</div>
      ${oc.held ? '<div class="muted small">Players see PROCESSING until you decide.</div>' : ""}
      <div class="attempt">${esc(oc.attempt || "(something uncertain)")}</div>
      ${oc.suggested_check !== "none" ? `<div class="muted small">Agent suggests: ${esc(checkName(oc.suggested_check))}${advMark(oc.advantage)}</div>` : ""}
      ${oc.why ? `<div class="note">${esc(oc.why)}</div>` : ""}
      <div class="stakes">
        <label><span class="ok">✓ If it works:</span><input data-stake="on_success" value="${esc(oc.on_success || "")}" placeholder="what happens"></label>
        <label><span class="bad">✗ If it fails:</span><input data-stake="on_failure" value="${esc(oc.on_failure || "")}" placeholder="what goes wrong"></label>
      </div>
      <div class="row wrap">
        <button data-oc="success" class="ocbtn ok" title="It works" aria-label="It works">✓</button>
        <button data-oc="failure" class="ocbtn bad" title="It fails" aria-label="It fails">✗</button>
        <button data-oc="roll" class="ocbtn" title="Call for a roll" aria-label="Call for a roll">Roll</button>
        <span class="grow"></span>
        <button data-oc="dismiss" class="ghost">Dismiss</button>
      </div>
      <div class="ocroll"></div>`;
  }

  let stakesTimer = null;
  const sendStakes = () => {
    clearTimeout(stakesTimer);
    stakesTimer = null;
    const val = (k) => $("outcome").querySelector(`[data-stake="${k}"]`)?.value.trim() ?? "";
    send({ t: "outcomeStakes", on_success: val("on_success"), on_failure: val("on_failure") });
  };
  $("outcome").addEventListener("input", (e) => {
    if (!e.target.dataset.stake) return;
    clearTimeout(stakesTimer);
    stakesTimer = setTimeout(sendStakes, 400);
  });
  $("outcome").addEventListener("click", (e) => {
    const act = e.target.closest("[data-oc]")?.dataset.oc;
    const oc = S?.outcomeCheck;
    if (!act || !oc) return;
    if (stakesTimer) sendStakes();
    if (act === "success" || act === "failure") send({ t: "outcome", verdict: act });
    else if (act === "dismiss") send({ t: "outcomeDismiss" });
    else if (act === "roll") {
      if ($("rollForm").parentElement !== $("rollCard")) return rollFormHome();
      if (oc.suggested_check !== "none") $("rollCheck").value = oc.suggested_check;
      const by = S.log.findLast((e) => e.kind === "player" && e.by)?.by;
      const pc = S.config.crew.find((c) => c.name === by);
      if (pc) $("rollWho").value = pc.id;
      $("rollAdv").value = oc.advantage || "none";
      $("rollReason").value = oc.attempt || "";
      rollFromOutcome = true;
      rollFormChanged();
      $("outcome").querySelector(".ocroll").append($("rollForm"));
      $("rollAway").hidden = false;
      $("rollForm").scrollIntoView({ behavior: "smooth", block: "nearest" });
      $("rollWho").focus();
    }
  });

  let rollFromOutcome = false, rollWhoKey = "";
  const rollSkillName = (v) => v.slice(2);
  const skillBonus = (pc, skill) => (skill && pc.skills.find((k) => k.name.toLowerCase() === skill.toLowerCase())?.bonus) || 0;

  function renderRoll() {
    const sel = $("rollCheck");
    if (!sel.options.length) {
      const checks = Object.entries(S.rollOptions.checks);
      const group = (kind) => checks.filter(([, c]) => c.kind === kind).map(([id, c]) => `<option value="${id}">${c.label}</option>`).join("");
      sel.innerHTML = `<optgroup label="Stats">${group("Stat")}</optgroup><optgroup label="Saves">${group("Save")}</optgroup>
        <optgroup label="Stress"><option value="panic">Panic check (d20 vs Stress)</option></optgroup>`;
      sel.value = "intellect";
    }
    const crew = S.config.crew;
    const whoKey = JSON.stringify(crew.map((c) => [c.id, c.name, c.skills]));
    if (whoKey !== rollWhoKey) {
      rollWhoKey = whoKey;
      const who = $("rollWho"), was = who.value;
      who.innerHTML = crew.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")
        + (crew.length > 1 ? `<option value="all">All (each rolls)</option>` : "");
      if ([...who.options].some((o) => o.value === was)) who.value = was;
      $("rollSkill").dataset.for = "";
    }
    rollFormChanged();
    renderRollStatus();
    renderOffers();
  }

  function rollFormChanged() {
    const crew = S.config.crew;
    const who = $("rollWho").value;
    const pcs = who === "all" ? crew : crew.filter((c) => c.id === who);
    const panic = $("rollCheck").value === "panic";
    const skillSel = $("rollSkill");
    if (skillSel.dataset.for !== who) {
      skillSel.dataset.for = who;
      const was = skillSel.value;
      const skills = [...new Map(pcs.flatMap((c) => c.skills).map((k) => [k.name.toLowerCase(), k.name])).values()];
      const short = (c) => c.name.match(/"([^"]+)"/)?.[1] || c.name.split(/\s+/)[0];
      skillSel.innerHTML = `<option value="">No skill</option>` + skills.map((k) => {
        const label = who === "all"
          ? `${k} (${pcs.filter((c) => skillBonus(c, k)).map((c) => `${short(c)} +${skillBonus(c, k)}`).join(", ")})`
          : `${k} +${skillBonus(pcs[0], k)}`;
        return `<option value="s:${esc(k)}">${esc(label)}</option>`;
      }).join("");
      if ([...skillSel.options].some((o) => o.value === was)) skillSel.value = was;
    }
    for (const el of document.querySelectorAll("#rollCard .rollskill")) el.hidden = panic;
    const check = $("rollCheck").value, skill = rollSkillName(skillSel.value);
    const line = (c) => {
      if (panic) return `${c.name}: Stress ${c.stress}, panics on a d20 of ${c.stress} or under`;
      const stat = c.stats[check] ?? c.saves[check];
      const plus = skillBonus(c, skill);
      return `${c.name}: ${checkName(check)} ${stat}${plus ? ` + ${plus}` : ""}, roll under ${stat + plus}`;
    };
    $("rollTarget").innerHTML = pcs.length ? pcs.map((c) => esc(line(c))).join("<br>") : "Add crew to call for rolls.";
    $("rollCall").disabled = !pcs.length || S.roll?.status === "waiting";
    const plusAble = panic && pcs.some((c) => c.className === "Teamster" && !S.panicPlus?.[c.id]);
    $("rollPlusRow").hidden = !plusAble;
    if (!plusAble) $("rollPlus").checked = false;
  }
  for (const id of ["rollWho", "rollCheck", "rollSkill"]) $(id).addEventListener("change", rollFormChanged);

  function renderRollStatus() {
    const r = S.roll;
    const box = $("rollStatus");
    box.hidden = !r;
    if (!r) return;
    const label = `${checkName(r.check)}${advMark(r.advantage)}${r.bonus ? ` · ${r.skill || "skill"} +${r.bonus}` : ""}${r.reason ? ` · ${r.reason}` : ""}`;
    const show = (d) => (r.check === "panic" ? String(d) : String(d).padStart(2, "0"));
    const rows = r.pcs.map((p) => {
      const got = r.results[p.id];
      if (!got) {
        if (r.status !== "waiting") return `<li class="muted">${esc(p.name)}: didn't roll</li>`;
        const nobody = !S.claims[p.id] ? ` <span class="muted small">(not played)</span>` : "";
        return `<li><span class="spinner"></span>${esc(p.name)}: waiting${nobody} <button data-roll="for" data-pc="${esc(p.id)}" class="ghost" title="Roll for them here">Roll for them</button></li>`;
      }
      const res = got.result;
      const dice = `${res.dice.map(show).join(" / ")}${res.dice.length > 1 ? ` → ${show(res.used)}` : ""}`;
      const verdict = res.panic
        ? (res.success ? "kept their cool" : `PANIC · Panic Table ${res.used}`)
        : `${res.outcome.toUpperCase()}${res.panicCheck ? ": PANIC CHECK" : ""}${res.success ? "" : " · +1 STRESS"}`;
      const how = got.by === "warden" ? " (you rolled)" : got.manual ? " (table dice)" : "";
      return `<li class="res ${res.success ? "ok" : "bad"}">${esc(p.name)}: ${dice} ${res.panic ? "vs Stress" : "vs"} ${res.target}${how}: ${esc(verdict)}</li>`;
    }).join("");
    const narrate = hasKey()
      ? `<span class="muted small">The agent narrates the result.</span>`
      : `<span class="muted small">No AI key. Narrate with Speak.</span>`;
    box.innerHTML = `<div><b>${esc(label)}</b></div><ul class="rollres">${rows}</ul>
      <div class="row">${r.status === "waiting"
        ? `<span class="grow"></span><button data-roll="cancel" class="ghost">${Object.keys(r.results).length ? "Stop waiting" : "Cancel roll"}</button>`
        : `${narrate}<span class="grow"></span><button data-roll="clear" class="ghost">Clear</button>`}</div>`;
  }

  $("rollCall").onclick = () => {
    send({
      t: "rollRequest",
      fromOutcome: rollFromOutcome,
      roll: {
        pc: $("rollWho").value,
        check: $("rollCheck").value,
        advantage: $("rollAdv").value,
        skill: rollSkillName($("rollSkill").value),
        reason: $("rollReason").value,
        plus: $("rollPlus").checked,
      },
    });
    $("rollPlus").checked = false;
    rollFromOutcome = false;
  };
  $("rollOffers").addEventListener("click", (e) => {
    const b = e.target.closest("[data-offer]");
    if (b) send({ t: b.dataset.act === "dismiss" ? "offerDismiss" : "offerRoll", id: b.dataset.offer });
  });
  function renderOffers() {
    const box = $("rollOffers"), offers = S.offers || [];
    const busy = S.roll?.status === "waiting";
    box.hidden = !offers.length;
    box.innerHTML = offers.map((o) => `<div class="row wrap"><span class="grow">${esc(o.label)}</span><button data-offer="${esc(o.id)}" data-act="call" ${busy ? 'disabled title="Finish the roll in progress first"' : ""}>${o.roll.check === "panic" ? "Panic check" : "Fear Save"}</button><button data-offer="${esc(o.id)}" data-act="dismiss" class="ghost">Dismiss</button></div>`).join("");
  }
  $("rollStatus").addEventListener("click", (e) => {
    const b = e.target.closest("[data-roll]");
    const act = b?.dataset.roll;
    if (act === "cancel" || act === "clear") send({ t: "rollCancel" });
    else if (act === "for") send({ t: "rollFor", pc: b.dataset.pc });
  });

  function renderHandouts() {
    const to = $("docTo");
    const opts = [["", "Everyone"], ...S.config.crew.map((c) => [c.id, c.name])];
    fillSelect(to, opts, opts.some(([v]) => v === to.value) ? to.value : "");
    fillSelect($("docVoice"), [["", "None (written)"], ...S.config.voices.map((v) => [v.id, v.name]), ...(S.config.cast || []).map((c) => [`cast:${c.id}`, c.name])], $("docVoice").value || "");
    const roomsOf = [...StationMap.parseLayout(S.config.map).flatMap((d) => d.rooms), ...StationMap.parseDocked(S.config.map)];
    const roomLabel = (id) => roomsOf.find((r) => r.id === id)?.label || id;
    fillSelect($("docRoom"), [["", "Hand out now"], ...roomsOf.map((r) => [r.id, `In ${r.label}`])], $("docRoom").value || "");
    syncDocSend();
    const found = new Set(S.found || []);
    const docs = S.config.roomDocs || [];
    $("roomDocHead").hidden = !docs.length;
    $("roomDocList").innerHTML = docs.map((d) => `<li title="${esc(d.text.slice(0, 300))}"><span class="grow">${found.has(d.id) ? "<s>" : ""}${esc(d.title)}${found.has(d.id) ? "</s>" : ""} <span class="muted">· ${d.voice ? "audio log · " : ""}${esc(roomLabel(d.room))}${found.has(d.id) ? " · found" : ""}</span></span>${found.has(d.id) ? "" : `<button data-rdoc-give="${esc(d.id)}" class="ghost" title="Give it to the players now (to: the To above)">Give</button>`}<button data-rdoc-del="${esc(d.id)}" class="ghost" title="Take it out of the story">✕</button></li>`).join("");
    const list = (S.handouts || []).slice().reverse();
    const nameOf = (id) => S.config.crew.find((c) => c.id === id)?.name || "everyone";
    $("docList").innerHTML = list.length ? list.map((h) => `<li title="${esc(h.text.slice(0, 300))}"><span class="grow">${esc(h.title)} <span class="muted">· ${h.voice ? "audio log · " : ""}${esc(h.to ? nameOf(h.to) : "everyone")}</span></span><button data-doc-again="${esc(h.id)}" class="ghost" title="Show again">↻</button><button data-doc-del="${esc(h.id)}" class="ghost" title="Take it back">✕</button></li>`).join("") : '<li class="muted small">None given yet.</li>';
  }
  function handoutWriting(busy) {
    $("docWrite").disabled = busy;
    $("docWrite").textContent = busy ? "Writing…" : "Write it";
  }
  $("docWrite").onclick = () => {
    const title = $("docTitle").value.trim(), brief = $("docText").value.trim();
    if (!brief && !title) return toast("Describe the document first.", "error");
    send({ t: "handoutWrite", brief, title, voice: $("docVoice").value });
  };
  $("docSend").onclick = () => {
    const title = $("docTitle").value.trim(), text = $("docText").value.trim();
    if (!title || !text) return toast("Add a title and text.", "error");
    if ($("docRoom").value) send({ t: "roomDocPlace", room: $("docRoom").value, title, text, voice: $("docVoice").value });
    else send({ t: "handout", title, text, to: $("docTo").value, voice: $("docVoice").value });
    $("docTitle").value = $("docText").value = "";
  };
  function syncDocSend() { $("docSend").textContent = $("docRoom").value ? "Leave it there" : "Hand it out"; }
  $("docRoom").onchange = syncDocSend;
  $("roomDocList").addEventListener("click", (e) => {
    const give = e.target.closest("[data-rdoc-give]")?.dataset.rdocGive, del = e.target.closest("[data-rdoc-del]")?.dataset.rdocDel;
    if (give) send({ t: "roomDocGive", id: give, to: $("docTo").value });
    if (del) send({ t: "roomDocDelete", id: del });
  });
  $("docVoice").onchange = () => {
    $("docText").placeholder = $("docVoice").value ? "What's said, a line each, or describe it and press Write it" : "Text, or describe it and press Write it";
  };
  $("docList").addEventListener("click", (e) => {
    const again = e.target.closest("[data-doc-again]")?.dataset.docAgain, del = e.target.closest("[data-doc-del]")?.dataset.docDel;
    if (again) send({ t: "handoutAgain", id: again });
    if (del) send({ t: "handoutDelete", id: del });
  });

  function renderClocks() {
    const list = S?.clocks || [];
    $("clockList").innerHTML = list.length ? list.map((c) => {
      const s = c.paused ? c.left : Math.max(0, Math.ceil((c.ends - Date.now()) / 1000));
      const id = esc(c.id);
      return `<li class="${c.paused ? "paused" : ""}"><span class="grow">${esc(c.label)}${c.paused ? ' <span class="muted">· paused</span>' : ""}</span><span class="ctime${s <= 30 && !c.paused ? " low" : ""}">${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}</span>
        <button data-clock-pause="${id}" data-pause="${c.paused ? "" : "1"}" class="ghost" title="${c.paused ? "Resume" : "Pause on every screen"}">${c.paused ? "Resume" : "Pause"}</button>
        <button data-clock-shift="${id}" data-seconds="-60" class="ghost" title="A minute less">−1m</button>
        <button data-clock-shift="${id}" data-seconds="60" class="ghost" title="A minute more">+1m</button>
        <button data-clock="${id}" class="ghost danger" title="Cancel, nothing happens">✕</button></li>`;
    }).join("") : '<li class="muted small">None running.</li>';
  }
  setInterval(() => S?.clocks?.some((c) => !c.paused) && renderClocks(), 1000);
  function renderShip() {
    $("shipHead").hidden = !S.ships;
    window.ShipUI?.warden($("shipCard"), S, send);
  }
  const hazardTag = (i) => (i.kind === "psg" ? "Mothership rule" : "story hazard");
  function renderHazards() {
    const rooms = roomLabels();
    const hz = Object.entries(S.station?.hazards || {});
    $("hazardList").innerHTML = hz.length ? hz.map(([id, h]) => {
      const i = S.hazardTypes[h.type];
      return `<li><span class="grow"><b>${esc(id === "rig" ? "The whole rig" : String(rooms.get(id) || id).split(",")[0])}</b>: ${esc(i.name)}${h.level ? ` ${h.level}` : ""}${h.type === "oxygen" ? `, supply ${h.supply}` : ""} <span class="muted">· ${hazardTag(i)} · ${h.rounds} rounds, ${h.hours} h</span></span>
        <button data-haz-room="${esc(id)}" class="ghost" title="Open the room view">Room</button><button data-haz-end="${esc(id)}" class="ghost danger" title="End this hazard">End</button></li>`;
    }).join("") : '<li class="muted small">No hazards in play. Click a room on the Map to set one.</li>';
    const waiting = S.roll?.status === "waiting" && S.roll.hazard;
    $("hazardQueue").textContent = [waiting && `Waiting for a hazard roll: ${S.roll.reason}`, S.hazardWork && `${S.hazardWork} step${S.hazardWork > 1 ? "s" : ""} queued`].filter(Boolean).join(" · ");
    $("hazardRollAll").hidden = !waiting;
    $("rationing").checked = !!S.rationing;
  }
  $("rationing").onchange = (e) => send({ t: "rationing", on: e.target.checked });
  $("nextRound").onclick = () => send({ t: "nextRound" });
  for (const b of document.querySelectorAll("[data-pass]")) b.onclick = () => send({ t: "passTime", hours: Number(b.dataset.pass) });
  $("hazardRollAll").onclick = () => send({ t: "hazardRollAll" });
  $("hazardList").addEventListener("click", (e) => {
    const end = e.target.closest("[data-haz-end]")?.dataset.hazEnd, open = e.target.closest("[data-haz-room]")?.dataset.hazRoom;
    if (end) send({ t: "hazard", room: end, type: "none" });
    if (open) openRoom(open, roomLabels().get(open) || open, "");
  });
  $("clockStart").onclick = () => {
    const label = $("clockLabel").value.trim();
    const mins = Number($("clockMins").value);
    if (!label || !(mins > 0)) return toast("Give the clock a name and a time.", "error");
    send({ t: "clockStart", label, seconds: Math.round(mins * 60) });
    $("clockLabel").value = "";
  };
  $("clockLabel").addEventListener("keydown", (e) => { if (e.key === "Enter") $("clockStart").click(); });
  $("clockList").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.clock) send({ t: "clockStop", id: b.dataset.clock });
    else if (b.dataset.clockPause) send({ t: "clockPause", id: b.dataset.clockPause, pause: !!b.dataset.pause });
    else if (b.dataset.clockShift) send({ t: "clockShift", id: b.dataset.clockShift, seconds: Number(b.dataset.seconds) });
  });

  $("sttKeySave").onclick = () => {
    const k = $("sttKey").value.trim();
    if (!k) return;
    send({ t: "sttKey", key: k });
    if ($("sttRemember").checked) store.set("wardenKey:groq", k);
    $("sttKey").value = "";
  };
  $("sttRemember").onchange = (e) => {
    if (!e.target.checked) store.del("wardenKey:groq");
    else if ($("sttKey").value.trim()) store.set("wardenKey:groq", $("sttKey").value.trim());
    else { e.target.checked = false; toast("Paste the Groq key first.", "info"); }
  };
  $("discordStop").onclick = () => send({ t: "discordStop" });
  $("discordCopy").onclick = copyDiscordCommand;
  $("discordCmd").onfocus = (e) => e.target.select();
  $("keyBtn").onclick = openKeyDialog;
  $("keywarn").onclick = openKeyDialog;
  for (const [button, dialog] of [["portraitClose", "portraitDialog"], ["builderClose", "builderDialog"], ["campaignClose", "campaignDialog"], ["synClose", "synopsisDialog"], ["mapClose", "mapDialog"], ["roomClose", "roomDialog"], ["settingsClose", "settingsDialog"]]) $(button).onclick = () => $(dialog).close();
  $("sessionCode").onclick = () => copy(playerLink(), "Player link");
  $("copyPlayer").onclick = () => copy(playerLink(), "Player link");
  $("copyWarden").onclick = async () => (await sure("Copy the Warden link?", "Anyone with it can run your session.", "Copy link", "primary")) && copy(wardenLink(), "Warden link");
  $("copyStream").onclick = () => S?.streamKey && copy(streamLink(), "Stream link");
  $("allSessions").onclick = () => { location.href = "dm"; };
  $("endSession").onclick = async () => {
    if (!(await sure(`End session ${code}?`, "Deletes the log, voices and settings, and disconnects players.", "End session"))) return;
    send({ t: "endSession" });
  };

  if (code && key) {
    $("sessionCode").textContent = code;
    $("codeInline").textContent = code;
    $("playerUrl").textContent = playerLink();
    document.title = `Warden · ${code}`;
    connect();
  } else {
    showStart(code ? `Not the Warden for ${code}. Use its Warden link.` : "");
  }
})();
