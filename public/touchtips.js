// Hover tooltips (title attributes, SVG <title>) have no touch equivalent: a long press shows the same text in a small bubble.
export function tipText(el) {
  for (let e = el, n = 0; e && n < 8; e = e.parentElement, n++) {
    const t = (e.getAttribute?.("title") || "").trim();
    if (t) return t;
    const svg = [...(e.children || [])].find((c) => c.localName === "title");
    if (svg?.textContent.trim()) return svg.textContent.trim();
  }
  return "";
}

export function install(doc = document, { delay = 450, show = 6000 } = {}) {
  let timer, hide, from = null, fired = false;
  const bubble = doc.createElement("div");
  bubble.className = "touchtip";
  bubble.setAttribute("role", "status");
  bubble.hidden = true;
  doc.body.append(bubble);
  const close = () => { clearTimeout(hide); bubble.hidden = true; };
  const open = (text, x, y) => {
    bubble.textContent = text;
    bubble.hidden = false;
    const w = bubble.offsetWidth, h = bubble.offsetHeight, vw = doc.documentElement.clientWidth;
    bubble.style.left = `${Math.max(8, Math.min(vw - w - 8, x - w / 2))}px`;
    bubble.style.top = `${y - h - 18 < 8 ? y + 22 : y - h - 18}px`;
    clearTimeout(hide);
    hide = setTimeout(close, show);
  };
  const cancel = () => { clearTimeout(timer); timer = 0; };
  doc.addEventListener("pointerdown", (e) => {
    cancel();
    if (!bubble.hidden && !bubble.contains(e.target)) close();
    if (e.pointerType !== "touch") return;
    fired = false;
    from = { x: e.clientX, y: e.clientY };
    const target = e.target;
    timer = setTimeout(() => {
      const text = tipText(target);
      if (!text) return;
      fired = true;
      open(text, from.x, from.y);
    }, delay);
  }, true);
  doc.addEventListener("pointermove", (e) => { if (timer && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 10) cancel(); }, true);
  for (const t of ["pointerup", "pointercancel"]) doc.addEventListener(t, cancel, true);
  doc.addEventListener("click", (e) => { if (fired) { fired = false; e.preventDefault(); e.stopPropagation(); } }, true);
  doc.addEventListener("contextmenu", (e) => { if (timer || fired) e.preventDefault(); }, true);
}
