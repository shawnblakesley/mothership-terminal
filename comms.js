import { findCast } from "./cast.js";
import { isAdversary, PICTURE_LINK } from "./voices.js";

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export function cleanComms(c) {
  if (!c || typeof c !== "object" || !clip(c.who, 60)) return null;
  return { who: clip(c.who, 60), ship: clip(c.ship, 80), transponder: clip(c.transponder, 120), since: Number(c.since) || Date.now(), cast: clip(c.cast, 60), adv: clip(c.adv, 60) };
}

export function openComms(config, { who, ship, transponder, cast, adv }) {
  const name = clip(who, 60);
  const member = cast ? config.cast.find((m) => m.id === cast) : findCast(config.cast, name);
  const v = member ? null : config.voices.find((x) => isAdversary(x) && (x.id === adv || (!cast && !adv && (x.id === name.toLowerCase() || x.name.toLowerCase() === name.toLowerCase()))));
  return cleanComms({ who: member?.name || v?.name || name, ship, transponder, since: Date.now(), cast: member?.name, adv: v?.id });
}

export function commsView(comms, config, pictureSrc = (p) => p) {
  const k = cleanComms(comms);
  if (!k) return null;
  const member = k.cast ? config.cast.find((m) => m.name === k.cast) : null;
  const v = k.adv ? config.voices.find((x) => x.id === k.adv && isAdversary(x)) : null;
  const pic = member?.portrait ? { portrait: member.portrait } : v?.adversary.picture && v.adversary.revealed ? { src: PICTURE_LINK.test(v.adversary.picture) ? v.adversary.picture : pictureSrc(v.adversary.picture), credit: v.adversary.credit || "" } : null;
  return { who: v && !v.adversary.revealed ? "???" : k.who, ship: k.ship, transponder: k.transponder, since: k.since, match: { character: v ? "" : k.cast || k.who, entity: v?.id || "" }, pic };
}
