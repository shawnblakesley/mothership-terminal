// Handout Markdown -> HTML for the player DOCS panel.
const escH = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function mdInline(s) {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/__(.+?)__/g, "<u>$1</u>")
    .replace(/~~(.+?)~~/g, "<s>$1</s>")
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, "$1<i>$2</i>")
    .replace(/(^|[^_\w])_(?!\s)(.+?)_(?!\w)/g, "$1<i>$2</i>");
}

const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function renderMd(text) {
  const out = [];
  const stack = []; // open lists: { tag, indent }
  const closeTo = (n) => { while (stack.length > n) out.push(`</li></${stack.pop().tag}>`); };
  const lines = escH(text).split("\n").map((l) => l.trimEnd().replace(/\t/g, "  "));
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    const item = /^\s*(-{3,}|\*{3,})\s*$/.test(line) ? null : line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      const indent = item[1].length, tag = /\d/.test(item[2]) ? "ol" : "ul";
      while (stack.length && indent < stack[stack.length - 1].indent) closeTo(stack.length - 1);
      const top = stack[stack.length - 1];
      if (top && indent === top.indent && top.tag !== tag) closeTo(stack.length - 1);
      const cur = stack[stack.length - 1];
      if (!cur || indent > cur.indent) { out.push(`<${tag}>`); stack.push({ tag, indent }); }
      else out.push("</li>");
      out.push(`<li>${mdInline(item[3])}`);
      continue;
    }
    closeTo(0);
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) out.push(`<div class="md-h md-h${m[1].length}">${mdInline(m[2])}</div>`);
    else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) out.push('<div class="md-hr"></div>');
    else if ((m = line.match(/^\s*&gt;\s?(.*)$/))) out.push(`<div class="md-q">${mdInline(m[1])}</div>`);
    else if (isRow(line)) {
      const rows = [];
      for (; i < lines.length && isRow(lines[i]); i++) if (!/^[\s|:-]+$/.test(lines[i])) rows.push(cells(lines[i]));
      i--;
      out.push(`<table class="md-t">${rows.map((r, n) => `<tr>${r.map((c) => `<${n ? "td" : "th"}>${mdInline(c)}</${n ? "td" : "th"}>`).join("")}</tr>`).join("")}</table>`);
    }
    else if (!line.trim()) out.push('<div class="md-gap"></div>');
    else out.push(`<div>${mdInline(line)}</div>`);
  }
  closeTo(0);
  return out.join("");
}
