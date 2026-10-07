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
        const groq = S.discord?.enabled && !S.discord.sttKey && store.get("wardenKey:groq");
        if (groq && !autoSttSent) { autoSttSent = true; send({ t: "sttKey", key: groq }); }
      } else if (msg.t === "toast") toast(msg.text, msg.level);
      else if (msg.t === "handoutWriting") handoutWriting(msg.busy);
      else if (msg.t === "handoutDraft") {
        $("docTitle").value = msg.title;
        $("docText").value = msg.text;
        $("docText").rows = Math.min(14, Math.max(4, msg.text.split("\n").length + 1));
        toast("Handout written: read it over, then hand it out.");
      }
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

  let FREE_NOTE = "";
  async function showStart(error = "") {
    FREE_NOTE ||= $("newFreeNote").textContent;
    document.body.classList.add("starting");
    $("start").hidden = false;
    $("startErr").textContent = error;
    const provs = await loadProviders();
    const sel = $("newProvider");
    sel.innerHTML = provs.map((p) => `<option value="${esc(p.id)}">${esc(p.label)} · ${p.free ? "no key needed, rate-limited" : p.localKey ? "this computer's key" : `cheapest: ${esc(p.models[0].label)}`}</option>`).join("");
    // On this computer with a key in .env: that provider first, nothing to paste.
    const local = provs.find((p) => p.localKey);
    if (local) sel.value = local.id;
    const syncProv = () => {
      const p = provs.find((x) => x.id === sel.value);
      // The free provider runs on the server's key, and on this computer a provider
      // with a key in .env uses that: no key field either way.
      const free = !!p?.free || !!p?.localKey;
      $("newKeyFields").hidden = free;
      $("newKey").required = !free;
      $("newFreeNote").hidden = !free;
      $("newFreeNote").textContent = p?.localKey ? `Running on this computer: this game uses the ${p.label} key in your .env file, so there's nothing to paste.` : FREE_NOTE;
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
    if (c && await sure(`Forget session ${c}?`, "It keeps running on the server; you'd need its Warden link to get back in on this device.", "Forget")) {
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
      $("startErr").textContent = "That isn't a Warden link. It looks like …/dm?s=CODE#token=…";
    }
  });

  // ------------------------------------------------------------ API key dialog
  function openKeyDialog() {
    const sel = $("keyProvider");
    // The free provider takes no key, so it isn't listed here.
    const keyed = S.providers.filter((p) => !p.free);
    sel.innerHTML = keyed.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}${p.configured ? " ✓" : ""}</option>`).join("");
    sel.value = keyed.some((p) => p.id === S.config.provider) ? S.config.provider : keyed[0].id;
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
  // The panic table (Rules tab), for reference.
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
    renderSounds();
    renderClocks();
    renderHandouts();
    renderCastLists();
    renderMap();
    renderCrew();
    renderCast();
    renderAdversaries();
    renderTerminals();
    renderTerminalsPlay();
    renderConnections();
    renderCastPlay();
    renderBuilder();
    renderSynopsis();
    renderRoom();
    renderMnavDot();
    renderDiscord();
    renderDiscordButton();
    renderVoicesOn();
    $("retcon").disabled = !S.canRetcon;
    $("retcon").textContent = S.canRetcon > 1 ? `↶ Retcon last response (${S.canRetcon})` : "↶ Retcon last response";
  }

  // Discord's logo (Simple Icons, CC0), in the text colour.
  const DISCORD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>';
  // Discord is ready when the server has the bot and this session has a Groq key.
  const discordReady = () => !!(S?.discord?.enabled && S.discord.sttKey);

  // With Discord ready, Listen becomes the Discord button: it copies the /terminal listen
  // command (with the session's code), and pulses while the bot is listening; then a
  // click stops it (the bot leaves the channel).
  let micMode = "", micTitle = null;
  function renderDiscordButton() {
    const d = S.discord || {}, btn = $("micBtn"), on = discordReady();
    micTitle ??= btn.title;
    if (on && listening) setListening(false); // (Discord does the listening now)
    const mode = on ? `discord|${d.listening ? `${d.listening.channel}|${d.listening.guild}` : ""}` : "mic";
    if (mode !== micMode) {
      micMode = mode;
      btn.classList.toggle("discord", on);
      if (on) {
        btn.innerHTML = DISCORD_ICON;
        btn.setAttribute("aria-label", d.listening ? "Discord: listening. Stop it" : "Discord: copy the listen command");
        btn.setAttribute("aria-pressed", String(!!d.listening));
        btn.title = d.listening
          ? `Listening on Discord in ${d.listening.channel} (${d.listening.guild}): what's said there goes into the log. Click to stop it and disconnect the bot.`
          : "Discord: click to copy the /terminal listen command, then paste it into your voice channel's chat to start listening.";
      } else {
        btn.removeAttribute("aria-label");
        btn.title = micTitle;
        btn.textContent = listening ? "Listening" : "Listen";
        btn.setAttribute("aria-pressed", String(listening));
      }
    }
  }
  // The command that brings the bot into a voice channel: the session's own code.
  const listenCommand = () => `/terminal listen code:${code}`;
  function copyDiscordCommand() {
    const cmd = listenCommand();
    navigator.clipboard.writeText(cmd).then(() => toast("Copied. Paste it into your Discord voice channel's chat and send it."), () => copy(cmd, "Command"));
  }

  // Discord (Settings): the Groq key, and the bot's link to a voice channel.
  function renderDiscord() {
    const d = S.discord || {};
    $("discordOff").hidden = !!d.enabled;
    $("discordOn").hidden = !d.enabled;
    if (!d.enabled) return;
    $("sttKey").placeholder = d.sttKey ? "A Groq key is set (paste another to replace it)" : "Groq API key (gsk_…)";
    $("sttRemember").checked = !!store.get("wardenKey:groq");
    $("discordInvite").href = d.invite || "#";
    $("discordInvite").hidden = !d.invite;
    $("discordState").textContent = d.listening
      ? `Listening in ${d.listening.channel} (${d.listening.guild}).${d.sttKey ? "" : " Add a Groq key, or nothing is written down."}`
      : "Not listening.";
    $("discordStop").hidden = !d.listening;
    // Who's who (Discord /player).
    const roster = [d.listening?.warden && ["Warden", d.listening.warden], ...(d.players || []).map((p) => [p.as, p.name])].filter(Boolean);
    $("discordRoster").innerHTML = roster.map(([as, name]) => `<li><b>${esc(as)}</b>: ${esc(name)}</li>`).join("") || '<li class="muted">Nobody yet.</li>';
    $("discordCode").hidden = !!d.listening;
    $("discordCmd").value = listenCommand();
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
    $("keywarn").textContent = "No LLM key: add one";
  }

  let lastLogLen = -1;
  // A log entry's speaker label, who sent it (you or the agent) and its colour.
  // Null for Warden notes.
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

  // Per-player versions of a line: "↳ MOLL-7 (Android): ..."
  const crewName = (id) => S.config.crew.find((c) => c.id === id)?.name || id;
  const variantsHtml = (e) => (e.variants || []).map((v) =>
    `<div class="var"><span class="vfor">↳ ${esc(v.to.map(crewName).join(", "))}${v.for && !v.to.some((id) => crewName(id).toLowerCase() === v.for.toLowerCase()) ? ` (${esc(v.for)})` : ""}</span>\n${esc(v.text)}</div>`).join("");

  // A log entry's system (its net key, as in terminals.js netOf) by the name its terminals give it.
  const netKey = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const systemName = (net) => (net === "*" ? "All" : S.config.terminals.find((t) => t.system && netKey(t.system) === net)?.system || net);

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
      <div class="entry ${e.kind} ${e.hidden ? "hidden-on-player" : ""} ${e.cut ? "cut" : ""}" style="--c: ${sp.c}" ${e.cut ? `title="${e.retcon ? "Retconned: gone from the players' screens and the agent's memory." : "Cut off by a player before it was said: the players never saw it and the agent doesn't remember it."}"` : ""}>
        <div class="who"><span class="tag">${esc(sp.name)}</span>${sp.by ? `<span class="by">${sp.by}</span>` : ""}${e.net ? `<span class="by" title="${e.net === "*" ? "Sent to every system's screens" : "Said on a separate system: only screens there show it"}">${e.net === "*" ? "to All" : `on ${esc(systemName(e.net))}`}</span>` : ""}${e.hidden ? '<span class="by">cleared from screen</span>' : ""}${e.cut ? `<span class="by">${e.retcon ? "retconned" : "never said (cut off)"}</span>` : ""}${when}</div>
        <div class="txt">${e.text ? esc(e.text) : e.variants?.length ? '<span class="muted">(everyone else sees nothing)</span>' : ""}${variantsHtml(e)}${e.kind === "aside_reply" && e.changes?.length ? `<div class="chg">${e.changes.map((c) => `${esc(c.path)} → ${esc(c.value)}`).join(" · ")}</div>` : ""}</div>${del}
      </div>`;
    }).join("") || `<div class="muted small">Nothing yet. Waiting for the crew to type something…</div>`;
    if (atBottom || S.log.length !== lastLogLen) log.scrollTop = log.scrollHeight;
    lastLogLen = S.log.length;
  }

  // Does the session have a key for its model? (Without one the agent stays quiet.)
  const hasKey = () => !!S.providers?.find((p) => p.id === S.config.provider)?.configured;

  function renderPending() {
    const p = S.pending;
    const card = $("pending");
    const k = p ? `${p.status}|${p.forEntry}|${JSON.stringify(p.reply || p.error || "")}` : `none|${hasKey()}`;
    $("noKeyNote").hidden = hasKey();
    if (k === pendingKey) return;
    pendingKey = k;
    card.hidden = !p; // (nothing pending: out of the way)
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
      <div class="label">Draft reply <span class="muted">(edit freely · change who says each line · Ctrl+Enter sends)</span></div>
      <div id="draftLines">${(r.lines.length ? r.lines : [{ voice: "terminal", text: "" }]).map(draftLine).join("")}</div>
      <div class="row"><button data-act="addLine" class="ghost">+ Line</button></div>
      ${p.directives?.length ? `<div class="note">⚑ Following your command${p.directives.length > 1 ? "s" : ""}: ${p.directives.map(esc).join(" · ")}</div>` : ""}
      ${r.crew_changes?.length ? `<div class="label">Crew condition</div><ul>${r.crew_changes.map((c, i) =>
        `<li><label><input type="checkbox" data-crw="${i}" ${S.config.agentCrew !== false ? "checked" : ""}> ${esc(c.for)}: ${esc(c.stat)} ${c.change > 0 ? "+" : ""}${c.change}${c.why ? ` <span class="muted">(${esc(c.why)})</span>` : ""}</label></li>`).join("")}</ul>` : ""}
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
  // The story's systems by name, station first (one entry: no separate systems).
  const systemNames = () => [...new Set([S.config.stationName, ...S.config.terminals.filter((t) => t.system).map((t) => t.system)])];
  // Which system's screens a draft line goes to (the agent's pick; the Warden can change it).
  const sysSelect = (system) => {
    const names = systemNames();
    if (names.length < 2) return "";
    const want = netKey(system);
    const sel = want === "all" ? "ALL" : names.find((n) => netKey(n) === want) || "";
    const opts = [["", "(where they are)"], ...names.map((n) => [n, n]), ["ALL", "to All"]];
    return `<select class="dsys" aria-label="System" title="Which system's screens show this line">${opts.map(([v, label]) => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(label)}</option>`).join("")}</select>`;
  };

  // One editable line of a draft: who says it, and what.
  // A line's effects fire as it begins (between lines of dialogue); untick to drop one.
  const draftLine = (l) => `
    <div class="dline" data-effects="${esc(JSON.stringify(l.effects || []))}">
      <div class="dwho">
        <select aria-label="Voice">${S.config.voices.map((v) => `<option value="${esc(v.id)}" ${v.id === l.voice ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select>
        ${sysSelect(l.system)}
        <input class="dchar" list="castNames" value="${esc(l.character || "")}" placeholder="who" aria-label="Character" title="Which character says it: face to face if they're in a room with players, else over the intercom" ${l.voice === S.config.castChannel || l.character ? "" : "hidden"}>
      </div>
      <textarea rows="${Math.min(12, Math.max(2, l.text.split("\n").length))}" placeholder="${l.effects?.length ? "(effect only: no text)" : ""}">${esc(l.text)}</textarea>
      <button data-act="delLine" class="ghost" title="Remove line">✕</button>
      <div class="dvars">${(l.variants || []).map(variantRow).join("")}
        <button data-act="addVar" class="ghost small" title="A different version of this line for one player, or a class (e.g. Android, Humans)">+ Variant for a player</button></div>
      ${l.effects?.length ? `<div class="dfx">${l.effects.map((f, i) => `<label class="chip"><input type="checkbox" data-leff="${i}" ${S.config.agentEffects ? "checked" : ""}> ⚡ ${FX_META[f.type]?.[0] || ""} ${esc(f.type)}${f.text ? ` "${esc(f.text)}"` : ""} · ${f.seconds || "∞"}s <span class="muted">as this line starts</span></label>`).join("")}</div>` : ""}
    </div>`;
  const variantRow = (v) => `<div class="dvar">
      <input class="dvfor" list="variantTargets" value="${esc(v.for)}" placeholder="for: name, Android, Humans…" aria-label="Variant for">
      <textarea class="dvtext" rows="${Math.min(8, Math.max(1, v.text.split("\n").length))}" aria-label="Their version">${esc(v.text)}</textarea>
      <button data-act="delVar" class="ghost" title="Remove variant">✕</button></div>`;
  // Name suggestions: the characters (a draft line's speaker), and who a variant can be for.
  function renderCastLists() {
    // Who a variant can be for: each crew member, their classes, and Humans.
    const targets = [...S.config.crew.map((c) => c.name), ...new Set(S.config.crew.map((c) => c.className)), "Humans"];
    $("castLists").innerHTML = `<datalist id="variantTargets">${targets.map((t) => `<option value="${esc(t)}">`).join("")}</datalist>` +
      `<datalist id="castNames">${(S.config.cast || []).map((c) => `<option value="${esc(c.name)}">`).join("")}</datalist>`;
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

  // ------------------------------------------------------------ crew (player characters)
  const CREW_CLASSES = ["Teamster", "Android", "Scientist", "Marine"];
  let crewDraft = null, crewTimer = null, crewSentAt = 0;

  function renderCrew(fromDraft = false) {
    const panel = $("crew");
    if (!fromDraft) {
      const editing = panel.contains(document.activeElement) || crewTimer !== null || Date.now() - crewSentAt < 1500;
      const json = JSON.stringify([S.config.crew, S.claims, S.screens, S.config.terminals.map((t) => t.name), discordReady() && S.discord.players]);
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
      const onDiscord = discordReady() && S.discord.players?.find((p) => p.crew === c.id); // (who plays them on Discord)
      return `<details class="pc" data-i="${i}">
        <summary><button class="pick small" data-pcpic="${i}" title="${c.portrait ? "Change their picture" : "Add a picture: shown on their crew file and beside what they type"}" aria-label="Picture of ${esc(c.name)}">${c.portrait ? `<img src="${esc(portraitUrl(c.portrait))}" alt="">` : `<span>${esc(initials(c.name) || "+")}</span>`}</button>${c.portrait ? `<button class="ghost small edit-only" data-pcnopic="${i}" title="Remove their picture">✕ picture</button>` : ""}<span class="pcname ${playing ? "online" : "offline"}" title="${playing ? `Connected: playing on ${playing} screen${playing > 1 ? "s" : ""}` : "Not connected: no player has picked them"}">${esc(c.name || "Unnamed")}</span>${onDiscord ? `<span class="dlogo" title="Played on Discord by ${esc(onDiscord.name)}" aria-label="On Discord: ${esc(onDiscord.name)}">${DISCORD_ICON}</span>` : ""}
          <span class="muted small">${esc(c.className)} · Stress ${c.stress} · HP ${c.health.current}/${c.health.max}</span>
          ${playing ? `<span class="muted small where">at <select data-move="${esc(c.id)}" title="Move their screens to another terminal" aria-label="Move ${esc(c.name)} to">${
            (whereIs(c.id) ? "" : '<option value="" selected>(no terminal yet)</option>') + S.config.terminals.map((t) =>
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
          ${num("stress", c.stress, "Stress")}${num("startStress", c.startStress, "Starting stress")}
          ${txt("skills", c.skills.join(", "), "Skills (comma-separated)")}
          ${txt("crime", c.crime, "Conviction", 2)}
          ${txt("backstory", c.backstory, "Backstory", 4)}
          ${txt("loadout", c.loadout, "Starting loadout", 2)}
          ${txt("items", c.items.join(", "), "Items they carry now (comma-separated)")}
          ${txt("trinket", c.trinket, "Trinket")}
          ${txt("patch", c.patch, "Patch")}
          ${txt("notes", c.notes, "Warden notes (the agent reads these; players don't see them)", 2)}
        </div>
        <div class="row edit-only"><span class="grow"></span><button data-cact="del" class="danger">Remove character</button></div>
      </details>`;
    }).join("") || `<p class="muted small">No player characters. Add some, or build a story.</p>`;
    // Keep open whichever cards were open.
    for (const i of openCrew) panel.querySelector(`.pc[data-i="${i}"]`)?.setAttribute("open", "");
    $("addCrew").disabled = crewDraft.length >= 4;
  }
  // ------------------------------------------------------------ characters (the story's people)
  // Each has a portrait, a human voice, notes for the agent and the room they're in:
  // in a room with players they talk face to face, anywhere else over the intercom.
  // The room is set in read-only too (it changes in play).
  let castDraft = null, castTimer = null, castSentAt = 0;
  // How a character feels about the players (cast.js ATTITUDES).
  const ATTITUDES = [[-3, "Hostile"], [-2, "Resentful"], [-1, "Wary"], [0, "Neutral"], [1, "Friendly"], [2, "Trusting"], [3, "Loyal"]];
  const portraitUrl = (file) => (file.startsWith("kit/") ? `portraits/${file.slice(4)}` : `api/sessions/${code}/portraits/${file}`);
  const initials = (name) => { const w = name.split(/\s+/).filter(Boolean); return ((w[0]?.[0] || "") + (w.length > 1 ? w.at(-1)[0] : "")).toUpperCase(); };
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
        <button class="pick" data-mact="pic" title="${m.portrait ? "Change their picture" : "Add a picture: shown beside what they say"}" aria-label="Picture of ${esc(m.name)}">${m.portrait ? `<img src="${esc(portraitUrl(m.portrait))}" alt="">` : `<span>${esc(initials(m.name) || "+")}</span>`}</button>
        <div class="castbody">
          <div class="row wrap">
            <input data-m="name" class="edit-only cname" value="${esc(m.name)}" placeholder="Name" aria-label="Name">
            <b class="play-only">${esc(m.name)}</b>
            <label class="small muted where">in <select data-m="room" aria-label="Where ${esc(m.name)} is"><option value="">nowhere on the map</option>${
              [...rooms].map(([id, label]) => `<option value="${esc(id)}" ${id === m.room ? "selected" : ""}>${esc(label)}</option>`).join("")}${
              m.room && !rooms.has(m.room) ? `<option value="${esc(m.room)}" selected>${esc(m.room)}</option>` : ""}</select></label>
            <label class="small muted mood" title="How they feel about the players. The agent plays them by it and moves it as they earn or lose their trust; you can set it too. Players never see it.">feels <select data-m="attitude" data-num aria-label="How ${esc(m.name)} feels about the players" class="att${m.attitude > 0 ? " up" : m.attitude < 0 ? " down" : ""}">${
              ATTITUDES.map(([n, label]) => `<option value="${n}" ${n === (m.attitude || 0) ? "selected" : ""}>${label} (${n > 0 ? "+" : ""}${n})</option>`).join("")}</select></label>
            <label class="small muted stress" title="Their Stress (0-20). The agent raises it when frightening things happen to them; a Panic check is a d20 at or under it.">Stress <input type="number" data-m="stress" data-num min="0" max="20" value="${m.stress ?? 2}" aria-label="${esc(m.name)}'s Stress"></label>
            <button data-mact="panic" class="small" title="Roll a Panic check for them now, in front of the players: a d20 at or under their Stress and they panic (from shaking hands up to a heart attack). The agent plays it out.">Panic check</button>
            ${withPlayers.has(m.room) ? '<span class="pill ok" title="In a room with players: they talk face to face, and only screens in that room show it">in person</span>' : '<span class="pill" title="Not in a room with any players: heard over the intercom">intercom</span>'}
          </div>
          <div class="row wrap edit-only small">
            <select data-m="voice" aria-label="Their voice"><option value="">(a voice of their own)</option>${speakers.map(([id, label]) => `<option value="${id}" ${id === m.voice ? "selected" : ""}>${esc(label)}</option>`).join("")}</select>
            <button data-mact="test" title="Hear them (on this computer only)">▶</button>
            ${m.portrait ? '<button data-mact="nopic" class="ghost">Remove picture</button>' : ""}
            <span class="grow"></span><button data-mact="del" class="ghost" title="Remove ${esc(m.name)}">✕</button>
          </div>
          <input data-m="why" class="why" value="${esc(m.why || "")}" placeholder="Why they feel that way (the agent keeps this up to date)" aria-label="Why ${esc(m.name)} feels that way">
          <textarea data-m="notes" class="edit-only" rows="2" placeholder="Who they are, what they want, how they talk (the agent reads this)" aria-label="Notes">${esc(m.notes)}</textarea>
          ${m.notes ? `<div class="play-only small muted">${esc(m.notes)}</div>` : ""}
        </div>
      </div>`).join("") || `<p class="muted small">Nobody yet. The agent brings people in as the story needs them; you can add them here.</p>`;
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
  let picFor = null; // { cast: i } or { crew: i }: whose picture is being picked
  $("cast").addEventListener("click", async (e) => {
    const act = e.target.closest("[data-mact]")?.dataset.mact;
    const card = e.target.closest(".castm");
    if (!act || !card) return;
    const i = Number(card.dataset.i), m = castDraft[i];
    if (act === "pic") openPortraits({ cast: i });
    else if (act === "nopic") { m.portrait = ""; saveCast(true); renderCast(true); }
    else if (act === "panic") send({ t: "castPanic", id: m.id });
    else if (act === "test") Voice.test({ name: "test", voice: { engine: "neural", speaker: m.voice || "am_michael", pace: 1 }, fx: {} }, $("testText").value || "Testing.", `api/sessions/${code}/tts-test`, key);
    else if (act === "del") {
      if (!(await sure(`Remove ${m.name || "this character"}?`, "They leave the story: the agent no longer knows them.", "Remove"))) return;
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
  // Whose picture is being picked, and setting it (an upload's file, a pack one's "kit/…", or "").
  const picTarget = () => (picFor?.crew !== undefined ? crewDraft[picFor.crew] : castDraft[picFor?.cast]);
  function setPortrait(file) {
    const m = picTarget();
    if (!m) return;
    m.portrait = file;
    if (picFor.crew !== undefined) { saveCrew(); renderCrew(true); }
    else { saveCast(true); renderCast(true); }
    $("portraitDialog").close();
  }
  // The picker: the pack's portraits (public/portraits/pack.json), or upload your own.
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
  $("portraitClose").onclick = () => $("portraitDialog").close();

  // A picture of their own: cropped to a small square here, then uploaded.
  $("portraitFile").addEventListener("change", async () => {
    const file = $("portraitFile").files[0];
    if (!file || !picTarget()) return;
    try {
      const img = await createImageBitmap(file);
      const side = Math.min(img.width, img.height), SIZE = 128;
      const cv = Object.assign(document.createElement("canvas"), { width: SIZE, height: SIZE });
      const g = cv.getContext("2d");
      g.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
      // Like the pack's: white, with the dark of the picture as how opaque it is (the
      // players' screens draw it in their colour, the light parts see-through).
      const px = g.getImageData(0, 0, SIZE, SIZE), d = px.data;
      for (let i = 0; i < d.length; i += 4) {
        const light = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        d[i + 3] = Math.min(255, Math.round((255 - light) * 1.15 * (d[i + 3] / 255)));
        d[i] = d[i + 1] = d[i + 2] = 255;
      }
      g.putImageData(px, 0, 0);
      const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
      const r = await fetch(`api/sessions/${code}/portraits`, { method: "POST", headers: { "X-Warden-Token": key, "Content-Type": "application/octet-stream" }, body: blob });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || `Upload failed (${r.status}).`);
      setPortrait(out.file);
    } catch (err) {
      toast(err.message || "That picture couldn't be used.", "error");
    }
  });

  // ------------------------------------------------------------ adversaries
  // The threats: voices with an adversary part. "???" to the players until they've
  // seen one (the agent reveals it then; or tick Revealed); a picture to show them.
  let advTimer = null, advFor = null;
  // A picture: an upload, or a link to one on the web.
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
        <button class="pick big" data-aact="pic" title="${v.adversary.picture ? "Change its picture" : "Add a picture you can show the players"}" aria-label="Picture of ${esc(v.name)}">${v.adversary.picture ? `<img src="${esc(advSrc(v.adversary.picture))}" alt="" referrerpolicy="no-referrer">` : "<span>+</span>"}</button>
        <div class="castbody">
          <div class="row wrap">
            <input data-a="name" class="edit-only cname" value="${esc(v.name)}" aria-label="Its name">
            <b class="play-only" style="color: ${esc(v.color || "inherit")}">${esc(v.name)}</b>
            <label class="small check" title="Have the players seen it? Until then its lines show as ??? and nobody names it. The agent ticks this when they see it.">
              <input type="checkbox" data-a="revealed" ${v.adversary.revealed ? "checked" : ""}> revealed</label>
            <span class="pill ${v.adversary.revealed ? "ok" : ""}">${v.adversary.revealed ? "players see its name" : "players see ???"}</span>
            ${v.adversary.picture ? `<button data-aact="show" class="small" title="Put its picture on every player's screen (seeing it reveals it)">Show players</button>` : ""}
          </div>
          <div class="row wrap edit-only small">
            <select data-a="preset" aria-label="How it sounds">${presets.map((p) => `<option ${p === v.preset ? "selected" : ""}>${p}</option>`).join("")}${v.preset === "custom" ? '<option selected value="custom">custom (Story tab)</option>' : ""}</select>
            <button data-aact="test" title="Hear it (on this computer only)">▶</button>
            <input type="color" data-a="color" value="${esc(v.color || "#ff5a5a")}" aria-label="Its colour">
            ${v.adversary.picture ? '<button data-aact="nopic" class="ghost">Remove picture</button>' : ""}
            <span class="grow"></span><button data-aact="del" class="ghost" title="Remove ${esc(v.name)}">✕</button>
          </div>
          <input data-a="picture" class="edit-only why" value="${esc(/^https:\/\//.test(v.adversary.picture) ? v.adversary.picture : "")}" placeholder="Or a link to a picture on the web (https://…): it loads from there" aria-label="Picture link">
          ${v.adversary.picture ? `<input data-a="credit" class="edit-only why" value="${esc(v.adversary.credit || "")}" placeholder="Picture credit, if you want one: the artist, a link (shown with it)" aria-label="Picture credit">` : ""}
          <textarea data-a="persona" class="edit-only" rows="3" aria-label="What it is" placeholder="What it is, what it wants, how it acts and speaks (the agent reads this)">${esc(v.persona)}</textarea>
          <div class="play-only small muted">${esc(v.persona.slice(0, 220))}${v.persona.length > 220 ? "…" : ""}</div>
        </div>
      </div>`).join("") || '<p class="muted small">No adversaries. Add the story\'s threats here.</p>';
  }
  const advPatch = (id, patch) => send({ t: "adversary", id, patch });
  $("adversaries").addEventListener("input", (e) => {
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
    else if (act === "test") Voice.test(v, $("testText").value || "i can hear you.", `api/sessions/${code}/tts-test`, key);
    else if (act === "del" && (await sure(`Remove ${v.name}?`, "The adversary and its voice are removed from the story.", "Remove"))) send({ t: "adversaryDel", id });
  });
  $("addAdversary").onclick = () => send({ t: "adversaryAdd" });
  // Its picture: kept as a picture (not line art), shrunk to fit, then uploaded.
  $("advFile").addEventListener("change", async () => {
    const file = $("advFile").files[0];
    if (!file || !advFor) return;
    try {
      const img = await createImageBitmap(file);
      const scale = Math.min(1, 720 / Math.max(img.width, img.height));
      const cv = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      const blob = await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.82));
      const r = await fetch(`api/sessions/${code}/portraits`, { method: "POST", headers: { "X-Warden-Token": key, "Content-Type": "application/octet-stream" }, body: blob });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || `Upload failed (${r.status}).`);
      advPatch(advFor, { picture: out.file });
    } catch (err) {
      toast(err.message || "That picture couldn't be used.", "error");
    }
  });

  // Read-only: what a character can do at a glance. Health, Wounds and Stress
  // stay adjustable (they change in play); the rest is edited with the padlock unlocked.
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
        <label>Stress <input type="number" data-c="stress" value="${c.stress}" min="0" max="99"></label>
      </div>
      ${line("Skills", c.skills.join(", "))}${itemsLine(c)}${line("Trinket", c.trinket)}${line("Patch", c.patch)}${line("Notes", c.notes)}
    </div>`;
  }
  // What they carry: changes in play, so it's editable in read-only too (✕ drops one; type to add).
  const itemsLine = (c) => `<div class="items"><span class="k">Items:</span> ${c.items.map((x, j) => `<span class="chip">${esc(x)}<button data-item-del="${j}" title="Drop it" aria-label="Drop ${esc(x)}">✕</button></span>`).join("")}<input data-item-add placeholder="+ add" aria-label="Add an item" size="10"></div>`;
  const openCrew = new Set();
  const whereIs = (crewId) => {
    const id = S.screens?.find((s) => s.characterId === crewId)?.terminal;
    return S.config.terminals.find((t) => t.id === id)?.name || "";
  };
  // A crew member's picture (the same picker and upload as the characters').
  $("crew").addEventListener("click", (e) => {
    const pic = e.target.closest("[data-pcpic]"), off = e.target.closest("[data-pcnopic]");
    if (!pic && !off) return;
    e.preventDefault(); // (it's in the card's header: don't open or close the card)
    if (off) { crewDraft[Number(off.dataset.pcnopic)].portrait = ""; saveCrew(); renderCrew(true); return; }
    openPortraits({ crew: Number(pic.dataset.pcpic) });
  });
  $("crew").addEventListener("change", (e) => {
    const who = e.target.dataset.move;
    if (who && e.target.value) { send({ t: "moveScreens", character: who, terminal: e.target.value }); e.target.blur(); }
  });
  // The where-they-are picker sits in the card's header: using it doesn't open or close the card.
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
      setTimeout(() => S && renderCrew(), 1600); // (the headers catch up once the edit settles)
    }, 500);
  }
  $("crew").addEventListener("focusout", () => setTimeout(() => S && renderCrew(), 1600));
  $("crew").addEventListener("input", (e) => {
    const card = e.target.closest(".pc");
    const key = e.target.dataset.c;
    if (!card || !key) return;
    const c = crewDraft[Number(card.dataset.i)];
    const [a, b] = key.split(".");
    const val = e.target.type === "number" ? Number(e.target.value) : key === "skills" || key === "items" ? e.target.value.split(",").map((x) => x.trim()).filter(Boolean) : e.target.value;
    if (b) c[a][b] = val;
    else c[a] = val;
    saveCrew();
  });
  $("crew").addEventListener("click", (e) => {
    const del = e.target.closest("[data-item-del]")?.dataset.itemDel;
    if (del === undefined) return;
    crewDraft[Number(e.target.closest(".pc").dataset.i)].items.splice(Number(del), 1);
    crewSentAt = 0;
    send({ t: "crew", crew: crewDraft });
  });
  $("crew").addEventListener("keydown", (e) => {
    if (!e.target.matches("[data-item-add]") || e.key !== "Enter" || !e.target.value.trim()) return;
    crewDraft[Number(e.target.closest(".pc").dataset.i)].items.push(e.target.value.trim());
    e.target.value = "";
    e.target.blur();
    crewSentAt = 0;
    send({ t: "crew", crew: crewDraft });
  });
  $("crew").addEventListener("click", async (e) => {
    if (e.target.closest("[data-cact]")?.dataset.cact !== "del") return;
    const i = Number(e.target.closest(".pc").dataset.i);
    if (!(await sure(`Remove ${crewDraft[i].name || "this character"}?`, "Their crew file is deleted; a player using it goes back to choosing.", "Remove"))) return;
    crewDraft.splice(i, 1);
    openCrew.clear();
    send({ t: "crew", crew: crewDraft });
    crewSentAt = 0;
  });
  $("addCrew").onclick = () => {
    if (crewDraft.length >= 4) return;
    crewDraft.push({
      name: "New convict", pronouns: "", className: "Teamster", role: "", crime: "", backstory: "",
      stats: { strength: 30, speed: 30, intellect: 30, combat: 30 }, saves: { sanity: 25, fear: 25, body: 25 },
      health: { current: 12, max: 12 }, wounds: { current: 0, max: 2 }, stress: 2, skills: [], loadout: "", items: [], trinket: "", patch: "", notes: "",
    });
    openCrew.add(String(crewDraft.length - 1));
    send({ t: "crew", crew: crewDraft });
    crewSentAt = 0;
  };

  // ------------------------------------------------------------ story builder
  let builderKey = "";
  function renderBuilder() {
    if (!$("builderDialog").open) return;
    const b = S.builder, busy = S.builderBusy;
    const key = JSON.stringify([b, busy]);
    if (key === builderKey) return;
    builderKey = key;
    const msgs = $("bmsgs");
    const intro = `<div class="bmsg agent"><b>Agent</b><div>Let's build a new scenario. Tell me what you have in mind (a place, a monster, a twist, who the players are), or just say "surprise me". I'll ask questions; when it's ready, press <b>Draft it</b>.</div></div>`;
    msgs.innerHTML = intro + b.messages.map((m) => `<div class="bmsg ${m.role}${m.error ? " err" : ""}"><b>${m.role === "warden" ? "You" : "Agent"}</b><div>${esc(m.text)}</div></div>`).join("")
      + (busy ? `<div class="bmsg agent"><b>Agent</b><div><span class="spinner"></span>${busy === "draft" ? "Writing the whole scenario… (this can take a minute)" : "Thinking…"}</div></div>` : "");
    msgs.scrollTop = msgs.scrollHeight;
    for (const id of ["bSend", "bDraft", "bReset"]) $(id).disabled = !!busy;
    $("bDraft").classList.toggle("primary", !!b.messages.at(-1)?.ready);
    $("bDraft").textContent = b.draft ? "Redraft" : "Draft it";
    renderDraft(b.draft);
  }

  function renderDraft(d) {
    const el = $("bdraft");
    if (!d) { el.innerHTML = `<div class="muted bempty">The draft appears here: station, lore, secrets, cast, crew and map.</div>`; return; }
    const voices = d.voices.map((v) => `<div class="bcard"><b>${esc(v.name)}</b> <span class="muted small">${esc(v.preset)}</span>
        <div class="small">${esc(v.persona)}</div></div>`).join("");
    const cast = (d.cast || []).length ? `<ul class="small">${d.cast.map((c) => `<li><b>${esc(c.name)}</b> <span class="muted">${esc(S.voiceOptions.speakers[c.voice] || c.sex)} · ${esc(c.room || "nowhere on the map")}</span> · ${esc(c.notes)}</li>`).join("")}</ul>` : "";
    const crew = d.crew.map((c) => `<div class="bcard"><b>${esc(c.name)}</b> <span class="muted small">${esc([c.pronouns, c.className, c.role].filter(Boolean).join(" · "))}</span>
        <div class="small">${esc(c.crime)}</div><div class="small muted">${esc(c.backstory)}</div>
        <div class="small mono">${["strength", "speed", "intellect", "combat"].map((k) => `${k.slice(0, 3).toUpperCase()} ${c.stats?.[k]}`).join(" · ")} | ${["sanity", "fear", "body"].map((k) => `${k.slice(0, 3).toUpperCase()} ${c.saves?.[k]}`).join(" · ")} | HP ${c.health_max}</div>
        <div class="small muted">${esc((c.skills || []).join(", "))}</div></div>`).join("");
    el.innerHTML = `
      <div class="row"><div class="grow"><div class="btitle">${esc(d.title)}</div><div class="muted">${esc(d.stationName)} · ${esc(d.theme)} screen</div></div>
        <button id="bApply" class="primary">Apply to this session</button></div>
      <p>${esc(d.pitch)}</p>
      <details open><summary>Map</summary><div id="bmap" class="smap"></div></details>
      <details><summary>Lore <span class="muted">(public)</span></summary><pre class="bpre">${esc(d.lore)}</pre></details>
      <details><summary>Secrets</summary><pre class="bpre">${esc(d.secrets)}</pre></details>
      <details><summary>Computer: ${esc(d.computer.name)}</summary><pre class="bpre">${esc(d.computer.persona)}</pre>${d.standingOrders ? `<div class="small"><b>Standing orders:</b> ${esc(d.standingOrders)}</div>` : ""}</details>
      <details open><summary>Characters</summary>${cast || '<p class="muted">None.</p>'}</details>
      <details open><summary>Adversaries <span class="muted">(??? to the players until they see them)</span></summary>${(d.adversaries || []).map((a) => `<div class="bcard"><b>${esc(a.name)}</b> <span class="muted small">${esc(a.preset)}</span><div class="small">${esc(a.persona)}</div></div>`).join("") || '<p class="muted">None.</p>'}</details>
      <details><summary>Voices</summary>${voices || '<p class="muted">None.</p>'}</details>
      <details><summary>Terminals</summary><ul class="small">${(d.terminals || []).map((t) => `<li><b>${esc(t.name)}</b> <span class="muted">${esc(t.room)}${t.look?.length ? ` · ${esc(t.look.join(", "))}` : " · clean"}${t.open ? "" : " · not reachable at first"}</span> · ${esc(t.notes)}</li>`).join("")}<li class="muted">+ a portable handheld terminal</li></ul></details>
      <details open><summary>Player characters</summary>${crew || '<p class="muted">None.</p>'}</details>
      <details><summary>Starting documents <span class="muted">(in every player's DOCS)</span></summary>${(d.documents || []).map((x) => `<div class="small"><b>${esc(x.title)}</b></div><pre class="bpre">${esc(x.text)}</pre>`).join("") || '<p class="muted">None.</p>'}</details>`;
    // Preview the map from the draft's own state and layout.
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
  $("builderClose").onclick = () => $("builderDialog").close();
  const builderSend = () => {
    const text = $("bInput").value.trim();
    if (!text || S.builderBusy) return;
    send({ t: "builderSay", text });
    $("bInput").value = "";
  };
  $("bSend").onclick = builderSend;
  $("bInput").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); builderSend(); } });
  $("bDraft").onclick = () => send({ t: "builderDraft" });
  $("bReset").onclick = async () => (await sure("Start over?", "Clears the builder conversation and draft. Your current story isn't touched.", "Start over")) && send({ t: "builderReset" });
  $("bdraft").addEventListener("click", async (e) => {
    if (e.target.id !== "bApply") return;
    if (!(await sure(`Apply "${S.builder.draft.title}"?`, "Replaces the station, lore, secrets, voices, map and crew, and clears the log. Players stay connected and pick a new crew file. Your provider, key, mode and sounds stay.", "Apply story", "primary"))) return;
    send({ t: "builderApply" });
    $("builderDialog").close();
    toast("New story applied.");
  });

  // ------------------------------------------------------------ synopsis
  let synopsisKey = "";
  function renderSynopsis() {
    if (!$("synopsisDialog").open) return;
    const syn = S.synopsis, busy = S.synopsisBusy;
    // Entries since it was written (things said or typed, not console notes).
    const newer = syn ? S.log.filter((e) => e.id > syn.logId && e.kind !== "note").length : 0;
    const key = JSON.stringify([syn, busy, newer]);
    if (key === synopsisKey) return;
    synopsisKey = key;
    const when = syn && new Date(syn.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    $("synStatus").textContent = busy ? "" : !syn ? "" : `${syn.started ? "The story so far" : "Starting synopsis"} · written ${when}${newer ? ` · ${newer} new log ${newer === 1 ? "entry" : "entries"} since` : ""}`;
    $("synWrite").disabled = busy;
    $("synWrite").textContent = syn ? (newer ? "↻ Update to now" : "↻ Rewrite") : "↻ Write it";
    $("synWrite").classList.toggle("primary", !syn || newer > 0);
    $("synCopy").disabled = busy || !syn?.sections.some((x) => x.audience === "players");
    const body = $("synBody");
    if (busy) { body.innerHTML = `<div class="synempty"><span class="spinner"></span>${syn ? "Bringing the synopsis up to date with the comms so far…" : "Writing the synopsis…"}</div>`; return; }
    if (!syn) { body.innerHTML = `<div class="synempty muted">No synopsis yet. <b>Write it</b> has the agent brief the players on who they are, where they are, what they know and what they're here to do, with notes only you see on the story beats and next steps.</div>`; return; }
    body.innerHTML = syn.sections.map((x) => x.audience === "warden"
      ? `<section class="synsec warden"><div class="synlabel">For the Warden only</div><h3>${esc(x.heading)}</h3><div class="syntext">${esc(x.text)}</div></section>`
      : `<section class="synsec"><h3>${esc(x.heading)}</h3><div class="syntext">${esc(x.text)}</div></section>`).join("");
  }
  const writeSynopsis = () => { if (!S.synopsisBusy) send({ t: "synopsis" }); };
  $("synopsisBtn").onclick = () => {
    synopsisKey = "";
    $("synopsisDialog").showModal();
    if (!S.synopsis && !S.synopsisBusy) writeSynopsis(); // first time: write it straight away
    renderSynopsis();
  };
  $("synClose").onclick = () => $("synopsisDialog").close();
  $("synWrite").onclick = writeSynopsis;
  $("synCopy").onclick = async () => {
    const text = S.synopsis.sections.filter((x) => x.audience === "players").map((x) => `${x.heading.toUpperCase()}\n${x.text}`).join("\n\n");
    try { await navigator.clipboard.writeText(text); toast("Player sections copied (no Warden-only notes)."); }
    catch { toast("Couldn't copy: your browser blocked the clipboard.", "error"); }
  };

  // ------------------------------------------------------------ terminals
  const LOOKS = { blood: "Blood", goo: "Goo", crack: "Cracked", flicker: "Flicker", dim: "Dim", grime: "Grime", portable: "Handheld" };
  let termDraft = null, termTimer = null, termSentAt = 0;
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
    // Docked rooms (the crew's tug) aren't on a deck: listed by what they're docked to.
    const labelOf = (id) => decks.flatMap((d) => d.rooms).find((r) => r.id === id)?.label || id;
    const rooms = [...deckRooms, ...StationMap.parseDocked(S.config.map).map((r) => [r.id, `${r.label} (docked at ${labelOf(r.parent)})`])];
    panel.innerHTML = termDraft.map((t, i) => {
      const here = (S.screens || []).filter((s) => s.terminal === t.id).map((s) => s.character || "a screen");
      return `<div class="tcard" data-i="${i}">
        <div class="row"><input data-t="name" value="${esc(t.name)}" aria-label="Terminal name" class="tname">
          <label class="check small"><input type="checkbox" data-t="open" ${t.open ? "checked" : ""}> reachable</label>
          <button data-tact="del" class="ghost" title="Remove">✕</button></div>
        <div class="row wrap small">
          <label>Room <select data-t="room"><option value="">(none / portable)</option>${rooms.map(([id, label]) => `<option value="${esc(id)}" ${id === t.room ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
          <label title="A door in the station state: the terminal becomes reachable once it reads OPEN">Opens with <select data-t="requires"><option value="">(nothing)</option>${doorPaths().map((p) => `<option value="${esc(p)}" ${p === t.requires ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></label>
          <label>Colour <select data-t="theme">${["", "green", "amber", "cyan", "white", "red"].map((x) => `<option value="${x}" ${x === t.theme ? "selected" : ""}>${x || "station's"}</option>`).join("")}</select></label>
        </div>
        <div class="looks">${Object.entries(LOOKS).map(([k, label]) => `<label class="chip"><input type="checkbox" data-look="${k}" ${t.look.includes(k) ? "checked" : ""}> ${label}</label>`).join("")}</div>
        <div class="row wrap small">
          <label title="Blank: on the station's network. Terminals on another system (e.g. the crew's ship) keep their own log on the players' screens, and show this name instead of the station's.">System <input data-t="system" value="${esc(t.system || "")}" placeholder="the station's" size="14"></label>
          <label title="What the players' header calls its operating system. Blank: the station's.">OS <input data-t="os" value="${esc(t.os || "")}" placeholder="the station's" size="18"></label>
        </div>
        <input data-t="notes" value="${esc(t.notes)}" placeholder="What's here, what happened at it (the agent reads this)" aria-label="Notes">
        ${here.length ? `<div class="muted small">Here now: ${here.map(esc).join(", ")}</div>` : ""}
      </div>`;
    }).join("");
  }
  // Read-only terminals: where each is, whether the players can get to it, who's there.
  function roomLabels() {
    const decks = StationMap.parseLayout(S.config.map);
    const out = new Map(decks.flatMap((d) => d.rooms.map((r) => [r.id, r.label])));
    for (const r of StationMap.parseDocked(S.config.map)) out.set(r.id, `${r.label}, docked at ${out.get(r.parent) || r.parent}`);
    return out;
  }
  const reachableNow = (t) => {
    if (t.open) return true;
    if (!t.requires) return false;
    const v = t.requires.split(".").reduce((o, k) => o?.[k], S.station);
    return /^(OPEN|OPENED|UNLOCKED)$/i.test(String(v ?? "").trim());
  };
  function renderTerminalsPlay() {
    const panel = $("terminalsPlay");
    const json = JSON.stringify([S.config.terminals, S.screens, S.config.map, S.station]);
    if (panel.dataset.json === json) return;
    panel.dataset.json = json;
    const rooms = roomLabels();
    panel.className = "play-only tplay";
    panel.innerHTML = S.config.terminals.map((t) => {
      const here = (S.screens || []).filter((s) => s.terminal === t.id).map((s) => s.character || "a screen");
      const access = reachableNow(t) ? "" : `<span class="pill">${t.requires ? `locked: ${esc(t.requires)}` : "not reachable"}</span>`;
      return `<div><b>${esc(t.name)}</b><span class="muted small">${esc(rooms.get(t.room) || (t.room ? t.room : "portable"))}${t.system ? ` · ${esc(t.system)}` : ""}</span>${access}${here.length ? `<span class="here small">${here.map(esc).join(", ")}</span>` : ""}</div>`;
    }).join("") || '<p class="muted small">No terminals.</p>';
  }
  // Read-only: the voices (the characters are on the Crew tab).
  function renderCastPlay() {
    const panel = $("castPlay");
    const json = JSON.stringify(S.config.voices.map((v) => [v.name, v.color]));
    if (panel.dataset.json === json) return;
    panel.dataset.json = json;
    panel.innerHTML = S.config.voices.filter((v) => !v.adversary).map((v) => `<div class="castv"><b style="color: ${esc(v.color || "var(--fg)")}">${esc(v.name)}</b></div>`).join("");
  }

  // The connection graph: which voices are heard on which system (voice.systems,
  // net keys: "" the station, "*" every system). Shown once there's more than one system.
  function renderConnections() {
    const panel = $("connections");
    const systems = [{ net: "", name: S.config.stationName }];
    for (const t of S.config.terminals) if (t.system && !systems.some((s) => s.net === netKey(t.system))) systems.push({ net: netKey(t.system), name: t.system });
    const json = JSON.stringify([S.config.voices.map((v) => [v.id, v.name, v.systems]), systems]);
    if (panel.dataset.json === json) return;
    panel.dataset.json = json;
    if (systems.length < 2) { panel.innerHTML = '<p class="muted small">Only one system. Give a terminal its own System (a ship, a shuttle...) to choose which voices reach it.</p>'; return; }
    const on = (v, net) => (v.systems || [""]).includes(net);
    panel.innerHTML = `<table class="conns"><thead><tr><th>Voice</th>${systems.map((s) => `<th>${esc(s.name)}</th>`).join("")}<th title="Heard on every system, now and later">All</th></tr></thead><tbody>${
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
      if (!set.size) { e.target.checked = true; return toast(`${v.name} needs at least one system (or All).`, "error"); }
      v.systems = [...set];
    }
    send({ t: "voices", voices });
  });

  // Door-like paths in the station state (doors.*, hatches...), for "opens with".
  function doorPaths() {
    const out = [];
    const walk = (o, path) => { for (const [k, v] of Object.entries(o || {})) { const p = [...path, k]; if (v && typeof v === "object") walk(v, p); else if (/door|hatch|airlock|lock|gate/i.test(p.join("."))) out.push(p.join(".")); } };
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
    } else if (e.target.dataset.t === "open") t.open = t.startOpen = e.target.checked; // (setting up the story: how it starts, too)
    else if (e.target.dataset.t) t[e.target.dataset.t] = e.target.value;
    saveTerminals();
  });
  $("terminals").addEventListener("click", async (e) => {
    if (e.target.closest("[data-tact]")?.dataset.tact !== "del") return;
    const i = Number(e.target.closest(".tcard").dataset.i);
    if (!(await sure(`Remove ${termDraft[i].name}?`, "Players at it stay there until they or you move them.", "Remove"))) return;
    termDraft.splice(i, 1);
    send({ t: "terminals", terminals: termDraft });
    termSentAt = 0;
  });
  $("addTerminal").onclick = () => {
    termDraft.push({ name: "NEW TERMINAL", room: "", look: [], theme: "", open: true, notes: "" });
    send({ t: "terminals", terminals: termDraft });
    termSentAt = 0;
    renderTerminals(true);
  };

  // ------------------------------------------------------------ phones
  // One view at a time, from the bottom bar: the comms, or a side tab (which
  // also flips the side panel's own tabs, so the two stay in step).
  function setMview(v) {
    document.body.dataset.mview = v;
    for (const b of $("mnav").querySelectorAll("[data-mview]")) b.classList.toggle("on", b.dataset.mview === v);
    if (v !== "comms") document.querySelector(`.tabs[data-tabs="side"] [data-tab="${v}"]`)?.click();
    store.set("mview", v);
    renderMnavDot();
  }
  // Something waits on the Warden beside the log (a ruling, a draft, a roll) while they're elsewhere.
  function renderMnavDot() {
    const waiting = [...$("tray").children].some((c) => !c.hidden);
    $("mnavDot").hidden = !waiting || document.body.dataset.mview === "comms";
  }
  $("mnav").addEventListener("click", (e) => { const v = e.target.closest("[data-mview]")?.dataset.mview; if (v) setMview(v); });
  setMview(store.get("mview") || "comms");

  // ------------------------------------------------------------ story text
  // Lore, secrets and standing orders show all their text: the boxes grow to fit
  // (as it's set, as it's typed, and when the Story tab opens), never scroll.
  const STORY_BOXES = ["lore", "secrets", "standingOrders"];
  function growBox(el) {
    if (!el.offsetParent) return; // (not on screen: measured when it is)
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }
  function growStory() { for (const id of STORY_BOXES) growBox($(id)); }
  for (const id of STORY_BOXES) $(id).addEventListener("input", (e) => growBox(e.target));
  addEventListener("resize", () => requestAnimationFrame(growStory));
  document.addEventListener("toggle", (e) => { if (e.target.open && STORY_BOXES.some((id) => e.target.contains($(id)))) growStory(); }, true); // (a section opened)

  // Padlock icons for the edit toggles: locked = read-only, open = editing.
  // Lucide's "lock" and "lock-open" (lucide.dev, ISC licence), inlined.
  const LOCK_SVG = (open) => `<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="${open ? "M7 11V7a5 5 0 0 1 9.9-1" : "M7 11V7a5 5 0 0 1 10 0v4"}"/></svg>`;
  function setLock(btn, editing, what) {
    btn.innerHTML = LOCK_SVG(editing);
    btn.setAttribute("aria-label", editing ? `Done editing ${what}` : `Edit ${what}`);
  }

  // ------------------------------------------------------------ edit mode
  // Read-only (the default, remembered per device) shows what matters while
  // running the game; Edit shows the setup (dm.css .edit-only / .play-only).
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

  // ------------------------------------------------------------ tabs
  // Tab bars ([data-tabs]) show one panel at a time; the choice is remembered.
  // The highlight slides to the chosen tab and the panel eases in (dm.css).
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
        if (!p.hidden && current !== null && current !== tab) { void p.offsetWidth; p.classList.add("enter"); } // (restart the animation)
      }
      // A new tab starts at its top (the bar stays put above it).
      const col = bar.closest(".col");
      if (current !== null && current !== tab && col && col.scrollTop > 0) col.scrollTop = 0;
      current = tab;
      place();
      requestAnimationFrame(() => bar.classList.add("ready")); // (no slide on first draw)
      store.set(`tab:${group}`, tab);
      if (group === "side" && tab === "map" && S) renderMap(true); // (drawn for its width)
      if (group === "side" && tab === "story") requestAnimationFrame(growStory); // (hidden, it had no height to measure)
    };
    bar.addEventListener("click", (e) => { const t = e.target.closest("[data-tab]")?.dataset.tab; if (t) show(t); });
    show(store.get(`tab:${group}`) || bar.querySelector("[data-tab]").dataset.tab);
  }

  // ------------------------------------------------------------ station map
  let mapKey = "";
  // Drawing (schematic) or Status (board); remembered on this device.
  let mapView = store.get("mapView") || "draw";
  // The station state with each character added to their room's occupants (for the map).
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
    const key = JSON.stringify([S.station, S.config.map, mapView, people, S.config.cast.map((c) => [c.name, c.room])]);
    if (!force && key === mapKey) return;
    mapKey = key;
    const show = (el) => (mapView === "status" ? StationMap.render : StationMap.draw)(el, withCast(S.station), S.config.map, { people });
    for (const b of document.querySelectorAll(".mapview button")) b.classList.toggle("on", b.dataset.view === mapView);
    show($("map"));
    if ($("mapDialog").open) show($("mapBig"));
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
      if (p) return editStationValue(JSON.parse(p));
      const r = e.target.closest("[data-room]");
      if (r) openRoom(r.dataset.room, r.dataset.label, r.dataset.deck);
    });
  }
  $("mapExpand").onclick = (e) => {
    e.preventDefault(); // (it sits in the panel's summary)
    $("mapTitle").textContent = `${S.config.stationName} · station map`;
    $("mapDialog").showModal();
    renderMap(true);
  };
  $("mapClose").onclick = () => $("mapDialog").close();
  for (const seg of document.querySelectorAll(".mapview")) {
    seg.addEventListener("click", (e) => {
      const v = e.target.closest("[data-view]")?.dataset.view;
      if (!v) return;
      e.preventDefault(); // (one sits in the panel's summary)
      mapView = v;
      store.set("mapView", v);
      renderMap(true);
    });
  }
  // The drawing is laid out for its width.
  let mapResize = null;
  addEventListener("resize", () => { clearTimeout(mapResize); mapResize = setTimeout(() => S && renderMap(true), 200); });
  $("mapLayout").addEventListener("input", () => dirty.add("map"));
  $("mapLayoutSave").onclick = () => {
    dirty.delete("map");
    send({ t: "config", patch: { map: $("mapLayout").value } });
  };

  // ------------------------------------------------------------ room view
  // One room: its floor plan (drawn by the agent the first time, editable tile by
  // tile, shown to the players as layout only), who and what is there, its state.
  let room = null; // { id, label, deck } while the room view is open
  let roomEditing = false, roomTool = "#", roomRows = null, roomKey = "", roomSaveTimer = null, roomPainting = false;
  // Player characters in each room, from the terminals their screens are at.
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
    // No plan yet: the agent draws one (if it can).
    if (!S.config.rooms?.[id] && !S.roomBusy && S.providers.find((p) => p.id === S.config.provider)?.configured) send({ t: "roomDraft", room: id, label, deck });
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
    // The plan (or the local copy being painted).
    if (!roomEditing) roomRows = plan ? [...plan.rows] : null;
    const box = $("roomPlan");
    if (busy) box.innerHTML = `<div class="rpempty muted"><span class="spinner"></span>The agent is drawing ${esc(room.label)}…</div>`;
    else if (!roomRows) box.innerHTML = `<div class="rpempty muted">No floor plan yet. <b>Redraw with agent</b> sketches one, or unlock the padlock to paint it yourself.</div>`;
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
    // Who sees it.
    const sel = $("roomShowTo"), was = sel.value;
    sel.innerHTML = `<option value="">All players</option>` + S.config.crew.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
    sel.value = [...sel.options].some((o) => o.value === was) ? was : "";
    // Who and what is here.
    const castHere = S.config.cast.filter((c) => c.room === room.id).map((c) => c.name);
    $("roomPlayers").innerHTML = (pcs.length ? pcs.map((n) => `<span class="pcchip">${esc(n)}</span>`).join("") : `<span class="muted small">No player characters here.</span>`) +
      (castHere.length ? castHere.map((n) => `<span class="castchip" title="A character (move them on the Crew tab)">${esc(n)}</span>`).join("") : "");
    for (const [id, k] of [["roomOccupants", "occupants"], ["roomContents", "contents"]]) {
      if (document.activeElement !== $(id) && !dirty.has(id)) $(id).value = String(stationAt([k, room.id]) ?? "");
    }
    // The room's state: everything in the station state under this room's id.
    const vals = [];
    const walk = (o, p) => { for (const [k, v] of Object.entries(o || {})) { const q = [...p, k]; if (v && typeof v === "object") walk(v, q); else if (q.includes(room.id) && !["occupants", "contents"].includes(q[0])) vals.push([q, v]); } };
    walk(S.station, []);
    $("roomValues").innerHTML = vals.length ? vals.map(([p, v]) => `<button class="ghost small" data-path="${esc(JSON.stringify(p))}" title="${esc(p.join("."))}">${esc(p.filter((x) => x !== room.id).join(" ").replace(/_/g, " "))}: <b>${esc(v)}</b></button>`).join("") : `<span class="muted small">Nothing tracked here.</span>`;
    const terms = S.config.terminals.filter((t) => t.room === room.id);
    $("roomTerminals").innerHTML = terms.length ? terms.map((t) => `<div><b>${esc(t.name)}</b>: ${esc(t.notes)}</div>`).join("") : "None.";
  }

  // Painting: click or drag across tiles; the plan is saved a moment after.
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
  // Saved now, and shown as saved (not the old plan until the server's copy arrives).
  const saveRoomNow = () => { clearTimeout(roomSaveTimer); send({ t: "roomLayout", room: room.id, rows: roomRows }); (S.config.rooms ||= {})[room.id] = { rows: [...roomRows] }; };
  $("roomEdit").onclick = () => {
    if (roomEditing) saveRoomNow();
    else if (!roomRows) roomRows = ["############", ...Array.from({ length: 6 }, () => "#..........#"), "#####DD#####"];
    roomEditing = !roomEditing;
    renderRoom(true);
  };
  $("roomRedraw").onclick = async () => {
    if (S.config.rooms?.[room.id] && !(await sure(`Redraw ${room.label}?`, "The agent draws a new floor plan, replacing this one.", "Redraw", "primary"))) return;
    roomEditing = false;
    send({ t: "roomDraft", room: room.id, label: room.label, deck: room.deck });
  };
  $("roomShow").onclick = () => {
    send({ t: "roomShow", room: room.id, label: room.label, pc: $("roomShowTo").value });
    toast(`Showing ${room.label} to ${$("roomShowTo").selectedOptions[0].text.toLowerCase()} (layout only).`);
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
    toast("Saved. The agent sees it on its next reply.");
  };
  $("roomValues").addEventListener("click", (e) => {
    const p = e.target.closest("[data-path]")?.dataset.path;
    if (p) editStationValue(JSON.parse(p));
  });
  $("roomClose").onclick = () => $("roomDialog").close();
  $("roomDialog").addEventListener("close", () => {
    if (roomEditing) saveRoomNow();
    room = null;
  });

  // ------------------------------------------------------------ sounds
  const soundUrl = (id) => `api/sessions/${code}/sounds/${id}`;
  let soundsKey = "";

  // A volume slider with a percent box beside it, for fine control; the two stay in step.
  const volumeControl = (cls, volume, title) => {
    const pct = Math.round(volume * 100);
    return `<span class="volctl" title="${title}">
      <input class="${cls}" type="range" min="0" max="1" step="0.01" value="${volume}" aria-label="${title}">
      <input class="volpct" type="number" min="0" max="100" step="1" value="${pct}" aria-label="${title}, percent"><span class="muted">%</span>
    </span>`;
  };
  // Typing a percent moves the slider (and the other way round). Returns the volume, 0-1.
  function syncVolume(target) {
    const ctl = target.closest(".volctl");
    const slider = ctl.querySelector('input[type="range"]'), pct = ctl.querySelector(".volpct");
    if (target === pct) {
      if (pct.value === "") return null; // (still typing)
      const v = Math.max(0, Math.min(100, Math.round(Number(pct.value) || 0)));
      pct.value = v;
      slider.value = v / 100;
      return v / 100;
    }
    pct.value = Math.round(Number(slider.value) * 100);
    return Number(slider.value);
  }

  function renderSounds() {
    // Don't redraw the library under the Warden's fingers (renaming, dragging a slider).
    const list = $("soundList");
    const key = JSON.stringify(S.sounds);
    if (key !== soundsKey && !list.contains(document.activeElement)) {
      soundsKey = key;
      list.innerHTML = S.sounds.length
        ? S.sounds.map((s) => `<li data-id="${s.id}">
            <input class="sname" value="${esc(s.name)}" aria-label="Sound name" title="Rename">
            ${volumeControl("svol", s.volume, "Volume")}
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
            ${p.loop ? volumeControl("pvol", p.volume, "Volume (live)") : ""}
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
    else if (act === "del" && await sure(`Delete "${s.name}"?`, "The sound file is removed from this session (and stops if it's playing).", "Delete")) {
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
  // Dragging the slider shows its percent as it moves; the volume is saved on release.
  $("soundList").addEventListener("input", (e) => { if (e.target.classList.contains("svol")) syncVolume(e.target); });
  $("soundList").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.target.classList.contains("sname") || e.target.classList.contains("volpct"))) e.target.blur(); });
  $("soundPlaying").addEventListener("click", (e) => {
    const stop = e.target.closest("[data-stop]");
    if (!stop) return;
    send({ t: "soundStop", pid: stop.dataset.stop });
    // Gone at once (the list doesn't redraw while the button still has focus).
    stop.blur();
    stop.closest("li").remove();
    if (!$("soundPlaying").children.length) $("soundPlaying").innerHTML = `<li class="none">Silence</li>`;
  });
  $("soundPlaying").addEventListener("input", (e) => {
    const li = e.target.closest("li[data-pid]");
    if (!li || !e.target.closest(".volctl")) return;
    const volume = syncVolume(e.target); // (live: the players hear it change)
    if (volume !== null) send({ t: "soundVolume", pid: li.dataset.pid, volume });
  });
  $("soundPlaying").addEventListener("change", (e) => e.target.blur());
  $("soundPlaying").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.classList.contains("volpct")) e.target.blur(); });
  $("soundStopAll").onclick = () => send({ t: "soundStop", all: true });

  // On/off features in the Settings window (config keys of the same name).
  const SETTING_SWITCHES = ["narrator", "agentEffects", "agentVariants", "agentCrew", "checkFirst", "playerVitals", "playerRolls", "playerTerminals"];

  // Where voices play: the screens, Discord (the bot speaks them in its channel), or off.
  const voicesOn = () => (S.config.discordTalk ? "discord" : S.config.tts !== false ? "screens" : "off");
  function renderVoicesOn() {
    const on = voicesOn(), d = S.discord || {};
    for (const b of $("voicesOn").children) {
      b.classList.toggle("on", b.dataset.on === on);
      b.setAttribute("aria-checked", String(b.dataset.on === on));
    }
    const discordBtn = $("voicesOn").querySelector('[data-on="discord"]');
    discordBtn.disabled = !d.enabled && on !== "discord";
    discordBtn.title = d.enabled ? "The Discord bot speaks every line in its voice channel, with each voice's effects, at the same moment as the screens would" : "This server has no Discord bot (see Discord)";
    $("voicesNote").textContent = on === "discord"
      ? d.listening ? `Spoken in ${d.listening.channel} on Discord. The screens stay quiet.` : "Until the bot is in a voice channel (Discord tab), the screens speak instead."
      : on === "screens" ? "Each player's screen speaks the lines aloud." : "Nobody hears the voices: lines are only read.";
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
    renderVoicesOn();
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
  for (const id of ["theme", "talk", "provider", "model", "effort"]) $(id).addEventListener("change", (e) => send({ t: "config", patch: { [id]: e.target.value } }));
  for (const id of SETTING_SWITCHES) $(id).addEventListener("change", (e) => send({ t: "config", patch: { [id]: e.target.checked } }));
  $("settingsBtn").onclick = () => $("settingsDialog").showModal();
  $("settingsClose").onclick = () => $("settingsDialog").close();

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

  // The comms box sends as a Direction (the agent obeys), as a voice speaking
  // (the Speak picker), or as a private Note. Keyboard first: Tab / Shift+Tab
  // cycle Direction → Note → each voice and character; Enter sends in the
  // current mode, Shift+Enter is a new line, Ctrl+Enter always sends a Note.
  let composeMode = "command"; // "command" | "voice" (as $("sendAs")) | "note"
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
    $("compose").placeholder = composeMode === "command" ? "Direction for the agent: it obeys and acts on it now. Players never see it."
      : composeMode === "note" ? "Note to the agent: what's true now. Private; nothing happens on the players' screens."
      : `Speak as ${who}: your exact words, on every player's screen.`;
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
  // A button sends in its mode and makes it the current one; the box keeps focus.
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

  // Listen: the browser's speech-to-text writes down what the Warden says aloud
  // at the table. Each finished phrase goes to the log (read-only, private) and
  // with the agent's next prompt, as things that happened. Off until switched on.
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let listening = false, recog = null, quickEnds = 0;
  const micStatus = (text) => { $("micLive").textContent = text; };
  function setListening(on) {
    listening = on;
    quickEnds = 0;
    $("micBtn").setAttribute("aria-pressed", String(on));
    $("micBtn").textContent = on ? "Listening" : "Listen";
    $("micLive").hidden = !on;
    micStatus(on ? "Starting the microphone…" : "");
    if (on) startRecog();
    else recog?.abort();
  }
  // Something stops it for good: say what, in the toast and under the box.
  function micFailed(text) {
    console.warn(`[listen] ${text}`);
    toast(text, "error");
    setListening(false);
  }
  const MIC_ERRORS = {
    "not-allowed": "The microphone is blocked for this page: allow it (the icon in the address bar) and press Listen again.",
    "service-not-allowed": "This browser won't run speech recognition here. Use Chrome or Edge.",
    "audio-capture": "No microphone found.",
    network: "This browser can't reach a speech-recognition service (Brave, the Claude app's browser and some other Chromium browsers don't have one). Use Chrome or Edge.",
    "language-not-supported": `Speech recognition doesn't support your browser's language (${navigator.language}).`,
  };
  function startRecog() {
    const r = (recog = new Recognition());
    const started = Date.now();
    let heardAny = false;
    recog.lang = navigator.language || "en-US";
    recog.continuous = true;
    recog.interimResults = true;
    recog.onaudiostart = () => micStatus("Listening… speak and it's written down.");
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
      if (e.error === "no-speech" || e.error === "aborted") return; // (a silence; or switched off)
      if (recog === r) micFailed(MIC_ERRORS[e.error] || `Speech recognition stopped: ${e.error}${e.message ? ` (${e.message})` : ""}.`);
    };
    // Browsers stop listening after a silence or a while: start again while it's on.
    // If it keeps ending at once without hearing anything, it isn't working.
    recog.onend = () => {
      if (!listening || recog !== r) return;
      quickEnds = !heardAny && Date.now() - started < 1500 ? quickEnds + 1 : 0;
      if (quickEnds >= 4) return micFailed("Speech recognition keeps stopping straight away in this browser. Use Chrome or Edge.");
      setTimeout(() => listening && recog === r && startRecog(), 250);
    };
    try { recog.start(); } catch (err) { micFailed(`Couldn't start speech recognition: ${err.message}`); }
  }
  // Without speech recognition (or on an insecure page) Listen says how to get it, instead of starting.
  const FIREFOX_HOW = "Firefox has speech recognition switched off: open about:config, set media.webspeech.recognition.enable to true, then reload this page.";
  const micUnavailable = !window.isSecureContext
    ? "Listen needs a secure page: open the console over https, or at localhost on the computer running it."
    : !Recognition ? (/firefox/i.test(navigator.userAgent) ? FIREFOX_HOW : "Listen needs speech recognition, which this browser doesn't have. Use Chrome, Edge or Firefox.") : "";
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
          return { voice: row.querySelector("select").value, character: row.querySelector(".dchar").value.trim(), system: row.querySelector(".dsys")?.value || "", text: row.querySelector(".dwho + textarea").value, effects: fx, variants };
        })
        .filter((l) => l.text.trim() || l.effects.length || l.variants.length), // effect-only beats count
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
  // Switching a line's voice: its speaker box follows (shown for shared voices).
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
    const since = S.storyStartedAt ? new Date(S.storyStartedAt).toLocaleString() : "";
    const how = await ask("Restart the story?",
      (since
        ? `Puts the story back exactly as it was when play began (${since}): setting, lore, secrets, cast, map, terminals, characters and station. Anything changed since, by the agent or by you, is undone.`
        : "The story hasn't been played yet, so there's nothing to undo; everything is cleared and the characters made fresh.")
      + " Clears the log, rolls, clocks, effects and handouts. Your settings and sounds are kept; players stay connected, as GUEST, at the starting terminal.",
      [["default", "Restart", "danger"]]);
    if (how) send({ t: "resetSession" });
  };
  $("resetAll").onclick = async () => (await sure("Factory reset?", "Everything (lore, personas, voices, secrets, station) goes back to the defaults.", "Factory reset")) && send({ t: "resetAll" });

  // ------------------------------------------------------------ voices & entities
  const BUILTIN_IDS = ["terminal", "broadcast", "narrator"];
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
    // The voices, then each character (face to face if they're with players, else over the intercom).
    fillSelect(sel, [
      ...S.config.voices.map((v) => [v.id, v.id === "terminal" ? `${v.name} (terminal)` : v.adversary && !v.adversary.revealed ? `${v.name} (as ???)` : v.name]),
      ...(S.config.cast || []).map((c) => [`cast:${c.id}`, c.name]),
    ], prev);
    if (!sel.value) sel.value = "terminal";
    renderSendOn();
    renderComposeMode(); // (names may have changed)
  }

  // Which system's screens Speak goes to, when the story has more than one
  // (e.g. a ship): where the players are (each system, if they're split), or
  // "to All" for every screen (a broadcast, something creepy in every machine).
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
    panel.innerHTML = voicesDraft.map((v, i) => v.adversary ? "" : `
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
  const checkName = (id) => (id === "panic" ? "Panic" : S?.rollOptions?.checks[id]?.label || id);
  const advMark = (a) => (a === "advantage" ? " [+]" : a === "disadvantage" ? " [−]" : "");

  // An attempt the agent left open: the Warden rules on it, or calls for a roll.
  // The roll form lives in the Actions tab; ⚖ Your call's 🎲 borrows it (under the stakes).
  function rollFormHome() {
    if ($("rollForm").parentElement !== $("rollCard")) $("rollCard").append($("rollForm"));
    $("rollAway").hidden = true;
    rollFromOutcome = false;
  }

  function renderOutcome() {
    const card = $("outcome");
    const oc = S.outcomeCheck;
    if (!oc || card.dataset.id !== oc.id) rollFormHome(); // (before the card is redrawn or hidden)
    card.hidden = !oc;
    if (!oc) { card.dataset.id = ""; return; }
    if (card.dataset.id === oc.id) return;
    card.dataset.id = oc.id;
    card.innerHTML = `
      <div class="label">⚖ Your call: the players are attempting</div>
      ${oc.held ? '<div class="muted small">Nothing has been shown to the players yet; they see PROCESSING until you decide.</div>' : ""}
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
        <button data-oc="roll" class="ocbtn" title="Call for a roll" aria-label="Call for a roll">🎲</button>
        <span class="grow"></span>
        <button data-oc="dismiss" class="ghost">Dismiss</button>
      </div>
      <div class="ocroll"></div>`;
  }

  // The stakes are editable: what you write is what the agent narrates by.
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
    if (stakesTimer) sendStakes(); // (edits still waiting go first)
    if (act === "success" || act === "failure") send({ t: "outcome", verdict: act });
    else if (act === "dismiss") send({ t: "outcomeDismiss" });
    else if (act === "roll") {
      if ($("rollForm").parentElement !== $("rollCard")) return rollFormHome(); // (🎲 again: close it)
      // Pre-fill the roll form from the agent's suggestion, for whoever typed the attempt.
      if (oc.suggested_check !== "none") $("rollCheck").value = oc.suggested_check;
      const by = S.log.findLast((e) => e.kind === "player" && e.by)?.by;
      const pc = S.config.crew.find((c) => c.name === by);
      if (pc) $("rollWho").value = pc.id;
      $("rollAdv").value = oc.advantage || "none";
      $("rollReason").value = oc.attempt || "";
      rollFromOutcome = true;
      rollFormChanged();
      // The who-rolls-what form opens here, under the stakes.
      $("outcome").querySelector(".ocroll").append($("rollForm"));
      $("rollAway").hidden = false;
      $("rollForm").scrollIntoView({ behavior: "smooth", block: "nearest" });
      $("rollWho").focus();
    }
  });

  let rollFromOutcome = false, rollWhoKey = "";
  const rollSkillName = (v) => v.slice(2); // option values are "s:<skill>"
  const hasSkill = (pc, skill) => pc.skills.some((k) => k.toLowerCase() === skill.toLowerCase());

  // The roll form: who rolls (one character, or all), and the skills they have.
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
      $("rollSkill").dataset.for = ""; // rebuild the skill list
    }
    rollFormChanged();
    renderRollStatus();
  }

  // The skills on offer and the target preview follow the chosen character and check.
  function rollFormChanged() {
    const crew = S.config.crew;
    const who = $("rollWho").value;
    const pcs = who === "all" ? crew : crew.filter((c) => c.id === who);
    const panic = $("rollCheck").value === "panic";
    const skillSel = $("rollSkill");
    if (skillSel.dataset.for !== who) {
      skillSel.dataset.for = who;
      const was = skillSel.value;
      const skills = [...new Set(pcs.flatMap((c) => c.skills))];
      skillSel.innerHTML = `<option value="">No skill</option>` + skills.map((k) => {
        const holders = who === "all" ? ` (${pcs.filter((c) => hasSkill(c, k)).map((c) => c.name.match(/"([^"]+)"/)?.[1] || c.name.split(/\s+/)[0]).join(", ")})` : "";
        return `<option value="s:${esc(k)}">${esc(k + holders)}</option>`;
      }).join("");
      if ([...skillSel.options].some((o) => o.value === was)) skillSel.value = was;
    }
    for (const el of document.querySelectorAll("#rollCard .rollskill")) el.hidden = panic;
    $("rollSkillLevel").closest("label").hidden = panic || !skillSel.value;
    // What each of them will roll against, from their sheets.
    const check = $("rollCheck").value, skill = rollSkillName(skillSel.value);
    const bonus = { trained: 10, expert: 15, master: 20 }[$("rollSkillLevel").value];
    const line = (c) => {
      if (panic) return `${c.name}: Stress ${c.stress}, panics on a d20 of ${c.stress} or under`;
      const stat = c.stats[check] ?? c.saves[check];
      const plus = skill && hasSkill(c, skill) ? bonus : 0;
      return `${c.name}: ${checkName(check)} ${stat}${plus ? ` + ${plus}` : ""}, roll under ${stat + plus}`;
    };
    $("rollTarget").innerHTML = pcs.length ? pcs.map((c) => esc(line(c))).join("<br>") : "Add player characters under Crew to call for rolls.";
    $("rollCall").disabled = !pcs.length || S.roll?.status === "waiting";
  }
  for (const id of ["rollWho", "rollCheck", "rollSkill", "rollSkillLevel"]) $(id).addEventListener("change", rollFormChanged);

  // The roll in progress (who has rolled, who hasn't), or the last one's results.
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
        const nobody = !S.claims[p.id] ? ` <span class="muted small">(nobody is playing them)</span>` : "";
        return `<li><span class="spinner"></span>${esc(p.name)}: waiting${nobody} <button data-roll="for" data-pc="${esc(p.id)}" class="ghost" title="Roll their dice from here">🎲 Roll for them</button></li>`;
      }
      const res = got.result;
      const dice = `${res.dice.map(show).join(" / ")}${res.dice.length > 1 ? ` → ${show(res.used)}` : ""}`;
      const verdict = res.panic
        ? (res.success ? "kept their cool" : `PANIC · Panic Table ${res.used}`)
        : `${res.outcome.toUpperCase()}${res.success ? "" : " · +1 STRESS"}`;
      const how = got.by === "warden" ? " (you rolled)" : got.manual ? " (table dice)" : "";
      return `<li class="res ${res.success ? "ok" : "bad"}">${esc(p.name)}: ${dice} ${res.panic ? "vs Stress" : "vs"} ${res.target}${how}: ${esc(verdict)}</li>`;
    }).join("");
    const narrate = hasKey()
      ? `<span class="muted small">The agent narrates the result.</span>`
      : `<span class="muted small">No AI key: narrate it with Speak.</span>`;
    box.innerHTML = `<div>🎲 <b>${esc(label)}</b></div><ul class="rollres">${rows}</ul>
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
        skillLevel: $("rollSkill").value ? $("rollSkillLevel").value : "none",
        reason: $("rollReason").value,
      },
    });
    rollFromOutcome = false;
  };
  $("rollStatus").addEventListener("click", (e) => {
    const b = e.target.closest("[data-roll]");
    const act = b?.dataset.roll;
    if (act === "cancel" || act === "clear") send({ t: "rollCancel" });
    else if (act === "for") send({ t: "rollFor", pc: b.dataset.pc });
  });

  // ------------------------------------------------------------ handouts
  function renderHandouts() {
    const to = $("docTo");
    const opts = [["", "Everyone"], ...S.config.crew.map((c) => [c.id, c.name])];
    const key = JSON.stringify(opts);
    if (to.dataset.key !== key) { to.dataset.key = key; const was = to.value; to.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join(""); to.value = opts.some(([v]) => v === was) ? was : ""; }
    const list = (S.handouts || []).slice().reverse();
    const nameOf = (id) => S.config.crew.find((c) => c.id === id)?.name || "everyone";
    $("docList").innerHTML = list.length ? list.map((h) => `<li title="${esc(h.text.slice(0, 300))}"><span class="grow">${esc(h.title)} <span class="muted">· ${esc(h.to ? nameOf(h.to) : "everyone")}</span></span><button data-doc-again="${esc(h.id)}" class="ghost" title="Show it on their screens again">↻</button><button data-doc-del="${esc(h.id)}" class="ghost" title="Take it back">✕</button></li>`).join("") : '<li class="muted small">None given yet.</li>';
  }
  // The agent writes it from the description in the text box (and the title, if any).
  function handoutWriting(busy) {
    $("docWrite").disabled = busy;
    $("docWrite").textContent = busy ? "Writing…" : "Write it";
  }
  $("docWrite").onclick = () => {
    const title = $("docTitle").value.trim(), brief = $("docText").value.trim();
    if (!brief && !title) return toast("Describe the document first, e.g. Salk's medical journal, hinting that he's infected.", "error");
    send({ t: "handoutWrite", brief, title });
  };
  $("docSend").onclick = () => {
    const title = $("docTitle").value.trim(), text = $("docText").value.trim();
    if (!title || !text) return toast("A handout needs a title and some text.", "error");
    send({ t: "handout", title, text, to: $("docTo").value });
    $("docTitle").value = $("docText").value = "";
  };
  $("docList").addEventListener("click", (e) => {
    const again = e.target.closest("[data-doc-again]")?.dataset.docAgain, del = e.target.closest("[data-doc-del]")?.dataset.docDel;
    if (again) send({ t: "handoutAgain", id: again });
    if (del) send({ t: "handoutDelete", id: del });
  });

  // ------------------------------------------------------------ clocks
  function renderClocks() {
    const list = S?.clocks || [];
    $("clockList").innerHTML = list.length ? list.map((c) => {
      const s = c.paused ? c.left : Math.max(0, Math.ceil((c.ends - Date.now()) / 1000));
      const id = esc(c.id);
      return `<li class="${c.paused ? "paused" : ""}"><span class="grow">${esc(c.label)}${c.paused ? ' <span class="muted">· paused</span>' : ""}</span><span class="ctime${s <= 30 && !c.paused ? " low" : ""}">${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}</span>
        <button data-clock-pause="${id}" data-pause="${c.paused ? "" : "1"}" class="ghost" title="${c.paused ? "Resume" : "Pause (frozen on every screen)"}">${c.paused ? "▶" : "⏸"}</button>
        <button data-clock-shift="${id}" data-seconds="-60" class="ghost" title="Advance it: a minute less left">−1m</button>
        <button data-clock-shift="${id}" data-seconds="60" class="ghost" title="A minute more">+1m</button>
        <button data-clock="${id}" class="ghost danger" title="Cancel it (nothing happens)">✕</button></li>`;
    }).join("") : '<li class="muted small">None running.</li>';
  }
  setInterval(() => S?.clocks?.some((c) => !c.paused) && renderClocks(), 1000);
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

  // ------------------------------------------------------------ session controls
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
    else { e.target.checked = false; toast("Paste the Groq key, tick this, then save it.", "info"); }
  };
  $("discordStop").onclick = () => send({ t: "discordStop" });
  $("discordCopy").onclick = copyDiscordCommand;
  $("discordCmd").onfocus = (e) => e.target.select();
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
    document.title = `Warden · ${code}`;
    connect();
  } else {
    showStart(code ? `This device isn't the Warden for session ${code}. Open it with its Warden link.` : "");
  }
})();
