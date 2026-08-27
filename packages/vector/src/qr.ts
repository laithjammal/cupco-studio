/**
 * QR codes as vector artwork.
 *
 * Produced as PlacedArtwork so a QR travels the exact same path as an
 * uploaded logo: it warps onto the fan, exports as vector CMYK, and prints as
 * crisp squares at any size. Rasterising a QR would be the one thing
 * guaranteed to make it unscannable in print.
 */

import qrcode from 'qrcode-generator';
import type { PlacedArtwork } from './place';
import type { RGB } from './color';

export interface QrOptions {
  /**
   * Error correction. 'M' (~15% recoverable) is the sensible default for a
   * printed cup: 'L' is fragile once a cup is handled, 'H' inflates the module
   * count and makes each square smaller.
   */
  level?: 'L' | 'M' | 'Q' | 'H';
  /** Quiet zone in modules. The spec requires 4; less and scanners fail. */
  quietZone?: number;
  dark?: RGB;
}

export interface QrResult {
  art: PlacedArtwork;
  /** Modules per side, excluding the quiet zone. */
  moduleCount: number;
  /** Number of vector rectangles emitted. */
  pathCount: number;
}

/**
 * Build a QR code as vector artwork.
 *
 * Horizontal runs of dark modules are merged into single rectangles rather
 * than emitting one per module. A 25x25 code has ~300 dark modules but only
 * ~90 runs, which keeps the exported PDF small and the warp fast.
 */
export function buildQrArtwork(text: string, options: QrOptions = {}): QrResult {
  const level = options.level ?? 'M';
  const quiet = options.quietZone ?? 4;
  const dark = options.dark ?? ([0, 0, 0] as RGB);

  const qr = qrcode(0, level); // 0 = choose the smallest version that fits
  qr.addData(text);
  qr.make();

  const n = qr.getModuleCount();
  const total = n + quiet * 2;
  const u = 1 / total; // one module, normalised

  const subpaths: { x: number; y: number }[][] = [];
  for (let row = 0; row < n; row++) {
    let runStart = -1;
    for (let col = 0; col <= n; col++) {
      const isDark = col < n && qr.isDark(row, col);
      if (isDark && runStart < 0) runStart = col;
      if (!isDark && runStart >= 0) {
        const x0 = (runStart + quiet) * u;
        const x1 = (col + quiet) * u;
        const y0 = (row + quiet) * u;
        const y1 = (row + 1 + quiet) * u;
        subpaths.push([
          { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 },
        ]);
        runStart = -1;
      }
    }
  }

  return {
    art: { aspect: 1, shapes: [{ subpaths, fill: dark, opacity: 1 }] },
    moduleCount: n,
    pathCount: subpaths.length,
  };
}

/** A URL that will actually resolve, or null. */
export function normaliseUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    // A bare word parses as a URL but is not a reachable host.
    if (!u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}
