import { describe, it, expect } from 'vitest';
import { deriveFrustum, CUP_8OZ } from '@cupco/geometry';
import {
  generateConcepts, STRATEGIES, safeBounds, contrastRatio, luminance,
  chooseBackground, chooseForeground, isDark, shade,
  type ConceptInput,
} from '../src/index';
import { hexToRgb, type RGB } from '@cupco/vector';

const geom = deriveFrustum(CUP_8OZ.dimensions);

const input = (over: Partial<ConceptInput> = {}): ConceptInput => ({
  artworkAspect: 0.5,
  palette: [[232, 85, 45], [28, 63, 148], [255, 255, 255]],
  profile: CUP_8OZ,
  geom,
  brandName: 'Cupco',
  seed: 7,
  ...over,
});

describe('contrast helpers', () => {
  it('luminance orders black < mid < white', () => {
    expect(luminance([0, 0, 0])).toBeCloseTo(0, 6);
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 6);
    expect(luminance([128, 128, 128])).toBeGreaterThan(0.1);
    expect(luminance([128, 128, 128])).toBeLessThan(0.4);
  });

  it('contrast ratio spans the WCAG range', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);
    expect(contrastRatio([120, 120, 120], [120, 120, 120])).toBeCloseTo(1, 6);
  });

  it('shade stays within gamut', () => {
    for (const c of [[0, 0, 0], [255, 255, 255], [200, 30, 90]] as RGB[]) {
      for (const amt of [-1, -0.5, 0, 0.5, 1]) {
        for (const v of shade(c, amt)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(255);
        }
      }
    }
  });

  it('never puts a colour on itself', () => {
    // The failure this guards: a dark navy logo on a dark navy ground.
    const navy: RGB = [28, 63, 148];
    const bg = chooseBackground([navy], navy);
    expect(contrastRatio(bg, navy)).toBeGreaterThan(3);
  });

  it('picks a palette colour when one contrasts enough', () => {
    const bg = chooseBackground([[255, 255, 255], [20, 20, 20]], [20, 20, 20]);
    expect(bg).toEqual([255, 255, 255]);
  });

  it('foreground reads against its background', () => {
    for (const bg of [[10, 10, 10], [250, 250, 250], [120, 30, 60]] as RGB[]) {
      const fg = chooseForeground(bg, [[128, 128, 128]]);
      expect(contrastRatio(fg, bg)).toBeGreaterThan(3);
    }
  });

  it('classifies dark and light grounds', () => {
    expect(isDark([12, 20, 40])).toBe(true);
    expect(isDark([240, 240, 235])).toBe(false);
  });
});

