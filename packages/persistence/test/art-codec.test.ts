import { describe, it, expect } from 'vitest';
import { quantiseArt, encodeJson, hashBytes, MAX_QUANTISATION_ERROR } from '../src/index';
import type { StoredArt } from '../src/index';

const art = (pts: [number, number][]): StoredArt => ({
  aspect: 1,
  shapes: [{ fill: [0, 0, 0], opacity: 1, subpaths: [pts.map(([x, y]) => ({ x, y }))] }],
});

describe('artwork quantisation', () => {
  it('never moves a point further than the stated bound', () => {
    const raw = art([
      [0.34827159881591797, 0.9999999999],
      [0.1234564999999, 0.87654321987],
      [0.5000005, 0.4999995],
    ]);
    const q = quantiseArt(raw);
    const before = raw.shapes[0]!.subpaths[0]!;
    const after = q.shapes[0]!.subpaths[0]!;

    for (let i = 0; i < before.length; i++) {
      expect(Math.abs(after[i]!.x - before[i]!.x)).toBeLessThanOrEqual(MAX_QUANTISATION_ERROR);
      expect(Math.abs(after[i]!.y - before[i]!.y)).toBeLessThanOrEqual(MAX_QUANTISATION_ERROR);
    }
  });

  it('stays far below the export flatness tolerance in real millimetres', () => {
    // The claim in art-codec.ts, checked in physical units rather than
    // restated: a logo at widthU 0.25 on the 8oz blank spans about 60mm, so
    // one normalised unit is 60mm. The path warper's tolerance is 0.02mm.
    const logoWidthMm = 60;
    const errorMm = MAX_QUANTISATION_ERROR * logoWidthMm;
    const flatnessToleranceMm = 0.02;

    expect(errorMm).toBeLessThan(flatnessToleranceMm / 100);
    // Spelled out so a future change to COORD_PRECISION fails loudly here.
    expect(errorMm).toBeCloseTo(0.00006, 7);
  });

  it('makes the content hash stable against low-bit noise', async () => {
    // Two paths that differ only below the quantisation floor must land on the
    // same asset, or every re-save would store a fresh copy of the same logo.
    const a = quantiseArt(art([[0.5, 0.25]]));
    const b = quantiseArt(art([[0.5 + 1e-12, 0.25 - 1e-12]]));
    expect(await hashBytes(encodeJson(a))).toBe(await hashBytes(encodeJson(b)));
  });

  it('distinguishes points that differ above the floor', async () => {
    const a = quantiseArt(art([[0.5, 0.25]]));
    const b = quantiseArt(art([[0.5001, 0.25]]));
    expect(await hashBytes(encodeJson(a))).not.toBe(await hashBytes(encodeJson(b)));
  });

  it('normalises negative zero so the hash cannot fork on it', async () => {
    // -0 and 0 are ===, but JSON.stringify writes them as "0" and "-0". Left
    // alone, the same artwork could hash two different ways.
    const q = quantiseArt(art([[-1e-9, 0]]));
    expect(Object.is(q.shapes[0]!.subpaths[0]![0]!.x, -0)).toBe(false);
    expect(await hashBytes(encodeJson(q))).toBe(await hashBytes(encodeJson(quantiseArt(art([[0, 0]])))));
  });

  it('shrinks the stored payload substantially', () => {
    const noisy = art(Array.from({ length: 2000 }, (_, i) => [
      Math.sin(i) * 0.5 + 0.5, Math.cos(i) * 0.5 + 0.5,
    ] as [number, number]));
    const before = encodeJson(noisy).byteLength;
    const after = encodeJson(quantiseArt(noisy)).byteLength;
    expect(after).toBeLessThan(before * 0.7);
  });

  it('preserves shape count, fill and aspect', () => {
    const raw: StoredArt = {
      aspect: 0.5123456789,
      shapes: [
        { fill: [12, 34, 56], opacity: 0.5, subpaths: [[{ x: 0, y: 0 }]] },
        { fill: [255, 0, 0], opacity: 1, subpaths: [[{ x: 1, y: 1 }]] },
      ],
    };
    const q = quantiseArt(raw);
    expect(q.shapes).toHaveLength(2);
    expect(q.shapes[0]!.fill).toEqual([12, 34, 56]);
    expect(q.shapes[1]!.fill).toEqual([255, 0, 0]);
    expect(q.aspect).toBeCloseTo(0.5123456789, 6);
  });
});

/**
 * quantiseArt rebuilds a shape field by field, so anything not named is
 * dropped on save. fillRule was - which meant an imported logo arrived
 * correct, then came back from storage filling even-odd and grew holes it
 * never had. Anything added to a shape in future needs a line here too.
 */
describe('quantiseArt keeps what a shape needs', () => {
  const shape = (fillRule?: 'nonzero' | 'evenodd') => ({
    fill: [1, 2, 3] as const,
    opacity: 0.5,
    subpaths: [[{ x: 0.123456789, y: 0.987654321 }]],
    ...(fillRule ? { fillRule } : {}),
  });

  it('round-trips an explicit fill rule', () => {
    expect(quantiseArt({ aspect: 1, shapes: [shape('nonzero')] } as never)
      .shapes[0]!.fillRule).toBe('nonzero');
    expect(quantiseArt({ aspect: 1, shapes: [shape('evenodd')] } as never)
      .shapes[0]!.fillRule).toBe('evenodd');
  });

  it('leaves it absent when the artwork never stated one', () => {
    expect(quantiseArt({ aspect: 1, shapes: [shape()] } as never)
      .shapes[0]!.fillRule).toBeUndefined();
  });

  it('survives a JSON round trip, which is how it is actually stored', () => {
    const out = JSON.parse(JSON.stringify(
      quantiseArt({ aspect: 1, shapes: [shape('nonzero')] } as never)));
    expect(out.shapes[0].fillRule).toBe('nonzero');
  });
});
