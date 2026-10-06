/**
 * One picture -> its warped footprint on the production fan.
 *
 * The vector export keeps shapes as paths all the way to the PDF. A picture
 * embedded in a logo cannot become paths, and until now it was simply not
 * there: the export walked the shapes and the photo in the middle of the
 * badge never reached the printer.
 *
 * So each picture is warped on its own, straight from its own pixels - not
 * from the design canvas, whose resolution has nothing to do with the
 * picture's - and placed in the PDF at its exact position, between the paths
 * it sat between. Everything around it stays vector.
 *
 * Inverse-mapped like rasteriseFan, and for the same reason: every output
 * pixel is gathered exactly once, so the longer outer arc leaves no gaps.
 */

import { designToFan, fanToDesign, type FrustumGeometry } from '@cupco/geometry';
import { createImage, type RasterImage } from './image';

/** 2D affine [a b c d e f], laid out as SVG's matrix(). */
export type PictureMatrix = readonly [number, number, number, number, number, number];

export interface FanPicture {
  /** RGBA, straight (not premultiplied) alpha. */
  image: RasterImage;
  /** Fan-space mm at the top-left corner of pixel (0, 0). */
  originXMm: number;
  originYMm: number;
  mmPerPixel: number;
}

export interface PictureWarpOptions {
  dpi: number;
  /** Multiplied into every pixel's alpha. Default 1. */
  opacity?: number;
  /** Samples per axis per output pixel. Default 2. */
  supersample?: number;
}

const MM_PER_INCH = 25.4;

function invert(m: PictureMatrix): PictureMatrix | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det || !Number.isFinite(det)) return null;
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/**
 * Warp a picture onto the fan.
 *
 * `toDesign` maps the picture's unit square (0..1, y down) into design
 * space (u around, v up). Returns one piece per copy that lands on the fan:
 * a picture straddling the glue seam appears at both edges, exactly as a
 * wrapped shape does.
 */
export function warpPictureToFan(
  picture: RasterImage,
  toDesign: PictureMatrix,
  geom: FrustumGeometry,
  options: PictureWarpOptions,
): FanPicture[] {
  const inv = invert(toDesign);
  if (!inv || picture.width <= 0 || picture.height <= 0) return [];
  const opacity = Math.max(0, Math.min(1, options.opacity ?? 1));
  const ss = Math.max(1, Math.floor(options.supersample ?? 2));
  const mmPerPixel = MM_PER_INCH / options.dpi;
  const nw = picture.width, nh = picture.height;

  // Premultiplied, so bilinear filtering never bleeds the colour of fully
  // transparent pixels (usually black) into the edge of the picture.
  const src = picture.data;
  const pm = new Float32Array(nw * nh * 4);
  for (let i = 0; i < nw * nh; i++) {
    const a = src[i * 4 + 3]! / 255;
    pm[i * 4] = src[i * 4]! * a;
    pm[i * 4 + 1] = src[i * 4 + 1]! * a;
    pm[i * 4 + 2] = src[i * 4 + 2]! * a;
    pm[i * 4 + 3] = a;
  }

  const at = (s: number, t: number) => ({
    u: toDesign[0] * s + toDesign[2] * t + toDesign[4],
    v: toDesign[1] * s + toDesign[3] * t + toDesign[5],
  });
  const corners = [at(0, 0), at(1, 0), at(1, 1), at(0, 1)];
  const minU = Math.min(...corners.map((c) => c.u));
  const maxU = Math.max(...corners.map((c) => c.u));
  const offsets = maxU - minU >= 1 ? [0] : [-1, 0, 1];

  const out: FanPicture[] = [];
  const acc = [0, 0, 0, 0];
  const sample = (s: number, t: number) => {
    // Pixel centres sit at half-integers; clamp to the edge pixels.
    const fx = Math.min(nw - 1, Math.max(0, s * nw - 0.5));
    const fy = Math.min(nh - 1, Math.max(0, t * nh - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(nw - 1, x0 + 1), y1 = Math.min(nh - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const i00 = (y0 * nw + x0) * 4, i10 = (y0 * nw + x1) * 4;
    const i01 = (y1 * nw + x0) * 4, i11 = (y1 * nw + x1) * 4;
    for (let ch = 0; ch < 4; ch++) {
      const top = pm[i00 + ch]! * (1 - tx) + pm[i10 + ch]! * tx;
      const bot = pm[i01 + ch]! * (1 - tx) + pm[i11 + ch]! * tx;
      acc[ch]! += top * (1 - ty) + bot * ty;
    }
  };

  for (const k of offsets) {
    // The same cheap reject as warpShapeWrapped: a copy whose u span misses
    // the sector entirely has nothing to print.
    if (minU + k > 1.02 || maxU + k < -0.02) continue;

    // The footprint's box on the fan. Edges are sampled densely because
    // straight lines in design space are arcs on the fan.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let e = 0; e < 4; e++) {
      const a = corners[e]!, b = corners[(e + 1) % 4]!;
      for (let i = 0; i <= 48; i++) {
        const f = i / 48;
        const p = designToFan({ u: a.u + (b.u - a.u) * f + k, v: a.v + (b.v - a.v) * f }, geom);
        if (p.x < x0) x0 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.x > x1) x1 = p.x;
        if (p.y > y1) y1 = p.y;
      }
    }
    // A pixel of margin, so the antialiased edge is not cut flush.
    x0 -= mmPerPixel; y0 -= mmPerPixel; x1 += mmPerPixel; y1 += mmPerPixel;
    const W = Math.max(1, Math.ceil((x1 - x0) / mmPerPixel));
    const H = Math.max(1, Math.ceil((y1 - y0) / mmPerPixel));
    const img = createImage(W, H);
    const data = img.data;
    let any = false;

    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        acc[0] = acc[1] = acc[2] = acc[3] = 0;
        for (let sy = 0; sy < ss; sy++) {
          for (let sx = 0; sx < ss; sx++) {
            const mx = x0 + (px + (sx + 0.5) / ss) * mmPerPixel;
            const my = y0 + (py + (sy + 0.5) / ss) * mmPerPixel;
            const d = fanToDesign({ x: mx, y: my }, geom);
            const u = d.u - k;
            const s = inv[0] * u + inv[2] * d.v + inv[4];
            const t = inv[1] * u + inv[3] * d.v + inv[5];
            if (s < 0 || s > 1 || t < 0 || t > 1) continue;
            sample(s, t);
          }
        }
        const n = ss * ss;
        const a = acc[3]! / n;
        if (a <= 0) continue;
        const o = (py * W + px) * 4;
        // Back to straight alpha: the PDF's soft mask carries coverage, the
        // colour channels carry colour.
        data[o] = acc[0]! / n / a;
        data[o + 1] = acc[1]! / n / a;
        data[o + 2] = acc[2]! / n / a;
        data[o + 3] = a * opacity * 255;
        any = true;
      }
    }
    if (any) out.push({ image: img, originXMm: x0, originYMm: y0, mmPerPixel });
  }
  return out;
}
