/**
 * Small editing tools: colour picking and fitting artwork to the template.
 */

import type { CupProfile, FrustumGeometry } from '@cupco/geometry';
import { halfExtent, type Design, type DesignElement } from './design';

/* -------------------------------------------------------------------------- */
/* Eyedropper                                                                  */
/* -------------------------------------------------------------------------- */

export type EyedropTarget = 'background' | 'text';

/**
 * Sample a colour from a rendered canvas.
 *
 * Samples the average of a small patch rather than a single pixel: artwork is
 * antialiased and often lightly textured, so one pixel can easily land on an
 * edge and return a colour that appears nowhere in the design.
 *
 * Fully transparent pixels are ignored so picking over a cut-out logo returns
 * the logo's colour rather than a blend with nothing.
 */
export function sampleColor(
  canvas: HTMLCanvasElement,
  px: number,
  py: number,
  radius = 2,
): string | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const x0 = Math.max(0, Math.round(px) - radius);
  const y0 = Math.max(0, Math.round(py) - radius);
  const w = Math.min(canvas.width - x0, radius * 2 + 1);
  const h = Math.min(canvas.height - y0, radius * 2 + 1);
  if (w <= 0 || h <= 0) return null;

  const d = ctx.getImageData(x0, y0, w, h).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3]! < 8) continue;
    r += d[i]!; g += d[i + 1]!; b += d[i + 2]!; n++;
  }
  if (n === 0) return null;

  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/* -------------------------------------------------------------------------- */
/* Fill to template                                                            */
/* -------------------------------------------------------------------------- */

export type FillMode = 'bleed' | 'safe';

/**
 * Scale and centre an element so it fills the printable template.
 *
 * Two sensible targets:
 *   'bleed' — cover the whole blank and the bleed beyond it, so the artwork
 *             runs off every edge with nothing left unprinted. Overshoots
 *             deliberately.
 *   'safe'  — fit entirely inside the safe area, so nothing is cropped by the
 *             rim curl, the base, or the glue seam.
 *
 * Rotation is cleared: a rotated element cannot fill a rectangle without
 * either gaps or a much larger scale, and silently doing the latter would be
 * surprising.
 */
export function fillToTemplate(
  el: DesignElement,
  profile: CupProfile,
  geom: FrustumGeometry,
  mode: FillMode,
): Partial<DesignElement> {
  const cw = profile.designCanvas.widthPx;
  const ch = profile.designCanvas.heightPx;

  // Target extents in design space.
  let uSpan: number, vSpan: number, vCentre: number;

  if (mode === 'bleed') {
    // Asymmetric, so convert each edge through the derived geometry rather
    // than guessing a fraction of the canvas. The centre shifts with it: the
    // blank is not centred on the cup.
    const c = profile.margins.cut;
    const b = profile.margins.bleedMm;
    const leftU = (c.leftMm + b) / geom.topArcMm;
    const rightU = (c.rightMm + b) / geom.topArcMm;
    const topV = (c.topMm + b) / geom.slantMm;
    const botV = (c.bottomMm + b) / geom.slantMm;
    uSpan = 1 + leftU + rightU;
    vSpan = 1 + topV + botV;
    // v points UP, so the bottom cut extends below v=0.
    vCentre = (1 + topV - botV) / 2;
  } else {
    const topV = profile.margins.safeTopMm / geom.slantMm;
    const botV = profile.margins.safeBottomMm / geom.slantMm;
    const seamU = profile.margins.safeSeamMm / geom.topArcMm;
    uSpan = 1 - seamU * 2;
    vSpan = 1 - topV - botV;
    vCentre = botV + vSpan / 2;
  }

  // Current unrotated extents, at the element's present size.
  const cur = halfExtent(el, cw, ch, undefined);
  const curU = cur.du * 2;
  const curV = cur.dv * 2;
  if (curU <= 0 || curV <= 0) return {};

  // 'bleed' covers (scale by the LARGER ratio, overflow is intended);
  // 'safe' contains (scale by the SMALLER ratio, nothing is cropped).
  const ratio = mode === 'bleed'
    ? Math.max(uSpan / curU, vSpan / curV)
    : Math.min(uSpan / curU, vSpan / curV);

  const patch: Record<string, unknown> = { u: 0.5, v: vCentre, rotation: 0 };
  if (el.type === 'image' || el.type === 'vector' || el.type === 'qr') {
    patch.widthU = Math.max(0.02, Math.min(6, el.widthU * ratio));
  } else if (el.type === 'band') {
    // Already full width; filling means taking the full printable height.
    patch.heightV = Math.max(0.01, Math.min(1, vSpan));
  } else {
    patch.sizeV = Math.max(0.015, Math.min(2, el.sizeV * ratio));
  }
  return patch as Partial<DesignElement>;
}

/** True when any element sits outside the safe area — used for a soft warning. */
export function elementsOutsideSafe(
  design: Design,
  profile: CupProfile,
  geom: FrustumGeometry,
): string[] {
  const cw = profile.designCanvas.widthPx;
  const ch = profile.designCanvas.heightPx;
  const topV = 1 - profile.margins.safeTopMm / geom.slantMm;
  const botV = profile.margins.safeBottomMm / geom.slantMm;

  const out: string[] = [];
  for (const el of design.elements) {
    const { dv } = halfExtent(el, cw, ch, undefined);
    if (el.v + dv > topV || el.v - dv < botV) out.push(el.name);
  }
  return out;
}
