'use client';

/**
 * Runtime Design -> PreflightDesign.
 *
 * The rules deliberately do no geometry of their own. This is where an element
 * gets measured, and it measures with `elementCorners` and `halfExtent` - the
 * SAME functions that draw the selection box and drive dragging.
 *
 * That is the whole point. A preflight that measured independently would
 * eventually disagree with the outline the operator is looking at, and then it
 * would be warning about a cup that is not on screen.
 */

import { hexToRgb, rgbToCmyk } from '@cupco/vector';
import type { CMYK } from '@cupco/vector';
import type { PreflightDesign, PreflightElement } from '@cupco/preflight';
import { elementCorners, halfExtent, stretchOf } from './design';
import type { Design, DesignElement, VectorElement } from './design';

const BLACK: CMYK = { c: 0, m: 0, y: 0, k: 1 };

/**
 * Every flat ink an element lays down.
 *
 * Bitmaps return nothing: their coverage is per-pixel and cannot be summarised
 * without reading the image. The ink rule documents that it does not cover
 * them, rather than this pretending otherwise by returning an average.
 */
function inksFor(el: DesignElement): CMYK[] {
  switch (el.type) {
    case 'text':
    case 'band':
      return [rgbToCmyk(hexToRgb(el.color))];
    case 'vector':
      return el.art.shapes.map((s) => rgbToCmyk(s.fill));
    case 'qr':
      // A QR is drawn as black modules on a white ground it paints itself.
      return [BLACK];
    case 'image':
      return [];
  }
}

/**
 * The least-resolved picture inside vector artwork, as the resolution rule
 * wants it: pixel width scaled up to what it would be across the whole
 * element. A photo filling a quarter of the badge's width at 300px reads as
 * a 1200px element, so the rule's own arithmetic gives the photo's real dpi.
 */
function embeddedPicture(el: VectorElement): PreflightElement['image'] | undefined {
  let worst: { naturalWidth: number; naturalHeight: number; embedded: true } | undefined;
  const yScale = el.art.aspect * stretchOf(el);
  for (const r of el.art.rasters ?? []) {
    const share = Math.hypot(r.matrix[0], r.matrix[1] * yScale);
    if (!(share > 0)) continue;
    const across = r.naturalWidth / share;
    if (!worst || across < worst.naturalWidth) {
      worst = { naturalWidth: across, naturalHeight: r.naturalHeight / share, embedded: true };
    }
  }
  return worst;
}

export function toPreflightDesign(
  design: Design,
  canvasW: number,
  canvasH: number,
  measure?: CanvasRenderingContext2D,
): PreflightDesign {
  const elements: PreflightElement[] = design.elements.map((el) => {
    const { du, dv } = halfExtent(el, canvasW, canvasH, measure);
    const base: PreflightElement = {
      id: el.id,
      kind: el.type,
      name: el.name,
      u: el.u,
      v: el.v,
      widthU: du * 2,
      heightV: dv * 2,
      rotation: el.rotation,
      corners: elementCorners(el, canvasW, canvasH, measure),
      opacity: el.opacity ?? 1,
      inks: inksFor(el),
    };

    if (el.type === 'image') {
      return {
        ...base,
        image: {
          naturalWidth: el.image.naturalWidth,
          naturalHeight: el.image.naturalHeight,
        },
      };
    }
    if (el.type === 'text') {
      return { ...base, text: { content: el.content, sizeV: el.sizeV } };
    }
    if (el.type === 'qr') {
      return {
        ...base,
        qr: { url: el.url, live: el.live, moduleCount: el.moduleCount },
      };
    }
    if (el.type === 'vector') {
      const image = embeddedPicture(el);
      if (image) return { ...base, image };
    }
    return base;
  });

  return { background: rgbToCmyk(hexToRgb(design.background)), elements };
}
