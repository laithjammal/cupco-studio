/**
 * True vector CMYK export.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS DIFFERENT FROM THE RASTER PATH
 * ---------------------------------------------------------------------------
 * The raster exporter resamples pixels through the inverse map. It is correct,
 * but resolution-bound: a logo at 600dpi is still 600dpi, and its edges are
 * still pixels.
 *
 * This path keeps artwork as PATHS the whole way. Each shape is warped by
 * adaptive subdivision (tolerance measured in printed millimetres), then
 * written into the PDF with ink percentages via `cmyk()`. The result is
 * resolution-independent, a fraction of the file size, and - crucially for a
 * digital CMYK press - carries exact ink values rather than a conversion of a
 * screen colour.
 *
 * WHAT MAKES IT FALL BACK
 * A design can only go fully vector if every element is vector. Untraced
 * bitmap uploads and live text cannot be, so those force the raster path. The
 * caller is told WHICH elements caused it rather than silently getting a
 * bigger, softer file.
 */

import { PDFDocument, cmyk } from 'pdf-lib';
import {
  buildFanOutline, fanBounds, warpShapeWrapped, warpShape, DEFAULT_FLATNESS_MM,
  type CupProfile, type FrustumGeometry, type DesignShape, type FanShape, type Point2,
} from '@cupco/geometry';
import { placeArtwork, matchPalette, rgbToCmyk, type PaletteEntry, type RGB } from '@cupco/vector';
import { getLoadedFont, outlineText } from './fonts';
import type { Design, DesignElement } from './design';

const MM_PER_INCH = 25.4;
const PT_PER_MM = 72 / MM_PER_INCH;

export interface VectorEligibility {
  eligible: boolean;
  /** Names of elements that cannot be represented as vector. */
  blockers: { name: string; reason: string }[];
}

/**
 * Can this design be exported as pure vector?
 *
 * Text is outlined from the bundled font file, so it no longer blocks — unless
 * the file has not finished loading, in which case we say so rather than
 * silently exporting a rasterised approximation.
 */
export function checkVectorEligibility(design: Design): VectorEligibility {
  const blockers: { name: string; reason: string }[] = [];
  for (const el of design.elements) {
    if (el.type === 'image') {
      blockers.push({
        name: el.name,
        reason: 'bitmap upload — trace it to vector, or it will be embedded as a raster',
      });
    } else if (el.type === 'text' && !getLoadedFont(el.fontFamily, el.weight)) {
      blockers.push({ name: el.name, reason: 'font still loading — retry in a moment' });
    }
  }
  return { eligible: blockers.length === 0, blockers };
}

/** Every fill colour used by the design, for building the ink list. */
export function collectFills(design: Design): { fill: RGB; weight: number }[] {
  const out: { fill: RGB; weight: number }[] = [{ fill: hexToRgbLocal(design.background), weight: 4 }];
  for (const el of design.elements) {
    if (el.type === 'vector') {
      for (const s of el.art.shapes) out.push({ fill: s.fill, weight: 1 });
    } else if (el.type === 'text') {
      out.push({ fill: hexToRgbLocal(el.color), weight: 1 });
    } else if (el.type === 'band') {
      // Bands cover a lot of area, so they weigh heavily in the ink list.
      out.push({ fill: hexToRgbLocal(el.color), weight: 3 });
    } else if (el.type === 'qr') {
      // A QR must print as solid black on white to scan reliably.
      out.push({ fill: [0, 0, 0], weight: 2 });
      out.push({ fill: [255, 255, 255], weight: 2 });
    }
  }
  return out;
}

