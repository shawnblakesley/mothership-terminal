// What a panicking player's own screen is told. Presentation only: nothing here touches Stress, stats or conditions.

// The Panic Table numbers to play, in order. Compounding Problems (18) rolls two more; they are named in the entry's
// title as "7: Nightmares", so they are read back from there. Anything unreadable falls back to the bare 18 treatment.
export function panicSequence(used, name = "") {
  const n = Number(used);
  if (!Number.isInteger(n) || n < 1 || n > 20) return [];
  if (n !== 18) return [n];
  const more = [...String(name).matchAll(/\b(\d{1,2}): /g)].map((m) => Number(m[1])).filter((d) => d >= 1 && d <= 20 && d !== 18).slice(0, 2);
  return more.length ? more : [18];
}

// The message for the panicking player. Only a picture address ever travels: never an adversary's name, revealed or not.
export function panicMessage({ used, name, android = false, picture = "" }) {
  const seq = panicSequence(used, name);
  if (!seq.length) return null;
  return { t: "panicFx", role: "self", seq, ...(android ? { android: true } : {}), ...(picture ? { vision: picture } : {}) };
}

// A Close crewmember's screen only flickers when someone Jumpy goes off.
export const nearMessage = (seq) => (seq.includes(3) ? { t: "panicFx", role: "near", seq: [3] } : null);
