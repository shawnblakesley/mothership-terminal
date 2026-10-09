import { rollTable, randInt } from "./dice.js";

export const WOUND_TYPES = ["blunt", "bleeding", "gunshot", "fire", "gore"];
export const WOUND_LABELS = { blunt: "Blunt Force", bleeding: "Bleeding", gunshot: "Gunshot", fire: "Fire & Explosives", gore: "Gore & Massive" };
export const SEVERITY = ["Flesh Wound", "Minor Injury", "Minor Injury", "Minor Injury", "Minor Injury", "Major Injury", "Major Injury", "Lethal Injury", "Lethal Injury", "Fatal Injury"];

const r = (text, fx = {}) => ({ text, ...fx });
const bleed = (n) => ({ bleed: n });
const SCAR = { minStress: 1 };
const LETHAL = { deathSaveIn: "1d10 rounds" };

// PSG 29 in the app's own words: one column per damage type, rows 0-9 (a d10).
export const WOUNDS = {
  blunt: [
    r("Knocked down."), r("Winded: [-] until they catch their breath."), r("Sprained ankle: [-] on Speed Checks."), r("Concussion: [-] on mental tasks."), r("Leg or foot broken: [-] on Speed Checks."),
    r("Arm or hand broken: [-] on manual tasks."), r("Collarbone snapped: [-] on Strength Checks."), r("Back broken: [-] on all rolls.", LETHAL), r("Skull fracture: [-] on all rolls.", LETHAL), r("Spine or neck broken.", { deathSave: true }),
  ],
  bleeding: [
    r("Drops whatever they were holding."), r("Lots of blood: Close crewmembers +1 Stress."), r("Blood in the eyes: [-] until wiped clean."), r("Laceration.", bleed(1)), r("Major cut.", bleed(2)),
    r("Fingers or toes severed.", bleed(3)), r("Hand or foot severed.", bleed(4)), r("Limb severed.", { ...bleed(5), ...LETHAL }), r("Major artery cut.", { ...bleed(6), ...LETHAL }), r("Throat slit or heart pierced.", { deathSave: true }),
  ],
  gunshot: [
    r("Grazed and knocked down."), r("Bleeding.", bleed(1)), r("Broken rib."), r("Fractured extremity."), r("Internal bleeding.", bleed(2)),
    r("Bullet lodged: surgery required."), r("Gunshot wound to the neck."), r("Major blood loss.", { ...bleed(4), ...LETHAL }), r("Sucking chest wound.", { ...bleed(5), ...LETHAL }), r("Headshot.", { deathSave: true }),
  ],
  fire: [
    r("Hair burnt: +1d5 Stress.", { stress: "1d5" }), r("Awesome scar: Minimum Stress +1.", SCAR), r("Singed: [-] on next action."), r("Shrapnel or a large burn."), r("Extensive burns: Strength -1d10.", { stat: { strength: "-1d10" } }),
    r("Major burn: Body Save -2d10.", { save: { body: "-2d10" } }), r("Skin grafts required: Body Save -2d10.", { save: { body: "-2d10" } }), r("Limb on fire: 2d10 Damage per round.", { burn: "2d10", ...LETHAL }), r("Body on fire: 3d10 Damage per round.", { burn: "3d10", ...LETHAL }), r("Engulfed in a fiery explosion.", { deathSave: true }),
  ],
  gore: [
    r("Vomits: [-] on next action."), r("Awesome scar: Minimum Stress +1.", SCAR), r("Digit mangled."), r("Eyes gouged out."), r("Flesh ripped off: Strength -1d10.", { stat: { strength: "-1d10" } }),
    r("Paralysed from the waist down."), r("Limb severed.", bleed(5)), r("Impaled.", { ...bleed(6), ...LETHAL }), r("Guts spooled on the floor.", { ...bleed(7), ...LETHAL }), r("Head explodes: dead, no Death Save.", { dead: true }),
  ],
};
// Row 1 of Bleeding adds Stress to the Close crewmembers; the app only notes it for the Warden.
// Rows 7-8 are Lethal: a Death Save in 1d10 rounds unless dealt with.

// One Wounds Table roll. adv "+" / "-": two d10, keep the higher / lower row (this app's reading of a weapon's [+] / [-]).
export function rollWound(type, adv = "", rng = randInt) {
  const col = WOUNDS[type] ? type : "blunt";
  const d = rollTable(adv, rng);
  return { type: col, adv, roll: d.value, all: d.all, severity: SEVERITY[d.value], ...WOUNDS[col][d.value] };
}

const pad = (n) => String(n).padStart(2, "0");
export const woundText = (w) => `${WOUND_LABELS[w.type].toUpperCase()}${w.adv ? ` [${w.adv}]` : ""} WOUND TABLE: ROLLED ${w.adv ? `${w.all.join(" / ")}, KEPT THE ${w.adv === "+" ? "HIGHER" : "LOWER"} ROW: ` : ""}${pad(w.roll)}, ${w.severity.toUpperCase()}. ${w.text}`;