function hexToRgbLocal(hex: string): RGB {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Ink values for a colour: an operator-supplied override if present. */
function inkFor(rgb: RGB, palette: readonly PaletteEntry[]) {
  const hit = palette.length ? matchPalette(palette, rgb) : null;
  const v = hit && hit.overridden ? hit.cmyk : rgbToCmyk(rgb);
  return cmyk(v.c, v.m, v.y, v.k);
}

/** Build every warped shape for the design, in fan millimetres. */
function buildFanShapes(
  design: Design,
  profile: CupProfile,
  geom: FrustumGeometry,
  toleranceMm: number,
): FanShape[] {
  const cw = profile.designCanvas.widthPx;
  const ch = profile.designCanvas.heightPx;
  const out: FanShape[] = [];

  for (const el of design.elements) {
    let placed: DesignShape[] = [];

    if (el.type === 'vector') {
      placed = placeArtwork(el.art, {
        u: el.u, v: el.v, widthU: el.widthU, rotation: el.rotation, canvasW: cw, canvasH: ch,
      }).map((sh) => ({ ...sh, opacity: sh.opacity * (el.opacity ?? 1) }));
    } else if (el.type === 'text') {
      // Outlined from the same font file the preview rendered with, laid out
      // at the same advances — so the printed text matches what was approved.
      const font = getLoadedFont(el.fontFamily, el.weight);
      if (!font) continue;
      placed = outlineText({
        text: el.content, font, sizePx: el.sizeV * ch, tracking: el.tracking,
        u: el.u, v: el.v, rotationDeg: el.rotation, canvasW: cw, canvasH: ch,
        fill: hexToRgbLocal(el.color), opacity: el.opacity ?? 1,
      });
    } else if (el.type === 'qr') {
      const half = el.widthU / 2;
      const hV = (el.widthU * cw * el.art.aspect) / ch / 2;
      // White plate first: the quiet zone and light modules must be white on
      // press, not "whatever colour the cup happens to be".
      placed = [{
        subpaths: [[
          { u: el.u - half, v: el.v - hV }, { u: el.u + half, v: el.v - hV },
          { u: el.u + half, v: el.v + hV }, { u: el.u - half, v: el.v + hV },
          { u: el.u - half, v: el.v - hV },
        ]],
        fill: [255, 255, 255],
        opacity: 1,
      }];
      // Then the dark modules on top, positioned within that plate.
      for (const shape of el.art.shapes) {
        placed.push({
          fill: shape.fill,
          opacity: shape.opacity,
          subpaths: shape.subpaths.map((sp) => sp.map((pt) => ({
            u: el.u + (pt.x - 0.5) * el.widthU,
            v: el.v - (pt.y - 0.5) * el.widthU * cw * el.art.aspect / ch,
          }))),
        });
      }
    } else if (el.type === 'band') {
      // A full-circumference rectangle in design space. Emitted at exactly
      // u 0..1 so the warp closes on itself with no seam artefact.
      const half = el.heightV / 2;
      const v0 = Math.max(0, el.v - half);
      const v1 = Math.min(1, el.v + half);
      placed = [{
        subpaths: [[
          { u: 0, v: v0 }, { u: 1, v: v0 }, { u: 1, v: v1 }, { u: 0, v: v1 }, { u: 0, v: v0 },
        ]],
        fill: hexToRgbLocal(el.color),
        opacity: el.opacity ?? 1,
      }];
    } else {
      continue;
    }

    for (const shape of placed) {
      if (el.type === 'band') {
        // Already spans the full circumference; wrapping would emit duplicates.
        out.push(warpShape(shape, geom, toleranceMm));
      } else {
        // Wrapped, so artwork crossing the glue seam stays continuous.
        out.push(...warpShapeWrapped(shape, geom, toleranceMm));
      }
    }
  }
  return out;
}

/** Fan mm -> PDF path units, anchored top-left with y increasing downward. */
function toPathString(subpaths: Point2[][], minX: number, minY: number): string {
  return subpaths
    .filter((r) => r.length > 1)
    .map((ring) =>
      ring.map((p, i) =>
        `${i === 0 ? 'M' : 'L'} ${(p.x - minX).toFixed(4)} ${(p.y - minY).toFixed(4)}`,
      ).join(' ') + ' Z')
    .join(' ');
}

export interface VectorPdfResult {
  blob: Blob;
  pathCount: number;
  pointCount: number;
  widthMm: number;
  heightMm: number;
  ms: number;
  inks: { hex: string; cmyk: string; overridden: boolean }[];
}

/**
 * Pure vector, CMYK, true-millimetre PDF.
 *
 * Still NOT PDF/X: there is no output intent or embedded ICC profile, so a
 * prepress operator cannot verify it against a press condition. But the colour
 * is genuine CMYK ink values rather than an unmanaged conversion of RGB
 * pixels, which is what a digital CMYK press needs.
 */
export async function exportFanPdfVector(
  design: Design,
  profile: CupProfile,
  geom: FrustumGeometry,
  palette: readonly PaletteEntry[],
  toleranceMm: number = DEFAULT_FLATNESS_MM,
  onProgress?: (msg: string) => void,
): Promise<VectorPdfResult> {
  const t0 = performance.now();
  onProgress?.('Warping vector paths…');

  const cut = buildFanOutline(profile, geom, 'cut', 1024);
  const bleed = buildFanOutline(profile, geom, 'bleed', 1024);
  const b = fanBounds(bleed.points);
  const pad = 3;
  const minX = b.minX - pad, minY = b.minY - pad;
  const widthMm = b.widthMm + pad * 2;
  const heightMm = b.heightMm + pad * 2;

  const shapes = buildFanShapes(design, profile, geom, toleranceMm);

  onProgress?.('Building PDF…');
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Cupco ${profile.displayName} production fan (vector CMYK)`);
  pdf.setProducer('Cupco Studio');
  pdf.setSubject(
    `Vector CMYK fan. Blank ${widthMm.toFixed(2)} x ${heightMm.toFixed(2)} mm incl. ` +
    `to the bleed. Sector ${geom.sectorAngleDeg.toFixed(4)} deg, ` +
    `R_bottom ${geom.rBottomMm.toFixed(4)} mm, R_top ${geom.rTopMm.toFixed(4)} mm. ` +
    `Path flatness ${toleranceMm}mm. NOT PDF/X: no output intent or ICC profile.`,
  );

  const pageW = widthMm * PT_PER_MM;
  const pageH = heightMm * PT_PER_MM;
  const page = pdf.addPage([pageW, pageH]);

  // NO CLIPPING MASK, and nothing wrapped in a graphics state.
  //
  // This file is opened and worked on in Illustrator, and a clip mask has to
  // be released before anything can be edited - so it was costing the person
  // downstream more than it bought. Every path is emitted flat, at the top
  // level, ready to select and edit.
  //
  // What the mask used to do was stop artwork dragged past the blank from
  // printing outside the die and contaminating the neighbouring cup on the
  // sheet. That risk does not vanish with the mask, it just becomes visible,
  // so it is now caught in preflight instead - see the `past-bleed` rule -
  // where it can be fixed rather than silently cropped.
  const clipPts = bleed.points;

  // Background, filling out to the bleed so the die never exposes white.
  page.drawSvgPath(toPathString([clipPts], minX, minY), {
    x: 0, y: pageH, scale: PT_PER_MM,
    color: inkFor(hexToRgbLocal(design.background), palette),
    borderWidth: 0,
  });

  let pointCount = 0;
  for (const shape of shapes) {
    const d = toPathString(shape.subpaths, minX, minY);
    if (!d) continue;
    pointCount += shape.subpaths.reduce((n, r) => n + r.length, 0);
    page.drawSvgPath(d, {
      x: 0, y: pageH, scale: PT_PER_MM,
      color: inkFor(shape.fill, palette),
      opacity: shape.opacity,
      borderWidth: 0,
    });
  }

  const bytes = await pdf.save();
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);

  return {
    blob: new Blob([buf], { type: 'application/pdf' }),
    pathCount: shapes.length,
    pointCount,
    widthMm, heightMm,
    ms: Math.round(performance.now() - t0),
    inks: palette.map((p) => ({
      hex: p.hex,
      cmyk: `${Math.round(p.cmyk.c * 100)}/${Math.round(p.cmyk.m * 100)}/${Math.round(p.cmyk.y * 100)}/${Math.round(p.cmyk.k * 100)}`,
      overridden: p.overridden,
    })),
  };
}

/** Pure vector SVG, in true millimetres, with the dieline as separate layers. */
export function exportFanSvgVector(
  design: Design,
  profile: CupProfile,
  geom: FrustumGeometry,
  palette: readonly PaletteEntry[],
  toleranceMm: number = DEFAULT_FLATNESS_MM,
): { blob: Blob; pathCount: number; pointCount: number } {
  const cut = buildFanOutline(profile, geom, 'cut', 1024);
  const bleed = buildFanOutline(profile, geom, 'bleed', 1024);
  const b = fanBounds(bleed.points);
  const pad = 3;
  const minX = b.minX - pad, minY = b.minY - pad;
  const W = b.widthMm + pad * 2, H = b.heightMm + pad * 2;

  const shapes = buildFanShapes(design, profile, geom, toleranceMm);
  let pointCount = 0;

  const bg = toPathString([bleed.points], minX, minY);
  const body = shapes.map((s) => {
    const d = toPathString(s.subpaths, minX, minY);
    if (!d) return '';
    pointCount += s.subpaths.reduce((n, r) => n + r.length, 0);
    const hit = palette.length ? matchPalette(palette, s.fill) : null;
    const v = hit && hit.overridden ? hit.cmyk : rgbToCmyk(s.fill);
    const rgbStr = `rgb(${s.fill[0]},${s.fill[1]},${s.fill[2]})`;
    // SVG has no CMYK colour space, so the ink values ride along as a data
    // attribute: the RGB is for display, the attribute is the print intent.
    return `    <path d="${d}" fill="${rgbStr}"${s.opacity < 1 ? ` fill-opacity="${s.opacity}"` : ''}` +
      ` data-cmyk="${(v.c * 100).toFixed(1)},${(v.m * 100).toFixed(1)},${(v.y * 100).toFixed(1)},${(v.k * 100).toFixed(1)}"/>`;
  }).filter(Boolean).join('\n');

  const path = (pts: Point2[]) => toPathString([pts], minX, minY);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Cupco Studio production fan - ${profile.displayName} - TRUE VECTOR
     1:1 millimetres. Path flatness ${toleranceMm}mm on the printed fan.
     sector ${geom.sectorAngleDeg.toFixed(4)}deg  R_bot ${geom.rBottomMm.toFixed(4)}mm  R_top ${geom.rTopMm.toFixed(4)}mm
     Fills are shown in RGB; the intended CMYK ink values are on each path's
     data-cmyk attribute (SVG has no CMYK colour space). -->
<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(3)}mm" height="${H.toFixed(3)}mm"
     viewBox="0 0 ${W.toFixed(4)} ${H.toFixed(4)}">
  <path id="background" d="${bg}" fill="${design.background}"/>
${body}
  <path id="bleed" d="${bg}" fill="none" stroke="#f472b6" stroke-width="0.25" stroke-dasharray="2 1"/>
  <path id="cut" d="${toPathString([cut.points], minX, minY)}" fill="none" stroke="#db2777" stroke-width="0.4"/>
  <path id="safe" d="${path(buildFanOutline(profile, geom, 'safe', 1024).points)}" fill="none" stroke="#0284c7" stroke-width="0.25" stroke-dasharray="1 1"/>
</svg>`;

  return {
    blob: new Blob([svg], { type: 'image/svg+xml' }),
    pathCount: shapes.length,
    pointCount,
  };
}
