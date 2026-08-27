/**
 * A minimal RGBA raster, structurally compatible with the browser's ImageData.
 *
 * Deliberately NOT ImageData: that type only exists in the browser, and this
 * code must also run in the Node export worker. A plain object with the same
 * shape means one implementation serves both, and the browser can pass a real
 * ImageData straight in.
 */
export interface RasterImage {
  readonly width: number;
  readonly height: number;
  /**
   * RGBA, 4 bytes per pixel, row-major. Length must be width*height*4.
   *
   * Pinned to a plain ArrayBuffer (not ArrayBufferLike) so the browser can
   * hand this straight to `new ImageData(...)`, which rejects SharedArrayBuffer
   * backing.
   */
  readonly data: Uint8ClampedArray<ArrayBuffer>;
}

export function createImage(width: number, height: number): RasterImage {
  if (!Number.isInteger(width) || width <= 0) throw new Error(`bad width ${width}`);
  if (!Number.isInteger(height) || height <= 0) throw new Error(`bad height ${height}`);
  return {
    width,
    height,
    data: new Uint8ClampedArray(new ArrayBuffer(width * height * 4)),
  };
}

export type RGBA = readonly [number, number, number, number];

/** Read a pixel with no bounds checking. Callers must clamp first. */
function px(img: RasterImage, x: number, y: number, out: number[]): void {
  const i = (y * img.width + x) * 4;
  out[0] = img.data[i]!;
  out[1] = img.data[i + 1]!;
  out[2] = img.data[i + 2]!;
  out[3] = img.data[i + 3]!;
}

const c00: number[] = [0, 0, 0, 0];
const c10: number[] = [0, 0, 0, 0];
const c01: number[] = [0, 0, 0, 0];
const c11: number[] = [0, 0, 0, 0];

/**
 * Bilinear sample at normalised (u,v). v is clamped; u optionally WRAPS.
 *
 * Wrapping u is not a convenience - it is a manufacturing requirement. Design
 * space is a cylinder cut at the seam, so artwork must be continuous across
 * u=0/u=1. Clamping there would smear the edge pixel into the glue overlap and
 * show as a visible streak down the seam of the finished cup.
 *
 * v=0 is the BOTTOM of the cup, so the image row order is flipped: raster row
 * 0 is the top of the artwork.
 */
export function sampleBilinear(
  img: RasterImage,
  u: number,
  v: number,
  wrapU: boolean,
  out: number[],
): void {
  let uu = u;
  if (wrapU) {
    uu = uu - Math.floor(uu); // -> [0,1)
  } else {
    uu = uu < 0 ? 0 : uu > 1 ? 1 : uu;
  }
  const vv = v < 0 ? 0 : v > 1 ? 1 : v;

  // v=0 is the cup bottom -> the LAST raster row.
  const fx = uu * img.width - 0.5;
  const fy = (1 - vv) * img.height - 0.5;

  let x0 = Math.floor(fx);
  let y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;

  let x1 = x0 + 1;
  const y1 = y0 + 1;

  const wrapX = (x: number) => {
    if (!wrapU) return x < 0 ? 0 : x > img.width - 1 ? img.width - 1 : x;
    const m = x % img.width;
    return m < 0 ? m + img.width : m;
  };
  const clampY = (y: number) => (y < 0 ? 0 : y > img.height - 1 ? img.height - 1 : y);

  x0 = wrapX(x0);
  x1 = wrapX(x1);
  const cy0 = clampY(y0);
  const cy1 = clampY(y1);

  px(img, x0, cy0, c00);
  px(img, x1, cy0, c10);
  px(img, x0, cy1, c01);
  px(img, x1, cy1, c11);

  for (let k = 0; k < 4; k++) {
    const top = c00[k]! + (c10[k]! - c00[k]!) * tx;
    const bot = c01[k]! + (c11[k]! - c01[k]!) * tx;
    out[k] = top + (bot - top) * ty;
  }
}
