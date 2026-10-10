// Where to scroll a narrow sector map so the rig and the offered jobs are in view.
export function sectorScrollLeft(rig, offered, svgW, viewW, mapW = 1100) {
  if (!(svgW > viewW)) return 0;
  const pts = [rig, ...offered];
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  return Math.round(Math.min(svgW - viewW, Math.max(0, (cx / mapW) * svgW - viewW / 2)));
}
