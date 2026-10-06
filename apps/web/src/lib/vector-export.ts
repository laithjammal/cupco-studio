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
  boundaryURange, boundaryVRange, designWidthToMm,
  type CupProfile, type FrustumGeometry, type DesignShape, type FanShape, type Point2,
} from '@cupco/geometry';
import {
  placeArtwork, rasterPlacement, matchPalette, rgbToCmyk,
  type PaletteEntry, type RGB, type PlacedRaster,
} from '@cupco/vector';
import { warpPictureToFan, type FanPicture, type RasterImage } from '@cupco/render';
import { getLoadedFont, outlineText } from './fonts';
import { stretchOf } from './design';
import type { Design, DesignElement } from './design';
import { decodedRaster, preloadRasters } from './raster-cache';
import { drawFanPicture } from './pdf-picture';

const MM_PER_INCH = 25.4;
const PT_PER_MM = 72 / MM_PER_INCH;

export interface VectorEligibility {
  eligible: boolean;
  /** Names of elements that cannot be represented as vector. */
  blockers: { name: string; reason: string }[];
  /**
   * Vector artwork with pictures inside it. Still eligible - the paths stay
   * paths - but the pictures print as pixels, and the operator should know.
   */
  pictures: { name: string; count: number }[];
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
  const pictures: { name: string; count: number }[] = [];
  for (const el of design.elements) {
    if (el.type === 'vector' && el.art.rasters?.length) {
      pictures.push({ name: el.name, count: el.art.rasters.length });
    }
    if (el.type === 'image') {
      blockers.push({
        name: el.name,
        reason: 'bitmap upload — trace it to vector, or it will be embedded as a raster',
      });
    } else if (el.type === 'text' && !getLoadedFont(el.fontFamily, el.weight)) {
      blockers.push({ name: el.name, reason: 'font still loading — retry in a moment' });
    }
  }
  return { eligible: blockers.length === 0, blockers, pictures };
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

/** One thing to paint on the fan, in painting order. */
type FanLayer =
  | { kind: 'shape'; shape: FanShape }
  | { kind: 'picture'; picture: FanPicture };

/**
 * A picture's pixels, ready to warp: decoded, and cut to its clip.
 *
 * The clip is applied here, in the picture's own pixel grid, so the warp is
 * a plain image warp and the clip edge is antialiased at the picture's own
 * resolution. Very large pictures are brought down to 4096px on the long
 * side - still far beyond what any logo-sized placement can print.
 */
export function picturePixels(r: PlacedRaster, minWidth = 0): RasterImage | null {
  const img = decodedRaster(r.href);
  if (!img || img.naturalWidth <= 0 || img.naturalHeight <= 0) return null;
  // At least as dense as the output, so a clip is cut at print resolution:
  // cut at a small picture's own resolution, a crisp circular frame comes
  // out with an edge as soft as the picture's pixels are large.
  const up = Math.max(1, minWidth / img.naturalWidth);
  const k = Math.min(up, 4096 / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.max(1, Math.round(img.naturalWidth * k));
  const H = Math.max(1, Math.round(img.naturalHeight * k));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  if (r.clip && r.clip.length) {
    // Artwork units -> the picture's unit square -> its pixels.
    const m = r.matrix;
    const det = m[0] * m[3] - m[1] * m[2];
    if (!det) return null;
    const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
    const e = -(a * m[4] + c * m[5]), f = -(b * m[4] + d * m[5]);
    ctx.beginPath();
    for (const ring of r.clip) {
      ring.forEach((p, i) => {
        const x = (a * p.x + c * p.y + e) * W, y = (b * p.x + d * p.y + f) * H;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
    ctx.clip('nonzero');
  }
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H);
  return { width: W, height: H, data: data.data as Uint8ClampedArray<ArrayBuffer> };
}

/** How wide a placed picture prints, in mm, measured at its middle. */
function placedWidthMm(toDesign: readonly number[], geom: FrustumGeometry): number {
  const v = toDesign[1]! * 0.5 + toDesign[3]! * 0.5 + toDesign[5]!;
  return Math.hypot(designWidthToMm(toDesign[0]!, v, geom), toDesign[1]! * geom.slantMm);
}

/**
 * Print resolution for a picture: its own, within reason.
 *
 * Never below 300dpi, so a soft picture is smoothed rather than blocky, and
 * never above 600dpi, past which the press cannot use the extra pixels and
 * the file only gets bigger.
 */
function pictureDpi(pixelsWide: number, wideMm: number): number {
  const own = wideMm > 0 ? pixelsWide / (wideMm / 25.4) : 300;
  return Math.min(600, Math.max(300, own));
}

/** Build everything the design paints on the fan, in fan millimetres, in order. */
function buildFanLayers(
  design: Design,
  profile: CupProfile,
  geom: FrustumGeometry,
  toleranceMm: number,
): FanLayer[] {
  const cw = profile.designCanvas.widthPx;
  const ch = profile.designCanvas.heightPx;
  const out: FanLayer[] = [];
  const push = (shape: DesignShape, wrap: boolean) => {
    if (wrap) for (const s of warpShapeWrapped(shape, geom, toleranceMm)) out.push({ kind: 'shape', shape: s });
    else out.push({ kind: 'shape', shape: warpShape(shape, geom, toleranceMm) });
  };

  for (const el of design.elements) {
    let placed: DesignShape[] = [];

    if (el.type === 'vector') {
      const t = {
        u: el.u, v: el.v, widthU: el.widthU, rotation: el.rotation,
        canvasW: cw, canvasH: ch, stretchV: stretchOf(el),
      };
      const shapes = placeArtwork(el.art, t)
        .map((sh) => ({ ...sh, opacity: sh.opacity * (el.opacity ?? 1) }));
      const rasters = el.art.rasters ?? [];
      // Pictures go between the paths exactly where the file had them.
      const picture = (r: PlacedRaster) => {
        const toDesign = rasterPlacement(r, el.art, t);
        const wideMm = placedWidthMm(toDesign, geom);
        const dpi = pictureDpi(r.naturalWidth, wideMm);
        const px = picturePixels(r, Math.ceil((wideMm / 25.4) * dpi));
        if (!px) return;
        for (const p of warpPictureToFan(px, toDesign, geom, { dpi, opacity: r.opacity * (el.opacity ?? 1) })) {
          out.push({ kind: 'picture', picture: p });
        }
      };
      shapes.forEach((sh, i) => {
        for (const r of rasters) if (r.before === i) picture(r);
        push(sh, true);
      });
      for (const r of rasters) if (r.before >= shapes.length) picture(r);
      continue;
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
      // The light ground is the artwork's FIRST shape, emitted by the QR
      // builder along with the frame. It used to be a white rectangle added
      // here, and separately in the preview renderer, and separately again in
      // the raster path - three copies of one fact, which is one too many for
      // a frame that is no longer always a rectangle.
      placed = placeArtwork(el.art, {
        u: el.u, v: el.v, widthU: el.widthU, rotation: el.rotation,
        canvasW: cw, canvasH: ch, stretchV: stretchOf(el),
      }).map((sh) => ({ ...sh, opacity: sh.opacity * (el.opacity ?? 1) }));
    } else if (el.type === 'band') {
      // A full-circumference rectangle, emitted out to the BLEED - not to
      // u 0..1 and v 0..1.
      //
      // Clamping to the trim rectangle is what made a band stop short of the
      // blank on every edge: its ends came out as straight vertical cuts
      // inside the fan's slanted seam edges, with bare board beyond them, and
      // it could not reach the rim or base either. Design space 0..1 is the
      // cup wall; the blank is bigger than the cup on all four sides.
      const bu = boundaryURange(profile, geom, 'bleed');
      const bv = boundaryVRange(profile, geom, 'bleed');
      const u0 = Math.min(bu.atTop.uLeft, bu.atBottom.uLeft);
      const u1 = Math.max(bu.atTop.uRight, bu.atBottom.uRight);
      const half = el.heightV / 2;
      // Still clamped, but to the bleed rather than the wall: a band has no
      // business printing off the sheet.
      const v0 = Math.max(bv.vBottom, el.v - half);
      const v1 = Math.min(bv.vTop, el.v + half);
      placed = [{
        subpaths: [[
          { u: u0, v: v0 }, { u: u1, v: v0 }, { u: u1, v: v1 }, { u: u0, v: v1 }, { u: u0, v: v0 },
        ]],
        fill: hexToRgbLocal(el.color),
        opacity: el.opacity ?? 1,
      }];
    } else {
      continue;
    }

    // Bands already span the full circumference, and wrapping them would
    // emit duplicates; everything else wraps, so artwork crossing the glue
    // seam stays continuous.
    for (const shape of placed) push(shape, el.type !== 'band');
  }
  return out;
}

/** A warped picture as a PNG data URL, for the SVG export. */
function pictureDataUrl(pic: FanPicture): string {
  const c = document.createElement('canvas');
  c.width = pic.image.width;
  c.height = pic.image.height;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  ctx.putImageData(new ImageData(pic.image.data, pic.image.width, pic.image.height), 0, 0);
  return c.toDataURL('image/png');
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
  /** Pictures embedded among the paths, as CMYK images. */
  pictureCount: number;
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

  // Pictures are drawn synchronously below, so every one must be decoded first.
  await preloadRasters(design.elements.map((el) => (el.type === 'vector' ? el.art : null)));
  const layers = buildFanLayers(design, profile, geom, toleranceMm);

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

  let pointCount = 0, pathCount = 0, pictureCount = 0;
  for (const layer of layers) {
    if (layer.kind === 'picture') {
      drawFanPicture(pdf, page, layer.picture, { minX, minY, pageH, ptPerMm: PT_PER_MM });
      pictureCount++;
      continue;
    }
    const shape = layer.shape;
    const d = toPathString(shape.subpaths, minX, minY);
    if (!d) continue;
    pathCount++;
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
    pathCount,
    pictureCount,
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
export async function exportFanSvgVector(
  design: Design,
  profile: CupProfile,
  geom: FrustumGeometry,
  palette: readonly PaletteEntry[],
  toleranceMm: number = DEFAULT_FLATNESS_MM,
): Promise<{ blob: Blob; pathCount: number; pictureCount: number; pointCount: number }> {
  const cut = buildFanOutline(profile, geom, 'cut', 1024);
  const bleed = buildFanOutline(profile, geom, 'bleed', 1024);
  const b = fanBounds(bleed.points);
  const pad = 3;
  const minX = b.minX - pad, minY = b.minY - pad;
  const W = b.widthMm + pad * 2, H = b.heightMm + pad * 2;

  await preloadRasters(design.elements.map((el) => (el.type === 'vector' ? el.art : null)));
  const layers = buildFanLayers(design, profile, geom, toleranceMm);
  let pointCount = 0, pathCount = 0, pictureCount = 0;

  const bg = toPathString([bleed.points], minX, minY);
  const body = layers.map((layer) => {
    if (layer.kind === 'picture') {
      // SVG has no CMYK, so the picture travels as RGB like the fills do.
      const p = layer.picture;
      const href = pictureDataUrl(p);
      if (!href) return '';
      pictureCount++;
      return `    <image x="${(p.originXMm - minX).toFixed(4)}" y="${(p.originYMm - minY).toFixed(4)}"`
        + ` width="${(p.image.width * p.mmPerPixel).toFixed(4)}" height="${(p.image.height * p.mmPerPixel).toFixed(4)}"`
        + ` preserveAspectRatio="none" href="${href}"/>`;
    }
    const s = layer.shape;
    const d = toPathString(s.subpaths, minX, minY);
    if (!d) return '';
    pathCount++;
    pointCount += s.subpaths.reduce((n, r) => n + r.length, 0);
    const hit = palette.length ? matchPalette(palette, s.fill) : null;
    const v = hit && hit.overridden ? hit.cmyk : rgbToCmyk(s.fill);
    const rgbStr = `rgb(${s.fill[0]},${s.fill[1]},${s.fill[2]})`;
    // SVG has no CMYK colour space, so the ink values ride along as a data
    // attribute: the RGB is for display, the attribute is the print intent.
    // The fill rule has to be written out. SVG's default is nonzero, but the
    // preview fills generated artwork even-odd - left implicit, the printed
    // file would fill differently from what was approved on screen.
    const rule = s.fillRule ?? 'evenodd';
    return `    <path d="${d}" fill="${rgbStr}" fill-rule="${rule}"`
      + `${s.opacity < 1 ? ` fill-opacity="${s.opacity}"` : ''}` +
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
  <path id="bleed" d="${bg}" fill="none" stroke="#16a34a" stroke-width="0.25" stroke-dasharray="2 1"/>
  <path id="cut" d="${toPathString([cut.points], minX, minY)}" fill="none" stroke="#db2777" stroke-width="0.4"/>
  <path id="safe" d="${path(buildFanOutline(profile, geom, 'safe', 1024).points)}" fill="none" stroke="#0284c7" stroke-width="0.25" stroke-dasharray="1 1"/>
</svg>`;

  return {
    blob: new Blob([svg], { type: 'image/svg+xml' }),
    pathCount,
    pictureCount,
    pointCount,
  };
}
