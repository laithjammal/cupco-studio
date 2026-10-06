/**
 * A warped picture, written into the vector PDF as CMYK.
 *
 * pdf-lib can only embed a PNG as RGB, and an RGB image in an otherwise CMYK
 * file leaves the colour conversion to whatever RIP happens to open it - the
 * one thing the vector export exists to avoid. So the image is built by hand:
 * DeviceCMYK samples through the same conversion as every flat colour on the
 * fan, with the picture's coverage as a soft mask.
 */

import {
  concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState,
  type PDFDocument, type PDFPage,
} from 'pdf-lib';
import { rgbToCmyk } from '@cupco/vector';
import type { FanPicture } from '@cupco/render';

/** How fan millimetres map onto the page: the same origin the paths use. */
export interface PagePlacement {
  minX: number;
  minY: number;
  pageH: number;
  ptPerMm: number;
}

/** CMYK samples and coverage for a picture, 8 bits a channel. */
export function cmykSamples(pic: FanPicture): { cmyk: Uint8Array; alpha: Uint8Array } {
  const { width, height, data } = pic.image;
  const cmyk = new Uint8Array(width * height * 4);
  const alpha = new Uint8Array(width * height);
  const memo = new Map<number, number>();
  for (let i = 0; i < width * height; i++) {
    const a = data[i * 4 + 3]!;
    alpha[i] = a;
    if (a === 0) continue;
    const key = (data[i * 4]! << 16) | (data[i * 4 + 1]! << 8) | data[i * 4 + 2]!;
    let packed = memo.get(key);
    if (packed === undefined) {
      const v = rgbToCmyk([data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!]);
      packed = ((Math.round(v.c * 255) << 24) | (Math.round(v.m * 255) << 16)
        | (Math.round(v.y * 255) << 8) | Math.round(v.k * 255)) >>> 0;
      memo.set(key, packed);
    }
    cmyk[i * 4] = (packed >>> 24) & 255;
    cmyk[i * 4 + 1] = (packed >>> 16) & 255;
    cmyk[i * 4 + 2] = (packed >>> 8) & 255;
    cmyk[i * 4 + 3] = packed & 255;
  }
  return { cmyk, alpha };
}

/** Draw one warped picture onto the page, at the point in the paint order it is called. */
export function drawFanPicture(pdf: PDFDocument, page: PDFPage, pic: FanPicture, at: PagePlacement): void {
  const { width: W, height: H } = pic.image;
  const { cmyk, alpha } = cmykSamples(pic);
  const ctx = pdf.context;
  const mask = ctx.register(ctx.flateStream(alpha, {
    Type: 'XObject', Subtype: 'Image', Width: W, Height: H,
    ColorSpace: 'DeviceGray', BitsPerComponent: 8,
  }));
  const image = ctx.register(ctx.flateStream(cmyk, {
    Type: 'XObject', Subtype: 'Image', Width: W, Height: H,
    ColorSpace: 'DeviceCMYK', BitsPerComponent: 8, SMask: mask,
  }));
  const name = page.node.newXObject('Im', image);

  // Image space is the unit square with row 0 at the TOP; the page is y-up.
  const wPt = W * pic.mmPerPixel * at.ptPerMm;
  const hPt = H * pic.mmPerPixel * at.ptPerMm;
  const x = (pic.originXMm - at.minX) * at.ptPerMm;
  const top = at.pageH - (pic.originYMm - at.minY) * at.ptPerMm;
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(wPt, 0, 0, hPt, x, top - hPt),
    drawObject(name),
    popGraphicsState(),
  );
}
