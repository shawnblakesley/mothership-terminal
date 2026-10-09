// Ship-to-ship combat screens: the Warden's Ship fight panel, the rig's ship block in the campaign Overview, and the players' compact readout.
// Rules: Shipbreaker's Toolkit via a secondary summary. Everything marked "house rule" is this campaign's own.
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const CLS = ["0", "I", "II", "III", "IV", "V"];
  const cap = (w) => (w ? w[0].toUpperCase() + w.slice(1) : "");
  const HOUSE = '<span class="house" title="A campaign house rule, not Mothership rules">house rule</span>';
  const RANGE_NOTES = {
    detection: "Detection: same system. Trajectory, rough size, transponder. Railguns only. Comms latency minutes to hours.",
    firing: "Firing: planet to moon. Ship class and type. All weapons. Comms latency seconds.",
    contact: "Contact: close orbit. Lifeforms aboard, ship status. Boarding. No latency.",
  };
  const ui = { enemyMove: "", enemyFuel: 2, crewMove: "", crewFuel: 2, startShip: "", startRange: "firing", how: "", fitName: "", fitBattle: 30, fitRange: "firing", pMove: "", pFuel: 2, custom: { name: "", class: 1, thrusters: 40, battle: 40, systems: 40, hull: 2, armed: true, railgun: false } };

  const effectText = (e) => (e ? `${e.name}: ${e.rule}` : "");
  const status = (st) => (!st ? "" : !st.checks ? `no attack (${st.why})` : st.autoFail ? `Battle check automatically fails (${st.why})` : `Battle check${st.adv ? ` [${st.adv}]` : ""}${st.why ? ` (${st.why})` : ""}`);

  function shipCard(x) {
    return `<div class="bcard ${x.side === "crew" ? "shipcrew" : "shipfoe"}">
      <div class="row"><b class="grow">${esc(x.name)}</b><span class="pill">Class ${CLS[x.class]}${x.kind ? ` · ${esc(x.kind)}` : ""}</span></div>
      <div class="small mono">Thrusters ${x.thrusters} · Battle ${x.battle} · Systems ${x.systems} ${HOUSE}</div>
      <div class="small mono"><b>Hull ${x.hull}/${x.hullMax} · MDMG ${x.mdmg}</b>${x.effect ? ` <span class="bad">${esc(x.effect.name)}</span>` : ""}</div>
      ${x.effect ? `<div class="small muted">${esc(x.effect.rule)}</div>` : ""}
      <div class="small">${x.weapons.length ? `Weapons: ${x.weapons.map((w) => `${esc(w.name)} (${w.range === "detection" ? "Detection range" : "Firing range"}, 1d5 ${HOUSE.replace("house rule", "hit, house rule")})`).join(", ")}` : "Unarmed: her Battle checks automatically fail."}${x.owed ? ` <span class="bad">Not resupplied (${x.owed} fight${x.owed > 1 ? "s" : ""}): ${x.owed > 1 ? "Battle checks automatically fail" : "[-] on Battle checks"}.</span>` : ""}</div>
      ${x.fuel !== undefined ? `<div class="small">Fuel ${x.fuel}</div>` : ""}
      <div class="small muted">This round: ${esc(status(x.status))}</div>
    </div>`;
  }

  const moveSelect = (id, value, extra = "") => `<select id="${id}" ${extra}><option value="">Choose…</option>${["maintain", "evade", "pursue"].map((m) => `<option value="${m}" ${value === m ? "selected" : ""}>${m === "maintain" ? "Maintain Course" : cap(m)}</option>`).join("")}</select>`;

  function fightHtml(d, S) {
    const f = d.fight;
    const rig = f.ships.find((x) => x.side === "crew"), foe = f.ships.find((x) => x.side === "enemy");
    const crew = S.config.crew.filter((pc) => !pc.cond?.dead && !pc.retired);
    const st = (id) => f.stations[id] || "";
    const stationRow = crew.map((pc) => `<label class="small grow">${esc(pc.name.split(" ")[0])} <select data-ship-station="${esc(pc.id)}">${["", "pilot", "gunner", "engineer"].map((s) => `<option value="${s}" ${st(pc.id) === s ? "selected" : ""}>${s ? cap(s) : "No station"}</option>`).join("")}</select></label>`).join("");
    const skillFor = (station, who) => {
      const pc = crew.find((c) => c.name === who);
      const list = pc ? f.crewSkills[pc.id] || [] : [];
      const cur = f.skills[station] ?? (station === "pilot" ? "Piloting" : station === "gunner" ? "Firearms" : "");
      return `<label class="small grow">${cap(station)}: ${esc(who || "nobody")} <select data-ship-skill="${station}"><option value="">No skill</option>${list.map((k) => `<option ${k === cur ? "selected" : ""}>${esc(k)}</option>`).join("")}</select></label>`;
    };
    const cm = f.moves.crew, em = f.moves.enemy;
    const wait = f.waiting ? `<div class="row"><span class="small grow"><span class="spinner"></span>Waiting for ${esc(f.waiting.kind === "movement" ? "the Thrusters" : f.waiting.kind === "attack" ? "the Battle" : "the Systems")} check on a player's screen.</span><button data-ship-act="cancel" class="ghost">Cancel step</button></div>` : "";
    const done = f.ended;
    const movedNow = f.movedRound === f.round, attackedNow = f.attackedRound === f.round;
    return `<div class="row wrap"><b class="grow">Round ${f.round} · ${done ? "fight over" : "range"} ${done ? "" : `<select data-ship-range class="inl">${["detection", "firing", "contact"].map((r) => `<option value="${r}" ${f.range === r ? "selected" : ""}>${cap(r)}</option>`).join("")}</select>`}</b>
        ${done ? '<button data-ship-act="clear">Clear</button>' : `<input id="shipHow" class="inl" placeholder="how it ended" value="${esc(ui.how)}" maxlength="100"><button data-ship-act="end" class="danger" title="Ends the fight: weapons owe a resupply, and a ship that took MDMG makes a Systems check">End fight</button>`}</div>
      <div class="small muted">${esc(RANGE_NOTES[f.range])}</div>
      ${done && f.afterDue ? '<div class="row"><span class="small grow">After the battle the rig makes a Systems check (Shipbreaker\'s Toolkit); a failure rolls Maintenance Issues (house rule table).</span><button data-ship-act="systems" class="primary">Systems check due (Engineer)</button></div>' : ""}
      ${f.unwinnable ? '<div class="small bad"><b>Unwinnable head-on:</b> the enemy is two or more classes above the rig. The only options are flight, surrender or a trick; the crew make no Battle checks.</div>' : ""}
      ${f.hails?.length ? `<div class="small bad"><b>Morale:</b> ${f.hails.map((h) => esc(f.ships.find((x) => x.id === h.ship)?.name || "the enemy")).join(", ")} hails, offering a ceasefire or to talk. The agent voices it.</div>` : ""}
      ${f.boarding ? '<div class="small"><b>Boarding:</b> crew combat has taken over (Combat card, below).</div>' : ""}
      ${shipCard(rig)}${shipCard(foe)}
      ${done ? "" : `<h3 class="cmph">Crew stations</h3><div class="row wrap">${stationRow}</div>
      <div class="row wrap">${skillFor("pilot", f.pilot)}${skillFor("gunner", f.gunner)}${skillFor("engineer", f.engineer)}</div>
      <h3 class="cmph">1. Movement</h3>
      <div class="small muted">Each side secretly chooses. Maintain Course spends no fuel and the other side automatically succeeds. Evade needs ${d.evadeMin.contact} fuel at Contact, ${d.evadeMin.firing} at Firing, ${d.evadeMin.detection} at Detection. Whoever spends more has [+] on the Thrusters check. 1 rules fuel = 1 rig fuel unit ${HOUSE}. The rig has ${d.fuel}.</div>
      <div class="row wrap"><label class="small grow">The crew's course ${moveSelect("shipCrewMove", ui.crewMove || cm?.move || "")}</label><label class="small">Fuel <input id="shipCrewFuel" type="number" min="0" max="20" value="${ui.crewFuel}" style="width:4em"></label><button data-ship-act="crewMove" class="ghost" title="Normally the Pilot sets this on their screen">Set for them</button></div>
      <div class="small">${cm ? `Crew: <b>${cm.move}</b>${cm.spend ? `, ${cm.spend} fuel` : ""}` : "Crew: not chosen yet"}</div>
      <div class="row wrap"><label class="small grow">${esc(foe.name)}'s move ${moveSelect("shipEnemyMove", ui.enemyMove || em?.move || "")}</label><label class="small">Fuel <input id="shipEnemyFuel" type="number" min="0" max="20" value="${ui.enemyFuel}" style="width:4em"></label><button data-ship-act="enemyMove">Set</button><button data-ship-act="agentPicks" class="ghost" title="Ask the agent to pick the enemy's move this round">Agent picks</button></div>
      <div class="small">${em ? `Enemy: <b>${em.move}</b>${em.spend ? `, ${em.spend} fuel` : ""}` : "Enemy: not chosen yet"}</div>
      <div class="row"><button data-ship-act="movement" class="primary" ${!cm || !em || f.waiting || movedNow ? "disabled" : ""}>${movedNow ? "Movement resolved" : "Resolve movement"}</button></div>
      <h3 class="cmph">2. Attack and morale</h3>
      <div class="small muted">Every ship within Firing range makes a Battle check (at Detection only a railgun). Critical Failure: +2 MDMG to itself; failure +1; success deals 1d5 ${HOUSE}; Critical Success double. Then Hull is subtracted, and Hull drops 1 if the damage was at or above it. An unarmed ship automatically fails. Then 1d10 for any enemy that took MDMG: under its MDMG, it hails.</div>
      <div class="row"><button data-ship-act="attack" class="primary" ${f.waiting || attackedNow ? "disabled" : ""}>Resolve attack and morale</button></div>
      <div class="row wrap"><button data-ship-act="systems" ${f.waiting ? "disabled" : ""} title="The Engineer rolls a Systems check (damage control)">Systems check (Engineer)</button><button data-ship-act="board" ${f.range === "contact" && !f.boarding ? "" : "disabled"} title="Boarding needs Contact range; it hands over to crew combat">Board (Contact)</button></div>`}
      ${wait}
      ${f.log.length ? `<details><summary>Round log</summary><ul class="small shiplog">${f.log.slice(-10).reverse().map((l) => `<li>${esc(l)}</li>`).join("")}</ul></details>` : ""}`;
  }

  function startHtml(d) {
    const c = ui.custom;
    return `<div class="small muted">Starts a fight between the rig and a ship from this story${d.available.length ? "" : " (none are written for it: use a custom ship)"}.</div>
      <div class="row wrap"><label class="small grow">Ship <select id="shipStart"><option value="">Choose…</option>${d.available.map((x) => `<option value="${esc(x.id)}" ${ui.startShip === x.id ? "selected" : ""}>${esc(x.name)} (Class ${CLS[x.class]})</option>`).join("")}</select></label>
        <label class="small">Range <select id="shipStartRange">${["detection", "firing", "contact"].map((r) => `<option value="${r}" ${ui.startRange === r ? "selected" : ""}>${cap(r)}</option>`).join("")}</select></label>
        <button data-ship-act="start" class="primary">Start fight</button></div>
      <details><summary>Custom ship</summary><div class="small muted">Your own numbers (stats 1-99, the same scale as character stats ${HOUSE}).</div>
        <div class="rollgrid"><label>Name <input data-ship-custom="name" value="${esc(c.name)}"></label>
        ${[["class", "Class 0-5"], ["thrusters", "Thrusters"], ["battle", "Battle"], ["systems", "Systems"], ["hull", "Hull"]].map(([k, l]) => `<label>${l} <input type="number" data-ship-custom="${k}" value="${c[k]}"></label>`).join("")}</div>
        <label class="row small"><input type="checkbox" data-ship-custom="armed" ${c.armed ? "checked" : ""} style="width:auto"> A weapon at Firing range</label>
        <label class="row small"><input type="checkbox" data-ship-custom="railgun" ${c.railgun ? "checked" : ""} style="width:auto"> A railgun (Detection range)</label>
        <div class="row"><button data-ship-act="startCustom">Start with this ship</button></div></details>`;
  }

  function warden(root, S, send) {
    const d = S.ships;
    root.hidden = !d;
    if (!d) return;
    const key = JSON.stringify([d, S.roll?.status, S.roll?.id]);
    if (root.__key === key) return;
    root.__key = key;
    const keep = document.activeElement && root.contains(document.activeElement) ? document.activeElement.id || document.activeElement.dataset?.shipCustom : "";
    root.innerHTML = `${d.fight ? fightHtml(d, S) : startHtml(d)}
      <div class="row wrap"><button data-ship-act="distress" title="Rolls the response-time table. The Rim counts as an outer system, +1 step; the Dark Lane as isolated, +2 steps (house rules).">Send distress signal</button><span class="small muted">The Rim is an outer system (+${d.distressSteps} step${d.distressSteps > 1 ? "s" : ""}) ${HOUSE}</span></div>
      <details><summary>Rules and house rules</summary><ul class="small">
        <li><b>From the Shipbreaker's Toolkit (via a secondary summary, not the book):</b> Thrusters, Battle and Systems are rolled like Stats; a failed ship check gives all crew 1 Stress, a Critical Failure a Panic Check each. Ranges, the movement choices, Battle checks and MDMG, Hull, the MDMG effects 1-9, morale, class advantage, resupplying weapons, repairs and the distress table.</li>
        <li><b>House rules:</b> the ship numbers; a hit deals 1d5; 1 fuel = 1 rig fuel unit; Maintenance Issues; resupply at 1 kcr a weapon; the patch job (20 kcr); the distress modifiers for the Rim and the Dark Lane; how the app runs effects 4-9 on the people aboard.</li></ul></details>`;
    if (keep) root.querySelector(`#${CSS.escape(keep)}, [data-ship-custom="${keep}"]`)?.focus?.();
  }

  const sel = (root, q) => root.querySelector(q);
  function wire(root, S, send) {
    if (root.__wired) return;
    root.__wired = true;
    root.addEventListener("input", (e) => {
      const t = e.target;
      if (t.id === "shipEnemyFuel") ui.enemyFuel = Number(t.value) || 0;
      else if (t.id === "shipCrewFuel") ui.crewFuel = Number(t.value) || 0;
      else if (t.id === "shipHow") ui.how = t.value;
      else if (t.dataset.shipCustom) ui.custom[t.dataset.shipCustom] = t.type === "checkbox" ? t.checked : t.type === "number" ? Number(t.value) : t.value;
    });
    root.addEventListener("change", (e) => {
      const t = e.target;
      if (t.id === "shipEnemyMove") ui.enemyMove = t.value;
      else if (t.id === "shipCrewMove") ui.crewMove = t.value;
      else if (t.id === "shipStart") ui.startShip = t.value;
      else if (t.id === "shipStartRange") ui.startRange = t.value;
      else if (t.dataset.shipStation) send({ t: "shipStation", pc: t.dataset.shipStation, station: t.value });
      else if (t.dataset.shipSkill) { send({ t: "shipSkill", station: t.dataset.shipSkill, skill: t.value }); }
      else if (t.matches("[data-ship-range]")) send({ t: "shipRange", range: t.value });
    });
    root.addEventListener("click", (e) => {
      const act = e.target.closest("[data-ship-act]")?.dataset.shipAct;
      if (!act) return;
      const fuel = (id) => Number(sel(root, id)?.value) || 0;
      const moveOf = (id) => sel(root, id)?.value;
      switch (act) {
        case "start": return ui.startShip && send({ t: "shipStart", ship: ui.startShip, range: ui.startRange });
        case "startCustom": { const c = ui.custom; return c.name.trim() && send({ t: "shipStart", range: ui.startRange, custom: { id: "custom", name: c.name, class: c.class, thrusters: c.thrusters, battle: c.battle, systems: c.systems, hull: c.hull, weapons: [...(c.armed ? [{ name: "Weapon", range: "firing" }] : []), ...(c.railgun ? [{ name: "Railgun", range: "detection" }] : [])] } }); }
        case "crewMove": return moveOf("#shipCrewMove") && send({ t: "shipCrewMove", move: moveOf("#shipCrewMove"), fuel: fuel("#shipCrewFuel") });
        case "enemyMove": return moveOf("#shipEnemyMove") && send({ t: "shipEnemyMove", move: moveOf("#shipEnemyMove"), fuel: fuel("#shipEnemyFuel") });
        case "end": send({ t: "shipEnd", how: ui.how }); ui.how = ""; return;
        default: return send({ t: `ship${cap(act)}` });
      }
    });
    root.__S = S;
  }

  // The rig as a ship, for the campaign Overview.
  function rig(S) {
    const d = S.ships;
    if (!d) return "";
    const r = d.rig;
    const port = d.port;
    const dis = port ? "" : "disabled";
    const why = port ? "" : ' title="Finish the story being played first: this needs a port"';
    return `<details open class="shiprig"><summary>The rig as a ship <span class="muted small">(Shipbreaker's Toolkit via a summary; the numbers are house rules)</span></summary>
      <div class="bcard"><div class="row wrap"><b class="grow">${esc(r.name)}</b><span class="pill">Class ${CLS[r.class]}${r.kind ? ` · ${esc(r.kind)}` : ""}</span></div>
        <div class="small mono">Thrusters ${r.thrusters} · Battle ${r.battle} · Systems ${r.systems} ${HOUSE}</div>
        <div class="small mono"><b>Hull ${r.hull}/${r.hullMax} · MDMG ${r.mdmg}</b>${r.effect ? ` ${esc(r.effect.name)}` : ""}</div>
        <div class="small">${r.weapons.length ? `Weapons: ${r.weapons.map((w) => esc(w.name)).join(", ")}` : "Unarmed: her Battle checks automatically fail unless the crew fit a weapon."}${r.owed ? ` <span class="bad">Weapons not resupplied (${r.owed} fight${r.owed > 1 ? "s" : ""}).</span>` : ""}</div>
        <div class="small">${r.issues?.length ? `Maintenance Issues ${HOUSE}: ${r.issues.map((n, i) => `${esc(n)} <button class="small ghost" data-ship="minor" data-i="${i}" ${dis}>Minor repair (2d10 days)</button>`).join(" · ")}` : "No Maintenance Issues."}</div></div>
      <div class="row wrap">
        <button data-ship="resupply" ${dis} ${r.weapons.length ? "" : "disabled"}${why}>Resupply weapons (${(d.resupplyCost * Math.max(1, r.weapons.length)) / 1000} kcr, house rule)</button>
        <button data-ship="patch" ${dis} ${r.mdmg ? "" : "disabled"}${why} title="House rule: removes 1 MDMG for 20 kcr; the rig keeps a Maintenance Issue">Patch job (-1 MDMG, ${d.patchCost / 1000} kcr, house rule)</button>
        <button data-ship="major" ${dis} ${r.mdmg || r.hull < r.hullMax ? "" : "disabled"}${why} title="Shipbreaker's Toolkit: major repairs (MDMG and Hull) need a port and cost 1d5 mcr x the ship's class">Major repairs (1d5 mcr x class ${CLS[r.class]})</button></div>
      <div class="row wrap"><label class="small grow">Fit a weapon <input data-ship-fit="name" placeholder="name" value="${esc(ui.fitName)}"></label><label class="small">Battle <input data-ship-fit="battle" type="number" min="1" max="99" style="width:4.5em" value="${ui.fitBattle}"></label>
        <label class="small">Range <select data-ship-fit="range"><option value="firing">Firing</option><option value="detection">Detection (railgun)</option></select></label>
        <button data-ship="fit">Fit</button>${r.weapons.length ? '<button data-ship="unfit" class="ghost">Remove weapons</button>' : ""}</div>
      <div class="small muted">Fitting a weapon gives the rig a Battle stat of your choosing (house rule: she is Battle ${r.battle} and unarmed otherwise). Weapons must be resupplied after every fight; without it the next fight's Battle checks are at [-], then automatically fail.</div>
    </details>`;
  }
  async function rigClick(el, S, send, sure) {
    const root = el.closest(".shiprig");
    const a = el.dataset.ship;
    const field = (k) => root.querySelector(`[data-ship-fit="${k}"]`)?.value;
    if (a === "minor") return send({ t: "shipMinor", issue: Number(el.dataset.i) });
    if (a === "resupply") return send({ t: "shipResupply" });
    if (a === "patch") return (await sure("Patch job?", "House rule: removes 1 MDMG for 20 kcr, and the rig keeps a Maintenance Issue. The Warden takes the credits.", "Patch", "primary")) && send({ t: "shipPatch" });
    if (a === "major") return (await sure("Major repairs?", "Shipbreaker's Toolkit (via a summary): major repairs of MDMG and Hull need a port and cost 1d5 mcr x the ship's class. That is ruinous for a trucker. The cost is rolled now and the Warden takes the credits.", "Repair", "danger")) && send({ t: "shipMajor" });
    if (a === "fit") { ui.fitName = field("name"); ui.fitBattle = Number(field("battle")) || 0; return send({ t: "shipFit", name: field("name"), battle: Number(field("battle")), range: field("range") }); }
    if (a === "unfit") return send({ t: "shipFit", remove: true });
  }

  // The players' compact readout and station controls.
  function player(root, ship, me, send) {
    root.hidden = !ship;
    if (!ship) { root.innerHTML = ""; return; }
    const r = ship.rig, e = ship.enemy;
    const mineStation = me ? ship.stations[me.id] || "" : "";
    const enemy = !e ? "" : e.name
      ? `${esc(e.name.toUpperCase())}${e.class !== undefined ? ` CLASS ${CLS[e.class]}${e.kind ? ` ${esc(e.kind.toUpperCase())}` : ""}` : ""}${e.captain ? ` · CAPT ${esc(e.captain.toUpperCase())}` : ""}${e.homePort ? ` · HOME ${esc(e.homePort.toUpperCase())}` : ""}${e.hull !== undefined ? ` · HULL ${e.hull} MDMG ${e.mdmg}` : ""}`
      : e.class !== undefined ? `UNIDENTIFIED SHIP CLASS ${CLS[e.class]}${e.kind ? ` ${esc(e.kind.toUpperCase())}` : ""}` : "UNIDENTIFIED CONTACT: TRAJECTORY AND ROUGH SIZE ONLY";
    const canSteer = me && !ship.ended && (!ship.pilot || ship.pilot === me.id);
    const mv = ship.move;
    root.innerHTML = `<div class="shipline"><span><b>SHIP ${ship.ended ? "FIGHT OVER" : `ROUND ${ship.round}`}</b> · RANGE ${ship.range.toUpperCase()} · ${esc(r.name.toUpperCase())} HULL ${r.hull}/${r.hullMax} MDMG ${r.mdmg}${r.effect ? ` (${esc(r.effect.toUpperCase())})` : ""} · FUEL ${r.fuel}</span></div>
      ${enemy ? `<div class="shipline">CONTACT: ${enemy}</div>` : ""}
      ${ship.unwinnable ? '<div class="shipline shipbad">THEY CAN\'T BE BEATEN HEAD-ON: FLIGHT, SURRENDER OR A TRICK</div>' : ""}
      ${ship.hailed ? '<div class="shipline shipbad">INCOMING HAIL: THE OTHER SHIP OFFERS A CEASEFIRE OR TO TALK</div>' : ""}
      ${ship.boarding ? '<div class="shipline shipbad">BOARDERS ON THE RIG</div>' : ""}
      ${me && !ship.ended ? `<div class="shipline">STATION: ${["pilot", "gunner", "engineer", ""].map((s) => `<button type="button" data-ship-st="${s}" aria-pressed="${mineStation === s}">${s ? s.toUpperCase() : "NONE"}</button>`).join("")}</div>` : ""}
      ${canSteer ? `<div class="shipline">COURSE: ${["maintain", "evade", "pursue"].map((m) => `<button type="button" data-ship-mv="${m}" aria-pressed="${(ui.pMove || mv?.move) === m}">${m === "maintain" ? "MAINTAIN COURSE" : m.toUpperCase()}</button>`).join("")} FUEL <input type="number" min="0" max="20" id="ship-fuel" value="${ui.pFuel}" aria-label="Fuel to spend"> <button type="button" data-ship-set>SET COURSE</button> <span class="shipdim">EVADE NEEDS ${ship.evadeMin}+</span></div>` : ""}
      ${mv ? `<div class="shipline">COURSE SET: ${mv.move.toUpperCase()}${mv.spend ? ` · ${mv.spend} FUEL` : ""}</div>` : ""}`;
    if (!root.__wired) {
      root.__wired = true;
      root.addEventListener("click", (ev) => {
        const st = ev.target.closest("[data-ship-st]");
        if (st) return send({ t: "shipStation", station: st.dataset.shipSt });
        const m = ev.target.closest("[data-ship-mv]");
        if (m) { ui.pMove = m.dataset.shipMv; return root.querySelectorAll("[data-ship-mv]").forEach((b) => b.setAttribute("aria-pressed", String(b === m))); }
        if (ev.target.closest("[data-ship-set]")) { const mvv = ui.pMove || "maintain"; send({ t: "shipMove", move: mvv, fuel: Number(root.querySelector("#ship-fuel")?.value) || 0 }); ui.pMove = ""; }
      });
      root.addEventListener("input", (ev) => { if (ev.target.id === "ship-fuel") ui.pFuel = Number(ev.target.value) || 0; });
    }
  }

  window.ShipUI = { warden: (root, S, send) => { wire(root, S, send); warden(root, S, send); }, rig, rigClick, player };
})();
