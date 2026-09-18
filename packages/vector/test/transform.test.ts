import { describe, it, expect } from 'vitest';
import { dropBackgroundPlate } from '../src/transform';
import type { RGB } from '../src/color';

/**
 * Background plates that are not rectangles.
 *
 * Round badges are how a great many cafe logos are drawn, and the rectangle
 * test missed every one: it caps out at six points and a circle arrives as
 * ninety-seven. The mark then sat on an opaque disc of paper-coloured fill,
 * and when a concept lightened it for a dark ground the result was pale type
 * on a pale plate - invisible, with nothing reporting a failure.
 */
describe('dropBackgroundPlate beyond rectangles', () => {
  const ring = (n: number, r = 0.5) => Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return { x: 0.5 + r * Math.cos(t), y: 0.5 + r * Math.sin(t) };
  });
  const rect = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }];
  const mark = [{ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.3 }, { x: 0.5, y: 0.7 }];
  const art = (plate: { x: number; y: number }[], fill: RGB) => ({
    aspect: 1,
    shapes: [
      { subpaths: [plate], fill, opacity: 1 },
      { subpaths: [mark], fill: [41, 35, 31] as RGB, opacity: 1 },
    ],
  });
  const dropped = (plate: { x: number; y: number }[], fill: RGB) =>
    dropBackgroundPlate(art(plate, fill) as never).shapes.length === 1;

  it('drops a pale disc, which is the case that was reaching customers', () => {
    expect(dropped(ring(97), [245, 233, 210])).toBe(true);   // cream
    expect(dropped(ring(97), [255, 255, 255])).toBe(true);   // white
  });

  it('still drops a rectangle whatever colour it is', () => {
    // A full-bleed rectangle behind a mark is an export artefact, always.
    expect(dropped(rect, [255, 255, 255])).toBe(true);
    expect(dropped(rect, [200, 16, 46])).toBe(true);
  });

  it('KEEPS a coloured roundel, because that is the logo', () => {
    // The whole reason the non-rectangular test also checks colour. A green
    // roundel with white type is a design; removing it destroys the mark.
    expect(dropped(ring(97), [29, 63, 43])).toBe(false);
    expect(dropped(ring(97), [200, 16, 46])).toBe(false);
  });

  it('keeps shapes that are not solid enough to be a ground', () => {
    const star = [
      { x: 0, y: 0.5 }, { x: 0.35, y: 0.35 }, { x: 0.5, y: 0 }, { x: 0.65, y: 0.35 },
      { x: 1, y: 0.5 }, { x: 0.65, y: 0.65 }, { x: 0.5, y: 1 }, { x: 0.35, y: 0.65 },
    ];
    expect(dropped(star, [255, 255, 255])).toBe(false);
  });

  it('keeps anything that does not reach the edges', () => {
    expect(dropped(ring(97, 0.25), [255, 255, 255])).toBe(false);
  });
});
