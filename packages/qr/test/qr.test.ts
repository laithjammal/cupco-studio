import { describe, it, expect } from 'vitest';
import { buildQrArtwork, normaliseUrl } from '../src/index';

describe('QR codes', () => {
  it('encodes a URL into a scannable grid', () => {
    const { art, moduleCount, pathCount } = buildQrArtwork('https://cupco.com.au');
    expect(moduleCount).toBeGreaterThanOrEqual(21); // smallest valid QR version
    expect(art.aspect).toBe(1);                     // must stay square
    expect(pathCount).toBeGreaterThan(20);
  });

  it('merges horizontal runs instead of one rect per module', () => {
    // A per-module emit would bloat the PDF and slow the warp.
    const { moduleCount, pathCount } = buildQrArtwork('https://cupco.com.au');
    expect(pathCount).toBeLessThan(moduleCount * moduleCount * 0.3);
  });

  it('longer data needs a bigger grid', () => {
    const small = buildQrArtwork('a').moduleCount;
    const large = buildQrArtwork('x'.repeat(300)).moduleCount;
    expect(large).toBeGreaterThan(small);
  });

  it('every module sits inside the unit box, quiet zone included', () => {
    const { art } = buildQrArtwork('https://cupco.com.au');
    for (const sp of art.shapes[0]!.subpaths) {
      for (const p of sp) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
      }
    }
  });

  it('leaves a quiet zone — scanners fail without one', () => {
    const { art, moduleCount } = buildQrArtwork('https://cupco.com.au');
    const all = art.shapes[0]!.subpaths.flat();
    const minX = Math.min(...all.map((p) => p.x));
    const expected = 4 / (moduleCount + 8); // 4 modules of margin
    expect(minX).toBeGreaterThanOrEqual(expected - 1e-9);
  });

  it('is deterministic for the same URL', () => {
    expect(JSON.stringify(buildQrArtwork('https://cupco.com.au')))
      .toBe(JSON.stringify(buildQrArtwork('https://cupco.com.au')));
  });
});

describe('URL normalisation', () => {
  it.each([
    ['cupco.com.au', 'https://cupco.com.au/'],
    ['https://cupco.com.au', 'https://cupco.com.au/'],
    ['http://a.b/c?d=1', 'http://a.b/c?d=1'],
  ])('%s -> %s', (input, expected) => {
    expect(normaliseUrl(input)).toBe(expected);
  });

  it.each(['', '   ', 'not a url', 'localhost', 'https://'])(
    'rejects %s',
    (bad) => { expect(normaliseUrl(bad)).toBeNull(); },
  );
});
