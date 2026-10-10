// The short form of a character's name for the MSG list, the /msg command and the station columns: a quoted nickname, else the first word that is not a title (Dr., Capt., Sgt.).
// If two crew would share it, the full name is used for both.
(() => {
  const TITLE = /^(dr|mr|mrs|ms|mx|capt|cpt|captain|sgt|sergeant|lt|lieutenant|cmdr|commander|col|colonel|maj|major|prof|professor|sir|ser|chief|pvt|cpl)\.?$/i;
  const base = (name) => {
    const n = String(name ?? "");
    const nick = n.match(/["'“‘]([^"'”’]+)["'”’]/)?.[1];
    if (nick) return nick.toUpperCase();
    const words = n.split(/\s+/).filter(Boolean);
    return (words.find((w) => !TITLE.test(w)) || words[0] || "").toUpperCase();
  };
  globalThis.crewShort = (name, all = []) => {
    const b = base(name);
    const clash = all.some((o) => o !== name && base(o) === b);
    return clash ? String(name).replace(/["“”]/g, "").trim().toUpperCase() : b;
  };
})();
