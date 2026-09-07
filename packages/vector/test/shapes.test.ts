/**
 * Basic shapes.
 *
 * A shape is a PlacedArtwork - the same thing an imported SVG becomes - so
 * these tests are mostly about that contract holding, since everything
 * downstream (the warp, the exporter, preflight) relies on it and none of it
 * knows a rectangle from a logo.
 */
import { describe, it, expect } from 'vitest';
import { SHAPES, buildShapeArtwork, placeArtwork, type ShapeId } from '../src/index';

const BLACK = [0, 0, 0] as const;
const ids = SHAPES.map((s) => s.id);

describe('shape artwork', () => {
  it.each(ids)('%s produces one closed ring inside the unit box', (id) => {
    const art = buildShapeArtwork(id, BLACK);
    expect(art.shapes).toHaveLength(1);
    const ring = art.shapes[0]!.subpaths[0]!;
    expect(ring.length).toBeGreaterThanOrEqual(4);

    // Closed: the rest of the system fills these as rings.
    expect(ring[0]!.x).toBeCloseTo(ring[ring.length - 1]!.x, 12);
    expect(ring[0]!.y).toBeCloseTo(ring[ring.length - 1]!.y, 12);

    for (const p of ring) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-9);
      expect(p.x).toBeLessThanOrEqual(1 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(-1e-9);
      expect(p.y).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it.each(ids)('%s fills its box on both axes', (id) => {
    // A shape that did not reach its own bounds would arrive smaller than the
    // size the user set, and inconsistently between shapes.
    const ring = buildShapeArtwork(id, BLACK).shapes[0]!.subpaths[0]!;
    const xs = ring.map((p) => p.x), ys = ring.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(1, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(1, 6);
  });

  it('carries the fill through, so it is recolourable', () => {
    const art = buildShapeArtwork('circle', [12, 34, 56]);
    expect(art.shapes[0]!.fill).toEqual([12, 34, 56]);
    expect(art.shapes[0]!.opacity).toBe(1);
  });

  it('rejects an unknown shape rather than emitting an empty one', () => {
    expect(() => buildShapeArtwork('hexagon' as ShapeId, BLACK)).toThrow(/unknown shape/);
  });

  /**
   * The circle is a polygon. What matters is not that it is one, but that the
   * error is invisible in print: the fan export flattens curves to 0.1mm, so
   * anything well under that is indistinguishable from a true arc.
   */
  it('approximates the circle to far better than the export tolerance', () => {
    const ring = buildShapeArtwork('circle', BLACK).shapes[0]!.subpaths[0]!;
    const segs = ring.length - 1;
    const radiusMm = 30;                       // a big circle on an 8oz cup
    const sagittaMm = radiusMm * (1 - Math.cos(Math.PI / segs));
    expect(sagittaMm).toBeLessThan(0.01);

    // And every vertex really is on the circle.
    for (const p of ring) {
      expect(Math.hypot(p.x - 0.5, p.y - 0.5)).toBeCloseTo(0.5, 9);
    }
  });

  it('a stretched shape is taller but no wider', () => {
    const art = buildShapeArtwork('circle', BLACK);
    const t = { u: 0.5, v: 0.5, widthU: 0.2, rotation: 0, canvasW: 2732, canvasH: 1069 };
    const plain = placeArtwork(art, t)[0]!.subpaths[0]!;
    const tall = placeArtwork(art, { ...t, stretchV: 2 })[0]!.subpaths[0]!;

    const span = (pts: { u: number; v: number }[], k: 'u' | 'v') =>
      Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k]));

    expect(span(tall, 'u')).toBeCloseTo(span(plain, 'u'), 9);
    expect(span(tall, 'v')).toBeCloseTo(span(plain, 'v') * 2, 9);
  });

  it('omitting the stretch is the same as setting it to 1', () => {
    const art = buildShapeArtwork('rectangle', BLACK);
    const t = { u: 0.4, v: 0.6, widthU: 0.3, rotation: 12, canvasW: 2732, canvasH: 1069 };
    expect(placeArtwork(art, t)).toEqual(placeArtwork(art, { ...t, stretchV: 1 }));
  });
});
