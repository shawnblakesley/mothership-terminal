export function frustum(fit, aspect) {
  const h = Math.max(fit.h, fit.w / aspect);
  return { w: h * aspect, h };
}

export function labelScale(ppu, base) {
  const px = Math.round(Math.min(base, Math.max(base * 0.55, ppu * 1.4)) * 2) / 2;
  return { px, far: ppu < 7 };
}
