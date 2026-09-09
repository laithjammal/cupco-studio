/**
 * The illustrated templates, and the numbers two packages both rely on.
 *
 * The concept engine has no dependency on the app - that is what lets it run
 * in a test runner and, later, on a server - so it carries its own copy of
 * each template's geometry. Duplication is the price; this is what stops it
 * becoming drift, by checking the two against each other in the one place that
 * can see both.
 */
import { describe, it, expect } from 'vitest';
import { generateConcepts } from '@cupco/concepts';
import { CUP_8OZ, deriveFrustum } from '@cupco/geometry';
import { TEMPLATES, templateAssetId, templateFromAssetId } from '../src/lib/template-art';

const geom = deriveFrustum(CUP_8OZ.dimensions);
const january = () =>
  generateConcepts({ artworkAspect: 1, palette: [[26, 77, 61]], profile: CUP_8OZ, geom, seed: 7 })
    .find((c) => c.id === 'season-january')!;

describe('the January template', () => {
  const spec = TEMPLATES['january-2027']!;

  it('is the artwork the concept asks for', () => {
    const t = january().placements.find((p) => p.kind === 'template')!;
    expect(t.template).toBe(spec.id);
    expect(TEMPLATES[t.template!]).toBeTruthy();
  });

  it('agrees with the concept engine about where the logo disc is', () => {
    // The concept places the mark by carrying the disc from image coordinates
    // onto the cup; if these ever diverge, the logo lands off the disc.
    const c = january();
    const t = c.placements.find((p) => p.kind === 'template')!;
    const mark = c.placements[c.placements.length - 1]!;
    // Measured from where the ARTWORK actually sits, not from the middle of
    // the cup: the template is centred on the blank's width, which is not
    // quite u=0.5, and the disc has to travel with it.
    const heightV = t.widthU! * spec.aspect
      * (CUP_8OZ.designCanvas.widthPx / CUP_8OZ.designCanvas.heightPx);
    const expectedU = t.u + (spec.logo.u - 0.5) * t.widthU!;
    const expectedV = t.v + (spec.logo.v - 0.5) * heightV;
    expect(mark.u).toBeCloseTo(expectedU, 6);
    expect(mark.v).toBeCloseTo(expectedV, 6);
  });

  it('agrees about the artwork proportions', () => {
    // The concept sizes the whole thing from this ratio.
    expect(spec.aspect).toBeCloseTo(836 / 1882, 9);
  });

  it('agrees about the paper colour, which fills the bleed', () => {
    expect(january().background.toLowerCase()).toBe(spec.paper.toLowerCase());
  });

  /**
   * The accent window has to take the pink and nothing else. Measured off the
   * file: greens sit at 150-170 degrees and the coffee beans at 20-30, so a
   * window that reached either would recolour the leaves.
   */
  it('selects only the pink, leaving the greens and the beans alone', () => {
    const [lo, hi] = spec.accentHue;
    expect(lo).toBeGreaterThan(300);
    expect(hi).toBeLessThanOrEqual(360);
    for (const green of [150, 160, 170]) {
      expect(green >= lo && green <= hi).toBe(false);
    }
    for (const bean of [20, 25, 30]) {
      expect(bean >= lo && bean <= hi).toBe(false);
    }
  });

  it('round-trips its asset id, which is what lets it be regenerated', () => {
    const id = templateAssetId('january-2027', '#E8552D');
    expect(id).toBe('template:january-2027:#e8552d');
    // A design saved with a template reloads by rebuilding from this id
    // rather than by storing a 1.6MB PNG per project.
    expect(templateFromAssetId(id)).not.toBeNull();
    expect(templateFromAssetId('asset:1234')).toBeNull();
  });
});
