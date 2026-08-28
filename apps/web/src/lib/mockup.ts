'use client';

/**
 * Render a mockup: one scene, with this design on the cup.
 *
 * These images get sent to customers, so two things follow that would not
 * matter for an on-screen preview:
 *
 *   1. Resolution is a parameter. What looks fine in a 300px card is unusable
 *      in an email or a deck, so the download re-renders at full size rather
 *      than upscaling the thumbnail.
 *
 *   2. The CMYK proof setting is honoured. A customer approving a mockup in
 *      vivid screen colour and receiving duller printed stock is a complaint
 *      that lands on Cupco, not on the screen. If the operator is proofing,
 *      the mockup proofs too.
 */

import { renderDesignToCanvas } from './design';
import type { Design } from './design';
import { renderCup } from './cup-render';
import type { CupImage } from './cup-render';
import { getScene } from './mockup-scenes';
import type { CupProfile, FrustumGeometry } from '@cupco/geometry';

export interface MockupOptions {
  /** Output width in pixels. The height follows the scene's aspect. */
  widthPx: number;
  /** Show the design as CMYK ink rather than screen colour. */
  proofCmyk?: boolean;
}

/** Design canvas resolution used to texture the cup, relative to output size. */
const DESIGN_OVERSAMPLE = 2.2;

export function renderMockup(
  sceneId: string,
  design: Design,
  profile: CupProfile,
  geom: FrustumGeometry,
  options: MockupOptions,
): HTMLCanvasElement {
  const scene = getScene(sceneId);
  const w = Math.max(64, Math.round(options.widthPx));
  const h = Math.round(w / scene.aspect);

  // The design is sampled per output pixel, so it needs to out-resolve the
  // cup comfortably - the middle of the face is magnified by the projection.
  const designW = Math.round(w * DESIGN_OVERSAMPLE);
  const { widthPx: cw, heightPx: ch } = profile.designCanvas;
  const designCanvas = renderDesignToCanvas(
    design,
    designW,
    Math.max(1, Math.round((designW * ch) / cw)),
    undefined,
    { proofCmyk: options.proofCmyk ?? false },
  );

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');

  // One render per angle a scene asks for, cached: the pair scene wants two,
  // everything else wants one, and each is a full per-pixel pass.
  const cache = new Map<number, CupImage>();
  const cupHeight = Math.round(h * scene.cupScale * 1.35);
  const getCup = (centreU?: number): CupImage => {
    const key = centreU ?? scene.centreU;
    const hit = cache.get(key);
    if (hit) return hit;
    const made = renderCup(designCanvas, geom, cupHeight, {
      centreU: key,
      tiltRad: scene.tiltRad,
      exposure: scene.exposure,
      lightFrom: scene.lightFrom,
    });
    cache.set(key, made);
    return made;
  };

  scene.paint(ctx, w, h, getCup);
  return canvas;
}

/** Encode a rendered mockup for download. */
export function mockupBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('could not encode the mockup'))),
      'image/png',
    );
  });
}

export function mockupFilename(profile: CupProfile, sceneId: string, projectName: string): string {
  const safe = projectName.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return `${safe || 'cupco'}-${profile.sizeOz}oz-${sceneId}.png`;
}
