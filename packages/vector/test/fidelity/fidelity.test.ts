import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { importSvg } from '../../src/index';
import { CORPUS_DIR, loadFixture, render, reconstruct, mismatch, testFonts } from './harness';

/**
 * Every corpus file, imported, must look the same as the original.
 *
 * Each file imitates what a real tool exports - Illustrator's class-based
 * styling and clip groups, Figma's masks and image patterns, Inkscape's
 * gradient chains, Canva's embedded photographs, potrace, SVGO - and the
 * comparison is pixels from a real renderer, not a list of features someone
 * remembered to check. A new way an SVG can go wrong only needs a new file
 * here to become a failing test.
 */

/** Things the importer deliberately does not reproduce, and must SAY so. */
const REPORTED: Record<string, { max: number; warning: RegExp }> = {
  'filter-shadow.svg': { max: 0.1, warning: /filter/ },
};

const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.svg')).sort();

describe('import fidelity against a real renderer', () => {
  it('has a corpus', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  for (const file of files) {
    it(file, () => {
      const src = loadFixture(file);
      const res = importSvg(src, { fonts: testFonts });
      const { fraction } = mismatch(render(src, 300), render(reconstruct(res), 300));
      const known = REPORTED[file];
      if (known) {
        expect(res.warnings.join(' ')).toMatch(known.warning);
        expect(fraction).toBeLessThan(known.max);
      } else {
        expect(fraction, `${(fraction * 100).toFixed(2)}% of the artwork differs`).toBeLessThan(0.01);
      }
    }, 30000);
  }
});

/**
 * Where the reference renderer itself is wrong.
 *
 * resvg draws these three as black, black and blue. A browser - checked in
 * Chromium, pixel by pixel - draws them as below, and what a file looks like
 * in a browser is what a customer believes it looks like.
 */
describe('browser-verified cases resvg gets wrong', () => {
  const one = (body: string) => importSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${body}</svg>`).shapes[0]!;

  it('knows rebeccapurple', () => {
    expect(one('<rect width="10" height="10" fill="rebeccapurple"/>').fill).toEqual([102, 51, 153]);
  });

  it('reads the space-separated colour syntax, alpha included', () => {
    const s = one('<rect width="10" height="10" style="fill: rgb(10 20 30 / 60%)"/>');
    expect(s.fill).toEqual([10, 20, 30]);
    expect(s.opacity).toBeCloseTo(0.6, 6);
  });

  it('lets an !important rule beat an ordinary inline style', () => {
    const s = one('<style>.imp { fill: #00aa00 !important }</style>'
      + '<rect class="imp" width="10" height="10" style="fill:#0000ff"/>');
    expect(s.fill).toEqual([0, 170, 0]);
  });

  it('anchors tracked text on its whole advance, last letter-space included', () => {
    // Measured in Chrome with getStartPositionOfChar: Inter Bold 28px "END",
    // letter-spacing 2, text-anchor end at x=290, starts at x=225.43 - the
    // three advances (58.57) plus three spaces, not two.
    const r = importSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120">'
      + '<text x="290" y="80" text-anchor="end" font-family="Inter" font-weight="700" font-size="28" letter-spacing="2">END</text></svg>',
    { fonts: testFonts });
    const xs = r.shapes.flatMap((s) => s.subpaths.flatMap((sp) => sp.points.map((p) => p.x)));
    // E's stem starts at its left side bearing; Inter Bold's is ~1.9px at 28px.
    expect(Math.min(...xs)).toBeGreaterThan(225.43);
    expect(Math.min(...xs)).toBeLessThan(225.43 + 3);
    // And the D's right edge stops short of the anchor by the trailing space.
    expect(Math.max(...xs)).toBeLessThan(288.5);
  });
});
