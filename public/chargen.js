// The NEW CHARACTER screen. The rules and the dice live on the server (chargen.js); this only shows them.
window.Chargen = (() => {
  const $ = (id) => document.getElementById(id);
  const STEPS = ["stats", "saves", "class", "health", "skills", "gear", "credits", "name", "review"];
  const TITLE = { stats: "STATS", saves: "SAVES", class: "CLASS", health: "HEALTH", skills: "SKILLS", gear: "LOADOUT, TRINKET AND PATCH", credits: "CREDITS", name: "NAME", review: "REVIEW" };
  const STAT_KEYS = ["strength", "speed", "intellect", "combat"], SAVE_KEYS = ["sanity", "fear", "body"], CLASSES = ["Marine", "Android", "Scientist", "Teamster"];
  const ROLL_TEXT = {
    stats: "ROLL 2D10+25 FOR EACH STAT: STRENGTH, SPEED, INTELLECT, COMBAT.",
    saves: "ROLL 2D10+10 FOR EACH SAVE: SANITY, FEAR, BODY.",
    health: "ROLL 1D10+10 FOR MAXIMUM HEALTH.",
    credits: "ROLL 2D10 AND MULTIPLY BY 10 FOR YOUR STARTING CREDITS.",
  };
  const INTRO = "THE WARDEN APPROVES YOUR CHARACTER AT THE END: THEY ACCEPT IT, OR SEND IT BACK WITH A NOTE. DICE: 2D10+25 MEANS ROLL TWO TEN-SIDED DICE, ADD THEM, THEN ADD 25. 2D10X10 MEANS ADD TWO D10, THEN MULTIPLY BY 10.";
  let rolling = "";
  let shown = "", api, view = null, step = 0, cursor = 0, typing = "", err = "", waiting = false, pending = [], fresh = "", faces = null, showFaces = false, isPilot = false;
  const esc = (s) => api.escH(s);
  const up = (s) => esc(String(s).toUpperCase());
  const pad = (n) => String(n).padStart(2, "0");
  const open = () => !$("chargen").hidden;

  function send(msg) { err = ""; api.send(msg); }
  function start(replaces = "") { step = 0; cursor = 0; typing = ""; err = ""; waiting = false; showFaces = false; fresh = ""; api.send({ t: "cgStart", replaces }); }
  const set = (patch) => send({ t: "cgSet", set: patch });
  const roll = (what, dice) => {
    if (rolling || (view?.rolls[what] && !view.rerolls)) return;
    rolling = what;
    setTimeout(() => { if (rolling === what) rolling = ""; }, 3000);
    send({ t: "cgRoll", what, ...(dice ? { dice } : {}) });
  };

  function onMessage(msg) {
    rolling = "";
    if (msg.error) {
      err = msg.error;
      if (!view && !open()) return api.notice(msg.error);
    }
    if (msg.rejected) { waiting = false; err = `THE WARDEN SENT IT BACK: ${msg.rejected}`; step = STEPS.length - 1; }
    if (msg.submitted) waiting = true;
    if (msg.withdrawn) { waiting = false; step = STEPS.length - 1; }
    view = msg.view;
    fresh = msg.rolled || "";
    if (view && !open()) api.open();
    if (open()) render();
  }

  function onAccepted(id) {
    waiting = false;
    view = null;
    api.close();
    api.claim(id);
    api.accepted(id);
  }

  function setPending(list, pilot) {
    pending = list || [];
    isPilot = !!pilot;
    if (isPilot && pending.length && !open()) api.open();
    if (open()) render();
  }

  const stepDone = () => {
    if (!view) return false;
    const r = view.rolls, name = STEPS[step];
    if (name === "stats" || name === "saves" || name === "health" || name === "credits") return !!r[name];
    if (name === "class") return !!view.className && (!view.classes[view.className].minus && !view.classes[view.className].plus || !!view.choice);
    if (name === "skills") return !!view.skills?.done;
    if (name === "gear") return !!(r.loadout && r.trinket && r.patch);
    if (name === "name") return !!view.name;
    return !!view.sheet;
  };

  const KEYS = {
    stats: "R TO ROLL · T TO TYPE YOUR OWN DICE · ENTER TO GO ON · ESC TO LEAVE",
    saves: "R TO ROLL · T TO TYPE YOUR OWN DICE · ENTER TO GO ON · ESC TO GO BACK",
    health: "R TO ROLL · T TO TYPE YOUR OWN DICE · ENTER TO GO ON · ESC TO GO BACK",
    credits: "R TO ROLL · T TO TYPE YOUR OWN DICE · ENTER TO GO ON · ESC TO GO BACK",
    class: "UP/DOWN OR 1-4 TO CHOOSE · ENTER TO GO ON · ESC TO GO BACK",
    skills: "UP/DOWN TO MOVE · SPACE TO TAKE OR DROP · ENTER TO GO ON · ESC TO GO BACK",
    gear: "1, 2, 3 TO ROLL · TAB TO A BOX TO TYPE IN IT · ENTER TO GO ON · ESC TO GO BACK",
    name: "TYPE A NAME · ENTER FOR THE NEXT BOX, THEN TO GO ON · ESC TO GO BACK",
    review: "ENTER TO SUBMIT · ESC TO GO BACK AND CHANGE SOMETHING",
  };
  function why() {
    if (!view || stepDone()) return "";
    const name = STEPS[step], info = view.classes[view.className];
    if (name === "class") return view.className ? `CHOOSE THE STAT FOR THE ${up(view.className)}'S ${info.minus ? `-${info.minus}` : `+${info.plus}`} TO CONTINUE` : "CHOOSE A CLASS TO CONTINUE";
    if (name === "skills") return "CHOOSE YOUR SKILLS TO CONTINUE";
    if (name === "gear") return `ROLL THE ${["loadout", "trinket", "patch"].filter((w) => !view.rolls[w]).map((w) => w.toUpperCase()).join(", ")} TO CONTINUE`;
    if (name === "name") return "TYPE A NAME TO CONTINUE";
    if (name === "review") return "THE SHEET IS NOT COMPLETE: GO BACK AND FIX WHAT IS LISTED";
    return "ROLL (OR TYPE YOUR OWN DICE) TO CONTINUE";
  }

  const dice = (what, labels) => {
    if (!view.rolls[what]) return "";
    const d = view.rolls[what].dice;
    const per = d.length / labels.length;
    return `<div class="cg-rows">${labels.map((k, i) => {
      const part = d.slice(i * per, (i + 1) * per);
      const base = { stats: 25, saves: 10 }[what];
      return `<div class="cg-row"><span class="cg-k">${up(k)}</span> ${part.map((x) => `<span class="cg-die" data-w="${what}" data-v="${x}">${x}</span>`).join(" + ")} + ${base} = <b class="cg-num">${(view.rolls[what].values || {})[k]}</b></div>`;
    }).join("")}</div>`;
  };

  function rollBox(what, extra = "") {
    const r = view.rolls[what];
    if (r) return `${extra}${view.rerolls ? `<div class="cg-acts"><button type="button" class="p-btn" data-act="roll" data-what="${what}">[R] REROLL</button> <button type="button" class="p-btn" data-act="type" data-what="${what}">[T] TYPE MY OWN DICE</button></div>` : '<div class="p-dim">ROLLED. THE WARDEN HAS NOT ALLOWED REROLLS: PRESS ENTER OR [ NEXT ] TO GO ON.</div>'}${typeBox(what)}`;
    return `<div class="p-dim">${ROLL_TEXT[what]}</div>${step === 0 ? `<div class="p-dim">${INTRO}</div>` : ""}<div class="cg-acts"><button type="button" class="p-btn" data-act="roll" data-what="${what}">[R] ROLL</button> <span class="p-dim">OR</span> <button type="button" class="p-btn" data-act="type" data-what="${what}">[T] TYPE MY OWN DICE (IF YOU ROLLED REAL ONES)</button></div>${typeBox(what)}`;
  }
  const NEED = { stats: [8, "EIGHT D10 (TWO PER STAT, IN ORDER STRENGTH, SPEED, INTELLECT, COMBAT)"], saves: [6, "SIX D10 (TWO PER SAVE, IN ORDER SANITY, FEAR, BODY)"], health: [1, "ONE D10"], credits: [2, "TWO D10"], loadout: [1, "ONE D10 (0-9)"], trinket: [1, "ONE D100 (00-99)"], patch: [1, "ONE D100 (00-99)"] };
  const typeBox = (what) => (typing === what
    ? `<form class="cg-type" data-what="${what}"><label class="p-dim">ENTER ${NEED[what][1]}. A 0 ON A D10 IN A SUM COUNTS AS 10.<br><input id="cg-dice" autocomplete="off" inputmode="numeric" aria-label="Your dice"></label> <button type="submit" class="p-btn">[ OK ]</button></form>`
    : "");

  function render() {
    const body = $("cg-body");
    if (pending.length && isPilot) return renderPending(body);
    $("cg-err").textContent = err.toUpperCase();
    $("cg-why").textContent = "";
    $("cg-back").hidden = waiting;
    $("cg-next").hidden = waiting;
    if (waiting) {
      $("cg-step").textContent = "SUBMITTED";
      $("cg-keys").textContent = "ESC TO CLOSE THIS AND KEEP PLAYING";
      body.innerHTML = '<div class="p-text">YOUR CHARACTER IS WAITING FOR THE WARDEN TO APPROVE IT. IF THEY ACCEPT IT, YOU PLAY IT. IF THEY TURN IT DOWN, IT COMES BACK HERE WITH THEIR NOTE AND YOU CAN CHANGE IT AND SUBMIT AGAIN.</div><div class="cg-acts"><button type="button" class="p-btn" data-act="withdraw">[ TAKE IT BACK AND KEEP EDITING ]</button></div>';
      return;
    }
    if (!view) { body.innerHTML = ""; return; }
    $("cg-keys").textContent = KEYS[STEPS[step]];
    const name = STEPS[step], n = step + 1;
    $("cg-step").textContent = `STEP ${n} OF ${STEPS.length}: ${TITLE[name]}${view.replaces ? " (REPLACEMENT)" : ""}`;
    setLabelText($("cg-next"), name === "review" ? "[ SUBMIT ]" : "[ NEXT ]");
    $("cg-next").disabled = !stepDone();
    $("cg-why").textContent = why();
    const keep = document.activeElement?.dataset?.field || "", moved = shown !== name;
    shown = name;
    body.innerHTML = ({ stats: statsStep, saves: savesStep, class: classStep, health: healthStep, skills: skillsStep, gear: gearStep, credits: creditsStep, name: nameStep, review })[name]();
    if (fresh && view.rolls[fresh]) tumble(body);
    const first = body.querySelector("input:not([type=hidden])");
    const again = keep && body.querySelector(`[data-field="${keep}"]`);
    if (again) again.focus();
    else if (first && name === "name" && moved && !typing) first.focus();
    if (typing) $("cg-dice")?.focus();
    if (!$("chargen").contains(document.activeElement) || document.activeElement.disabled || document.activeElement === $("chargen")) (!typing && [...body.querySelectorAll('[data-act="roll"]')].find((b) => !view.rolls[b.dataset.what]) || $("chargen")).focus({ preventScroll: true });
    body.querySelector(".cg-cur")?.scrollIntoView({ block: "nearest" });
    if (name === "review") api.fit(body);
  }
  const setLabelText = (el, t) => { el.textContent = t; };

  function tumble(root) {
    const what = fresh, dies = [...root.querySelectorAll(`.cg-die[data-w="${what}"]`)];
    const faceOf = () => (what === "trinket" || what === "patch" ? pad(Math.floor(Math.random() * 100)) : what === "loadout" ? Math.floor(Math.random() * 10) : 1 + Math.floor(Math.random() * 10));
    let n = 0;
    const iv = setInterval(() => {
      n++;
      dies.forEach((d, i) => { d.textContent = n < 6 + i ? faceOf() : d.dataset.v; });
      if (n > 6 + dies.length) { clearInterval(iv); dies.forEach((d) => (d.textContent = d.dataset.v)); }
    }, 70);
    fresh = "";
  }

  const statsStep = () => rollBox("stats", dice("stats", STAT_KEYS));
  const savesStep = () => rollBox("saves", dice("saves", SAVE_KEYS));

  function classStep() {
    const sel = view.className, info = view.classes;
    const list = CLASSES.map((k, i) => `<li class="${k === sel ? "cg-on" : ""}${i === cursor ? " cg-cur" : ""}"><button type="button" class="p-btn" data-act="class" data-v="${k}">[${i + 1}] ${up(k)}</button><div class="p-dim">${esc(info[k].text)} ${esc(info[k].skills)}</div><div class="p-dim">TRAUMA RESPONSE: ${esc(info[k].trauma)}</div></li>`).join("");
    let choice = "";
    if (sel && (info[sel].minus || info[sel].plus)) {
      const sign = info[sel].minus ? `-${info[sel].minus}` : `+${info[sel].plus}`;
      choice = `<div class="p-dim">WHICH STAT TAKES THE ${up(sel)}'S ${sign}?</div><div class="cg-acts">${STAT_KEYS.map((k, i) => `<button type="button" class="p-btn ${view.choice === k ? "cg-pick" : ""}" data-act="choice" data-v="${k}">[${"ABCD"[i]}] ${up(k)}${view.final ? ` ${view.final.stats[k]}` : ""}</button>`).join(" ")}</div>`;
    }
    const fin = view.final ? `<div class="cg-rows"><div class="cg-row"><span class="cg-k">STATS</span> ${STAT_KEYS.map((k) => `${up(k)} <b>${view.final.stats[k]}</b>`).join(" · ")}</div><div class="cg-row"><span class="cg-k">SAVES</span> ${SAVE_KEYS.map((k) => `${up(k)} <b>${view.final.saves[k]}</b>`).join(" · ")}</div><div class="cg-row"><span class="cg-k">MAX WOUNDS</span> <b>${view.wounds}</b></div></div>` : "";
    return `<ol class="cg-list">${list}</ol>${choice}${fin}`;
  }

  const healthStep = () => rollBox("health", view.rolls.health
    ? `<div class="cg-rows"><div class="cg-row"><span class="cg-k">MAXIMUM HEALTH</span> <span class="cg-die" data-w="health" data-v="${view.rolls.health.dice[0]}">${view.rolls.health.dice[0]}</span> + 10 = <b class="cg-num">${view.rolls.health.value}</b></div><div class="cg-row"><span class="cg-k">WOUNDS</span> 0 / ${view.wounds ?? "?"}</div><div class="cg-row"><span class="cg-k">STRESS</span> 2 (MINIMUM STRESS 2)</div></div>` : "");

  function skillsStep() {
    const s = view.skills, rows = [];
    let idx = 0;
    const need = s.bonus.map((c) => Object.entries(c).map(([t, n]) => `${n} ${t.toUpperCase()}`).join(" + ")).join(" OR ");
    for (const tier of ["trained", "expert", "master"]) {
      rows.push(`<div class="cg-tier">${tier.toUpperCase()} +${{ trained: 10, expert: 15, master: 20 }[tier]}</div>`);
      for (const o of s.options.filter((x) => x.tier === tier)) {
        const live = o.state === "open" || o.state === "taken";
        const here = live && idx++ === cursor;
        const mark = o.state === "taken" ? "[X]" : o.state === "class" ? "[*]" : live ? "[ ]" : "[-]";
        rows.push(`<button type="button" class="p-btn cg-skill ${o.state}${here ? " cg-cur" : ""}" data-act="skill" data-v="${esc(o.name)}" ${live ? "" : "disabled"}>${mark} ${up(o.name)}${o.state === "locked" ? ` <span class="p-dim">${up(o.why)}</span>` : ""}${o.state === "class" ? ' <span class="p-dim">CLASS SKILL</span>' : ""}</button>`);
      }
    }
    return `<div class="p-dim">YOUR CLASS SKILLS ARE MARKED [*]. CHOOSE ${need}. A HIGHER SKILL NEEDS ONE OF ITS LISTED PREREQUISITES. UP/DOWN TO MOVE, SPACE TO TAKE OR DROP.</div><div class="cg-skills">${rows.join("")}</div>`;
  }

  function gearStep() {
    const row = (what, title, n) => {
      const r = view.rolls[what];
      const book = view.tables ? "" : `<div class="p-dim">LOOK IT UP IN YOUR PLAYER'S SURVIVAL GUIDE, PAGE ${view.pages[what]}, AND TYPE THE RESULT. NO BOOK? TYPE YOUR OWN.</div>`;
      return `<div class="cg-gear"><div><span class="cg-k">${title}</span> ${r ? `<span class="cg-die" data-w="${what}" data-v="${pad(r.dice[0])}">${pad(r.dice[0])}</span>` : ""}
        ${!r || view.rerolls ? `<button type="button" class="p-btn" data-act="roll" data-what="${what}">[${n}] ${r ? "REROLL" : `ROLL ${what === "loadout" ? "D10" : "D100"}`}</button> <span class="p-dim">OR</span> <button type="button" class="p-btn" data-act="type" data-what="${what}">TYPE MY OWN DICE</button>` : ""}</div>
        ${typeBox(what)}
        ${r ? `${book}<input data-field="${what}" value="${esc(view[what])}" maxlength="${what === "loadout" ? 400 : what === "trinket" ? 160 : 80}" aria-label="${title}">` : ""}</div>`;
    };
    const blank = ["loadout", "trinket", "patch"].filter((w) => view.rolls[w] && !view[w].trim()), many = blank.length > 1;
    return `${row("loadout", "LOADOUT", 1)}${row("trinket", "TRINKET", 2)}${row("patch", "PATCH", 3)}<div class="p-dim">PRESS 1, 2, 3 TO ROLL. TAB TO A TEXT FIELD TO TYPE IN IT.</div>${blank.length ? `<div class="p-dim cg-warn">${blank.map((w) => w.toUpperCase()).join(", ")} ${many ? "ARE" : "IS"} BLANK. LEAVE ${many ? "THEM" : "IT"} BLANK AND THE WARDEN WILL HAVE TO FILL ${many ? "THEM" : "IT"} IN.</div>` : ""}`;
  }

  const creditsStep = () => rollBox("credits", view.rolls.credits
    ? `<div class="cg-rows"><div class="cg-row"><span class="cg-k">CREDITS</span> (<span class="cg-die" data-w="credits" data-v="${view.rolls.credits.dice[0]}">${view.rolls.credits.dice[0]}</span> + <span class="cg-die" data-w="credits" data-v="${view.rolls.credits.dice[1]}">${view.rolls.credits.dice[1]}</span>) x 10 = <b class="cg-num">${view.rolls.credits.value}</b> CR</div></div>` : "");

  function nameStep() {
    const faceBtn = view.portrait ? `<span class="cg-facepreview">${api.portrait(view.portrait)}</span>` : "";
    const grid = showFaces ? `<div class="cg-faces">${(faces || []).map((id) => `<button type="button" data-act="face" data-v="kit/${esc(id)}.png" class="${view.portrait === `kit/${id}.png` ? "on" : ""}" title="No. ${esc(id.replace("sfcp-", ""))}"><img src="portraits/${esc(id)}.png" alt="Portrait ${esc(id.replace("sfcp-", ""))}" loading="lazy"></button>`).join("") || '<span class="p-dim">NO PICTURES.</span>'}</div>` : "";
    return `<label class="cg-label">NAME<input data-field="name" value="${esc(view.name)}" maxlength="60" autocomplete="off"></label>
      <label class="cg-label">PRONOUNS<input data-field="pronouns" value="${esc(view.pronouns)}" maxlength="20" autocomplete="off"></label>
      <div class="cg-label">PICTURE (OPTIONAL) ${faceBtn}<br><button type="button" class="p-btn" data-act="faces">${showFaces ? "[ HIDE PICTURES ]" : "[ CHOOSE FROM THE PICTURE PACK ]"}</button>${view.portrait ? ' <button type="button" class="p-btn" data-act="face" data-v="">[ NO PICTURE ]</button>' : ""}</div>${grid}
      <div class="p-dim">HIGH SCORE STARTS AT 0.</div>`;
  }

  function review() {
    if (!view.sheet) return `<div class="cg-problems">${view.problems.map((p) => `<div>${up(p)}</div>`).join("")}</div>`;
    return `${api.sheet(view.sheet)}<div class="p-dim">CREDITS: ${view.sheet.credits} CR. HIGH SCORE: 0.</div>`;
  }

  function renderPending(body) {
    $("cg-step").textContent = "A NEW CHARACTER IS WAITING FOR YOUR APPROVAL";
    $("cg-back").hidden = $("cg-next").hidden = true;
    $("cg-err").textContent = "";
    body.innerHTML = pending.map((n) => `<div class="cg-pend" data-id="${esc(n.id)}">${api.sheet(n.sheet)}<details><summary class="p-dim">EVERY ROLL</summary>${n.history.map((h) => `<div class="p-dim">${esc(h)}</div>`).join("")}</details>
      <div class="cg-acts"><button type="button" class="p-btn" data-act="accept">[ ACCEPT ]</button> <input data-note placeholder="NOTE IF REJECTING" aria-label="Note for the player"> <button type="button" class="p-btn" data-act="reject">[ REJECT WITH A NOTE ]</button></div></div>`).join("");
    api.fit(body);
  }

  // ---- input ----

  const items = () => {
    const name = STEPS[step];
    if (name === "class") return CLASSES;
    if (name === "skills") return view.skills.options.filter((o) => o.state === "open" || o.state === "taken").map((o) => o.name);
    return [];
  };
  function go(d) {
    if (d > 0 && !stepDone()) return;
    if (d > 0 && step === STEPS.length - 1) return send({ t: "cgSubmit" });
    if (d < 0 && step === 0) return leave();
    step += d;
    cursor = 0; typing = ""; err = ""; showFaces = false;
    const name = STEPS[step];
    if (name === "class" && view.className) cursor = CLASSES.indexOf(view.className);
    render();
  }
  function leave() { api.send({ t: "cgCancel" }); view = null; waiting = false; api.close(); }
  const current = () => (["stats", "saves", "health", "credits"].includes(STEPS[step]) ? STEPS[step] : "");

  function skillToggle(name) {
    const picked = view.skills.picked;
    set({ skills: picked.includes(name) ? picked.filter((x) => x !== name) : [...picked, name] });
  }
  function saveFields(root) {
    const patch = {};
    for (const el of root.querySelectorAll("[data-field]")) if (el.value !== view[el.dataset.field]) patch[el.dataset.field] = el.value;
    if (Object.keys(patch).length) {
      Object.assign(view, patch);
      api.send({ t: "cgSet", set: patch });
    }
  }

  function onClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b || !open()) return;
    const a = b.dataset.act, what = b.dataset.what;
    if (a === "accept" || a === "reject") {
      const card = b.closest(".cg-pend");
      return api.send({ t: a === "accept" ? "pilotCgAccept" : "pilotCgReject", id: card.dataset.id, note: card.querySelector("[data-note]").value });
    }
    if (a === "withdraw") return api.send({ t: "cgWithdraw" });
    if (!view) return;
    if (a === "roll") roll(what);
    else if (a === "type") { typing = typing === what ? "" : what; render(); }
    else if (a === "class") { cursor = CLASSES.indexOf(b.dataset.v); set({ className: b.dataset.v }); }
    else if (a === "choice") set({ choice: b.dataset.v });
    else if (a === "skill") { cursor = items().indexOf(b.dataset.v); skillToggle(b.dataset.v); }
    else if (a === "faces") {
      showFaces = !showFaces;
      if (showFaces && !faces) fetch("portraits/pack.json").then((r) => r.json()).catch(() => []).then((l) => { faces = l; render(); });
      render();
    } else if (a === "face") set({ portrait: b.dataset.v });
  }

  function onSubmit(e) {
    const f = e.target.closest(".cg-type");
    if (!f) return;
    e.preventDefault();
    const nums = $("cg-dice").value.split(/[\s,+]+/).filter(Boolean).map(Number);
    typing = "";
    roll(f.dataset.what, nums);
  }

  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    e.stopPropagation();
    const inField = e.target.matches("input, textarea");
    if (pending.length && isPilot) { if (e.key === "Escape" && !inField) api.close(); return; }
    if (!view && !waiting) return;
    if (e.key === "Escape") {
      e.preventDefault();
      if (typing) { typing = ""; return render(); }
      if (waiting) return api.close();
      if (inField) saveFields($("cg-body"));
      return go(-1);
    }
    if (e.key === "Enter") {
      if (e.target.closest(".cg-type") || e.target.matches("button:not(.cg-skill)")) return;
      e.preventDefault();
      if (inField) saveFields($("cg-body"));
      if (e.target.dataset.field === "name" && view.name) return $("cg-body").querySelector('[data-field="pronouns"]')?.focus();
      const r = current();
      if (!stepDone() && r) return roll(r);
      if (rolling) return;
      if (!inField && STEPS[step] === "skills" && !stepDone()) return;
      return go(1);
    }
    if (inField) return;
    const name = STEPS[step], k = e.key.toLowerCase();
    if (waiting || !view) return;
    if (k === "r" && current()) { e.preventDefault(); return roll(current()); }
    if (k === "t" && current()) { e.preventDefault(); typing = typing ? "" : current(); return render(); }
    if (name === "class") {
      if (/^[1-4]$/.test(k)) { e.preventDefault(); cursor = Number(k) - 1; return set({ className: CLASSES[cursor] }); }
      if (/^[a-d]$/.test(k) && (view.classes[view.className]?.minus || view.classes[view.className]?.plus)) { e.preventDefault(); return set({ choice: STAT_KEYS["abcd".indexOf(k)] }); }
    }
    if (name === "gear" && /^[1-3]$/.test(k)) { e.preventDefault(); return roll(["loadout", "trinket", "patch"][Number(k) - 1]); }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const n = items().length;
      if (!n) return;
      e.preventDefault();
      cursor = (cursor + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
      if (name === "class") set({ className: CLASSES[cursor] });
      else render();
    }
    if (name === "skills" && (e.key === " ") && items()[cursor]) { e.preventDefault(); skillToggle(items()[cursor]); }
  }

  function init(opts) {
    api = opts;
    $("chargen").addEventListener("keydown", onKey);
    $("chargen").addEventListener("click", onClick);
    $("chargen").addEventListener("submit", onSubmit);
    $("chargen").addEventListener("change", (e) => { if (e.target.matches("[data-field]") && view) saveFields($("cg-body")); });
    $("cg-back").onclick = () => { if (view) saveFields($("cg-body")); go(-1); };
    $("cg-next").onclick = () => { if (view) saveFields($("cg-body")); go(1); };
  }

  return { init, start, onMessage, onAccepted, setPending, render, isOpen: open };
})();
