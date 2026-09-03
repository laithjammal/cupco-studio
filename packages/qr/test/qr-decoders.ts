/**
 * Two independent QR decoders, for the style tests.
 *
 * Using two is the whole point. They disagree sharply about separated modules:
 * ZXing reads dots down to 0.70 of a module, jsQR reads nothing below a full
 * one. A customer holding a cup has no idea which decoder is inside whichever
 * app they opened, so a style only ships if BOTH read it.
 *
 * ZXing is the algorithm behind most native phone scanners; jsQR is what
 * browser-based scanners typically use.
 */

import jsQRimport from 'jsqr';
import {
  MultiFormatReader, BinaryBitmap, HybridBinarizer, RGBLuminanceSource,
  DecodeHintType, BarcodeFormat,
} from '@zxing/library';

const jsQRfn = (jsQRimport as unknown as { default?: typeof jsQRimport }).default ?? jsQRimport;

export function decodeWithJsQr(pixels: Uint8ClampedArray, size: number): string | null {
  return jsQRfn(pixels, size, size)?.data ?? null;
}

export function decodeWithZxing(pixels: Uint8ClampedArray, size: number): string | null {
  const buf = new Int32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const v = pixels[i * 4]!;
    buf[i] = (0xff << 24) | (v << 16) | (v << 8) | v;
  }
  const reader = new MultiFormatReader();
  // ZXing logs a stack trace from its own internals on a failed read. That is
  // normal control flow here - half these calls are meant to fail - so the
  // logger is muted for the duration rather than filling the test output.
  const realWarn = console.warn, realLog = console.log;
  console.warn = () => {}; console.log = () => {};
  const hints = new Map();
  // QR only. Without this, ZXing runs its 1D barcode readers first and logs a
  // stack trace for each one before reaching the reader we actually want.
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  reader.setHints(hints);
  try {
    return reader.decode(
      new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(buf, size, size))),
    ).getText();
  } catch {
    return null;
  } finally {
    console.warn = realWarn; console.log = realLog;
  }
}

/**
 * Shrink each subpath towards its own centre.
 *
 * Simulates modules smaller than their cell without exposing the dot diameter
 * as an option - the tests need to reproduce the finding that set it, not to
 * make it configurable in the product.
 */
export function shrinkEach(
  subpaths: readonly (readonly { x: number; y: number }[])[],
  factor: number,
): { x: number; y: number }[][] {
  return subpaths.map((sp) => {
    let cx = 0, cy = 0;
    for (const p of sp) { cx += p.x; cy += p.y; }
    cx /= sp.length; cy /= sp.length;
    return sp.map((p) => ({ x: cx + (p.x - cx) * factor, y: cy + (p.y - cy) * factor }));
  });
}

export const DECODERS = [
  ['jsQR', decodeWithJsQr],
  ['ZXing', decodeWithZxing],
] as const;