describe('generateConcepts', () => {
  it('produces a useful number of concepts', () => {
    const out = generateConcepts(input());
    expect(out.length).toBeGreaterThanOrEqual(5);
    expect(out.length).toBeLessThanOrEqual(10);
  });

  it('is deterministic — the same upload gives the same proposals', () => {
    // A customer who reloads must not be shown a different set.
    expect(JSON.stringify(generateConcepts(input())))
      .toBe(JSON.stringify(generateConcepts(input())));
  });

  it('every concept is visually distinct, not one idea rescaled', () => {
    const out = generateConcepts(input());
    const signatures = out.map((c) => {
      const kinds = c.placements.map((p) => p.kind).sort().join(',');
      return `${c.placements.length}|${kinds}|${c.background}`;
    });
    // Allow a little overlap, but most must differ structurally.
    expect(new Set(signatures).size).toBeGreaterThanOrEqual(out.length - 2);
  });

  it('concept ids are unique', () => {
    const ids = generateConcepts(input()).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('respects the limit', () => {
    expect(generateConcepts(input(), 3)).toHaveLength(3);
  });

  it('every background contrasts with the artwork', () => {
    const subject: RGB = [232, 85, 45];
    for (const c of generateConcepts(input())) {
      expect(contrastRatio(hexToRgb(c.background), subject)).toBeGreaterThan(1.6);
    }
  });

  it('each concept carries a label and an explanation', () => {
    for (const c of generateConcepts(input())) {
      expect(c.label.length).toBeGreaterThan(2);
      expect(c.description.length).toBeGreaterThan(10);
    }
  });
});

describe('placements stay manufacturable', () => {
  const s = safeBounds(CUP_8OZ, geom);

  it('safe bounds derive from the profile margins, not guesses', () => {
    expect(s.vBottom).toBeCloseTo(CUP_8OZ.margins.safeBottomMm / geom.slantMm, 9);
    expect(s.vTop).toBeCloseTo(1 - CUP_8OZ.margins.safeTopMm / geom.slantMm, 9);
  });

  it('no placement centre falls outside the cup', () => {
    for (const c of generateConcepts(input())) {
      for (const p of c.placements) {
        expect(p.v).toBeGreaterThanOrEqual(0);
        expect(p.v).toBeLessThanOrEqual(1);
        expect(p.u).toBeGreaterThanOrEqual(0);
        expect(p.u).toBeLessThanOrEqual(1);
      }
    }
  });

  it('sizes are finite and positive', () => {
    for (const c of generateConcepts(input())) {
      for (const p of c.placements) {
        const size = p.widthU ?? p.sizeV ?? p.heightV;
        expect(Number.isFinite(size)).toBe(true);
        expect(size!).toBeGreaterThan(0);
      }
    }
  });

  /**
   * Height an element actually occupies, computed the way the DESIGN MODEL
   * does it — not the way the strategy does. An earlier version of this test
   * mirrored the strategy's own (inverted) formula, so it happily passed while
   * every generated logo was 6.5x too large.
   */
  const heightVOf = (widthU: number, artworkAspect: number) =>
    widthU * artworkAspect * (CUP_8OZ.designCanvas.widthPx / CUP_8OZ.designCanvas.heightPx);

  it.each([0.3, 0.576, 1, 2, 4])(
    'a centred mark at aspect %s stays inside the safe area',
    (artworkAspect) => {
      const c = generateConcepts(input({ artworkAspect })).find((x) => x.id === 'centred')!;
      const p = c.placements[0]!;
      const halfH = heightVOf(p.widthU!, artworkAspect) / 2;
      expect(p.v - halfH).toBeGreaterThanOrEqual(s.vBottom - 1e-6);
      expect(p.v + halfH).toBeLessThanOrEqual(s.vTop + 1e-6);
    },
  );

  it('a centred mark is modest, not a full wrap', () => {
    // The whole point of the 'centred' concept is restraint; if this creeps
    // above roughly a third of the circumference the sizing maths is wrong.
    const c = generateConcepts(input()).find((x) => x.id === 'centred')!;
    expect(c.placements[0]!.widthU!).toBeLessThan(0.35);
    expect(c.placements[0]!.widthU!).toBeGreaterThan(0.05);
  });

  it('repeating marks are small enough to actually repeat', () => {
    const c = generateConcepts(input()).find((x) => x.id === 'repeat')!;
    // Four across the circumference means each must be well under a quarter.
    expect(c.placements[0]!.widthU!).toBeLessThan(0.25);
  });
});

describe('strategy behaviour', () => {
  it('the wordmark shows a placeholder rather than disappearing', () => {
    // Hiding the concept when no name is set would deprive the customer of a
    // layout they can simply type over.
    const c = generateConcepts(input({ brandName: '' })).find((x) => x.id === 'wordmark')!;
    const text = c.placements.find((p) => p.kind === 'text')!;
    expect(text.text).toBe('TYPE YOUR NAME');
  });

  it('the wordmark uses the brand name when one is given', () => {
    const c = generateConcepts(input({ brandName: 'Acme' })).find((x) => x.id === 'wordmark')!;
    expect(c.placements.find((p) => p.kind === 'text')!.text).toBe('ACME');
  });

  it('the repeating strategies actually repeat', () => {
    const out = generateConcepts(input());
    for (const id of ['repeat', 'diagonal']) {
      const c = out.find((x) => x.id === id)!;
      expect(c.placements.length).toBeGreaterThan(6);
    }
  });

  it('the diagonal strategy rotates its marks', () => {
    const c = generateConcepts(input()).find((x) => x.id === 'diagonal')!;
    expect(c.placements.every((p) => p.rotation !== 0)).toBe(true);
  });

  it('the two-tone block splits the cup rather than adding a stripe', () => {
    const c = generateConcepts(input()).find((x) => x.id === 'colour-block')!;
    const band = c.placements.find((p) => p.kind === 'band')!;
    // The block must reach the base, otherwise it reads as a floating stripe.
    expect(band.v - band.heightV! / 2).toBeCloseTo(0, 5);
    expect(band.heightV!).toBeGreaterThan(0.3);
  });

  it('the ruled band uses thin rules, not a heavy block', () => {
    const c = generateConcepts(input()).find((x) => x.id === 'band')!;
    const rules = c.placements.filter((p) => p.kind === 'band');
    expect(rules).toHaveLength(2);
    for (const r of rules) expect(r.heightV!).toBeLessThan(0.03);
    // One above the mark and one below it.
    const mark = c.placements.find((p) => p.kind === 'artwork')!;
    expect(rules.some((r) => r.v > mark.v)).toBe(true);
    expect(rules.some((r) => r.v < mark.v)).toBe(true);
  });

  it('the minimal concept is a plain white cup with a centred mark', () => {
    const c = generateConcepts(input()).find((x) => x.id === 'minimal')!;
    expect(c.background).toBe('#ffffff');
    expect(c.placements).toHaveLength(1);
    expect(c.placements[0]!.u).toBeCloseTo(0.5, 3);
  });

  it('mark-on-black is black, and asks for the logo to be adapted', () => {
    const c = generateConcepts(input()).find((x) => x.id === 'on-black')!;
    expect(c.background).toBe('#000000');
    const p = c.placements[0]!;
    // Both adaptations matter: a white plate would show as a box, and a dark
    // logo would vanish entirely.
    expect(p.treatment?.dropPlate).toBe(true);
    expect(p.treatment?.tone).toBe('lighten');
  });

  it('the QR concept puts mark and code on the same line, one per half', () => {
    const c = generateConcepts(input()).find((x) => x.id === 'qr')!;
    const mark = c.placements.find((p) => p.kind === 'artwork')!;
    const qr = c.placements.find((p) => p.kind === 'qr')!;
    expect(mark.u).toBeCloseTo(0.25, 3);
    expect(qr.u).toBeCloseTo(0.75, 3);
    expect(qr.v).toBeCloseTo(mark.v, 2);
    expect(qr.placeholderUrl).toBeTruthy();
  });

  it('concepts placing a mark on a strong ground strip the plate', () => {
    const out = generateConcepts(input());
    for (const id of ['on-black', 'colour-block', 'minimal', 'band']) {
      const c = out.find((x) => x.id === id)!;
      const art = c.placements.find((p) => p.kind === 'artwork')!;
      expect(art.treatment?.dropPlate).toBe(true);
    }
  });

  it('every registered strategy has a unique id', () => {
    const ids = STRATEGIES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
