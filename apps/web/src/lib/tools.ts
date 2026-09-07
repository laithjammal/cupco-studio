/**
 * Small editing tools: colour picking and fitting artwork to the template.
 */

import { boundaryURange, boundaryVRange } from '@cupco/geometry';
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

export type FillMode = 'bleed' | 'bleed-h' | 'bleed-v' | 'safe';

/**
 * Scale and centre an element so it fills the printable template.
 *
 *   'bleed'    cover the whole blank and the bleed beyond it, running off
 *              every edge. Overshoots on one axis deliberately.
 *   'bleed-h'  run off the LEFT and RIGHT edges only, leaving the element's
 *              height and vertical position alone.
 *   'bleed-v'  run off the TOP and BOTTOM edges only, leaving its width and
 *              horizontal position alone.
 *   'safe'     fit entirely inside the safe area, so nothing is cropped by
 *              the rim curl, the base, or the glue seam.
 *
 * The two single-axis modes exist because 'bleed' scales to COVER: it takes
 * the larger of the two ratios, so a band asked to bleed sideways also grew
 * tall enough to swallow the cup, and a tall logo asked to bleed top-to-bottom
 * grew wider than the blank. Wanting one axis to bleed is the common case, and
 * it was not expressible.
 *
 * Rotation is cleared: a rotated element cannot fill a rectangle without
 * either gaps or a much larger scale, and silently doing the latter would be
 * surprising.
 */
const clampStretch = (v: number) => Math.max(0.05, Math.min(20, v));

export function fillToTemplate(
  el: DesignElement,
  profile: CupProfile,
  geom: FrustumGeometry,
  mode: FillMode,
): Partial<DesignElement> {
  const cw = profile.designCanvas.widthPx;
  const ch = profile.designCanvas.heightPx;

  // Target extents in design space, taken from the boundary itself rather
  // than by dividing millimetres by an arc length.
  //
  // That shortcut is wrong in a way that only shows near the base. Design u is
  // ANGULAR, so a fixed mm offset from the seam is a larger fraction of u at
  // the base than at the rim - and the old code measured only at the rim.
  // "Fill to bleed" therefore stopped 2.9mm inside the blank on each side, and
  // "fit to safe" left artwork 1.0mm OUTSIDE the safe area, which is the
  // dangerous direction.
  const covering = mode !== 'safe';
  const target = covering ? 'bleed' : 'safe';
  const u = boundaryURange(profile, geom, target);
  const v = boundaryVRange(profile, geom, target);

  // COVER takes the widest reading of the boundary, CONTAIN the narrowest.
  const uLeft = covering
    ? Math.min(u.atTop.uLeft, u.atBottom.uLeft)
    : Math.max(u.atTop.uLeft, u.atBottom.uLeft);
  const uRight = covering
    ? Math.max(u.atTop.uRight, u.atBottom.uRight)
    : Math.min(u.atTop.uRight, u.atBottom.uRight);

  const uSpan = uRight - uLeft;
  const vSpan = v.vTop - v.vBottom;
  const uCentre = (uLeft + uRight) / 2;
  const vCentre = (v.vBottom + v.vTop) / 2;

  // Current unrotated extents, at the element's present size.
  const cur = halfExtent(el, cw, ch, undefined);
  const curU = cur.du * 2;
  const curV = cur.dv * 2;
  if (curU <= 0 || curV <= 0) return {};

  // 'bleed' covers (scale by the LARGER ratio, overflow is intended);
  // 'safe' contains (scale by the SMALLER ratio, nothing is cropped);
  // the single-axis modes take only the axis they are named for.
  const ratio =
    mode === 'bleed' ? Math.max(uSpan / curU, vSpan / curV)
    : mode === 'bleed-h' ? uSpan / curU
    : mode === 'bleed-v' ? vSpan / curV
    : Math.min(uSpan / curU, vSpan / curV);

  // A single-axis fill must not move the element on the OTHER axis - that is
  // the whole point of asking for one axis.
  const patch: Record<string, unknown> = { rotation: 0 };
  if (mode !== 'bleed-v') patch.u = uCentre;
  if (mode !== 'bleed-h') patch.v = vCentre;

  if (el.type === 'image' || el.type === 'vector' || el.type === 'qr') {
    // Artwork is sized by WIDTH, with height following as
    // widthU * aspect * stretchV. So widthU alone moves both axes at once,
    // and a single-axis fill has to correct the other one deliberately -
    // otherwise "bleed across" also grew the height, and "bleed down" applied
    // its ratio to the width. Same arithmetic as an edge-handle drag.
    const stretch = el.stretchV ?? 1;
    if (mode === 'bleed-v') {
      // Height only: leave widthU exactly as it was.
      patch.stretchV = clampStretch(stretch * ratio);
    } else {
      const widthU = Math.max(0.02, Math.min(6, el.widthU * ratio));
      patch.widthU = widthU;
      if (mode === 'bleed-h') {
        // Undo the height change the width change would otherwise cause.
        patch.stretchV = clampStretch(stretch / (widthU / el.widthU));
      }
    }
  } else if (el.type === 'band') {
    // A band already spans the full circumference and wraps through the seam,
    // so it bleeds sideways whatever its width says. Only its height is worth
    // setting, and 'bleed-h' has nothing to do.
    //
    // NOT clamped to 1: the blank is taller than the cup, so filling to the
    // bleed needs heightV ~1.37. Clamping to 1 stopped a band 31.7mm short of
    // the blank - it reached the trim and no further.
    if (mode === 'bleed-h') return { rotation: 0 } as Partial<DesignElement>;
    patch.heightV = Math.max(0.01, Math.min(3, vSpan));
  } else {
    // Text has ONE size, so a single-axis fill scales the type to fit that
    // axis and the other follows. Stretching glyphs to fill a box is a
    // different thing, and not something to do behind the user's back.
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
