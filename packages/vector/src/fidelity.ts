/**
 * How different two renderings of the same artwork are.
 *
 * One definition, used twice: the fidelity suite scores every corpus file
 * with it against resvg, and the app scores every upload with it against the
 * browser's own rendering of the file. If the two measured differently, a
 * file could pass in the tests and still be flagged on screen - or worse, the
 * other way round.
 */

/** Anything shaped like ImageData: RGBA, row-major, 4 bytes a pixel. */
export interface RenderPixels {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export interface RenderComparison {
  /**
   * Fraction of the ARTWORK that differs, 0..1.
   *
   * Normalised by inked area rather than by canvas area, so a missing logo
   * on a big empty page still reads as a large failure.
   */
  fraction: number;
  /** 1 where a pixel differs, row-major at the compared size. */
  mask: Uint8Array;
  /** Pixels either rendering inked. */
  inked: number;
  /** Pixels counted as different. */
  differing: number;
}

export interface CompareOptions {
  /** The ground both were rendered on. Default mid grey, 128. */
  background?: readonly [number, number, number];
  /** Per-channel difference that still counts as the same colour. Default 40. */
  threshold?: number;
}

/**
 * Compare two renderings pixel by pixel.
 *
 * A pixel only counts as wrong if no pixel within one step of it matches
 * either - so curve flattening and antialiasing, which shift an edge by a
 * fraction of a pixel, do not register, while a missing shape, a wrong colour
 * or a lost gradient all do.
 */
export function compareRenders(
  a: RenderPixels,
  b: RenderPixels,
  options: CompareOptions = {},
): RenderComparison {
  const [br, bg, bb] = options.background ?? [128, 128, 128];
  const t = options.threshold ?? 40;
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  const mask = new Uint8Array(w * h);
  const A = a.data, B = b.data;

  const near = (i: number, j: number, P: RenderPixels['data'], Q: RenderPixels['data']) =>
    Math.abs(P[i]! - Q[j]!) <= t && Math.abs(P[i + 1]! - Q[j + 1]!) <= t && Math.abs(P[i + 2]! - Q[j + 2]!) <= t;
  const isInk = (P: RenderPixels['data'], i: number) =>
    Math.abs(P[i]! - br) > 8 || Math.abs(P[i + 1]! - bg) > 8 || Math.abs(P[i + 2]! - bb) > 8;

  let inked = 0, bad = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ia = (y * a.width + x) * 4, ib = (y * b.width + x) * 4;
      if (isInk(A, ia) || isInk(B, ib)) inked++;
      if (near(ia, ib, A, B)) continue;
      let ok1 = false, ok2 = false;
      for (let dy = -1; dy <= 1 && !(ok1 && ok2); dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          if (!ok1 && near((yy * a.width + xx) * 4, ib, A, B)) ok1 = true;
          if (!ok2 && near((yy * b.width + xx) * 4, ia, B, A)) ok2 = true;
        }
      }
      if (ok1 && ok2) continue;
      bad++;
      mask[y * w + x] = 1;
    }
  }
  // Different sizes cannot be the same artwork, whatever the overlap says.
  const fraction = a.width !== b.width || a.height !== b.height ? 1 : bad / Math.max(1, inked);
  return { fraction, mask, inked, differing: bad };
}
