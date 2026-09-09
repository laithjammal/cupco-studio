import { describe, it, expect } from 'vitest';
import { deriveFrustum, CUP_8OZ } from '@cupco/geometry';
import {
  generateConcepts, STRATEGIES, safeBounds, contrastRatio, luminance,
  chooseBackground, chooseForeground, isDark, shade, SEASONAL_CAMPAIGNS,
  type ConceptInput,
} from '../src/index';
import { hexToRgb, motifAspect, type RGB, type MotifId } from '@cupco/vector';
import { boundaryURange } from '@cupco/geometry';

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
    // Tied to the strategy lists rather than a round number: a literal here
    // that happened to equal the list length is exactly what let the seasonal
    // campaigns be generated and then dropped without a test noticing.
    expect(out.length).toBe(STRATEGIES.length + SEASONAL_CAMPAIGNS.length);
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

  /**
   * LAYOUT concepts only. A layout picks its ground FROM the artwork, so it
   * has to contrast with it.
   *
   * A seasonal campaign works the other way round: the ground is the season -
   * Halloween is orange and near-black whatever the café's logo is - and the
   * MARK is re-toned to read against it. That is asserted separately, on the
   * treatment, which is where the guarantee actually lives.
   */
  it('every LAYOUT background contrasts with the artwork', () => {
    const subject: RGB = [232, 85, 45];
    const layouts = generateConcepts(input()).filter((c) => !c.id.startsWith('season-'));
    expect(layouts).toHaveLength(STRATEGIES.length);
    for (const c of layouts) {
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
    const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
    expect(s.vBottom).toBeCloseTo(clamp(CUP_8OZ.margins.safeBottomMm / geom.slantMm), 9);
    expect(s.vTop).toBeCloseTo(clamp(1 - CUP_8OZ.margins.safeTopMm / geom.slantMm), 9);
  });

  /**
   * The 8oz safe margins are negative - the printable area runs past the cup's
   * trim line. That is fine for a drawn guide, but design space v=0..1 IS the
   * trim, so an element laid out above 1 or below 0 is off the canvas and
   * never renders. The band concepts lay into has to stop at the canvas.
   */
  it('never lays out beyond the design canvas, even on negative safe margins', () => {
    expect(CUP_8OZ.margins.safeTopMm).toBeLessThan(0);
    expect(CUP_8OZ.margins.safeBottomMm).toBeLessThan(0);
    expect(s.vBottom).toBe(0);
    expect(s.vTop).toBe(1);
  });

  it('no placement centre falls outside the cup', () => {
    for (const c of generateConcepts(input())) {
      for (const p of c.placements) {
        // A ground is the exception, and deliberately so: a snow line or a
        // meadow has to run off the base of the cup rather than stop at it,
        // so its centre sits below v=0 by design.
        const isGround = p.kind === 'band' || p.bleeds;
        if (!isGround) {
          expect(p.v).toBeGreaterThanOrEqual(0);
          expect(p.v).toBeLessThanOrEqual(1);
        }
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

/**
 * The seasonal campaigns.
 *
 * These are scenes rather than layouts, so what is worth asserting is
 * different: that the café's mark survives the scene, that nothing lands
 * outside the printable area, and that every motif a layout names can actually
 * be built. A scene that buries a logo in snowflakes is worse than no scene.
 */
describe('seasonal concepts', () => {
  const geom = deriveFrustum(CUP_8OZ.dimensions);
  const inputFor = (aspect: number) => ({
    artworkAspect: aspect,
    palette: [[30, 60, 120]] as RGB[],
    profile: CUP_8OZ,
    geom,
    brandName: 'BICYCLE',
    seed: 7,
  });
  // NOTE the default limit. Asking for 40 here is what hid the fact that the
  // default was 10 - exactly the number of layout strategies - so every
  // seasonal concept was generated and then dropped before it reached the app.
  const seasons = (aspect = 1) =>
    generateConcepts(inputFor(aspect)).filter((c) => c.id.startsWith('season-'));

  it('reaches the app by DEFAULT, without a caller asking for more', () => {
    // The regression: a default limit equal to the layout-strategy count made
    // the seasonal concepts invisible while every test still passed.
    const all = generateConcepts(inputFor(1));
    expect(all.filter((c) => c.id.startsWith('season-'))).toHaveLength(SEASONAL_CAMPAIGNS.length);
    expect(all.length).toBe(STRATEGIES.length + SEASONAL_CAMPAIGNS.length);
  });

  it('offers one concept per campaign in the calendar', () => {
    expect(seasons()).toHaveLength(SEASONAL_CAMPAIGNS.length);
    expect(SEASONAL_CAMPAIGNS.map((c) => c.month)).toEqual([
      'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'APRIL', 'MAY', 'JUNE',
      'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
    ]);
  });

  it.each([0.2, 0.5, 1, 1.8, 3])('generates for artwork of aspect %s', (aspect) => {
    expect(seasons(aspect)).toHaveLength(SEASONAL_CAMPAIGNS.length);
  });

  /**
   * The one that matters most. Placements paint in order, so the mark being
   * last is what stops a motif landing on top of the café's logo.
   */
  it('always paints the café mark LAST', () => {
    for (const c of seasons()) {
      const last = c.placements[c.placements.length - 1]!;
      expect(last.kind).toBe('artwork');
      expect(c.placements.filter((p) => p.kind === 'artwork')).toHaveLength(1);
    }
  });

  it('drops the logo plate and tones the mark for the season ground', () => {
    for (const c of seasons()) {
      const art = c.placements.find((p) => p.kind === 'artwork')!;
      // A flat seasonal ground shows any white box a logo carries.
      expect(art.treatment?.dropPlate).toBe(true);
      expect(art.treatment?.tone).toMatch(/lighten|darken/);
    }
  });

  it('names only motifs that can actually be built', () => {
    for (const c of seasons()) {
      for (const p of c.placements.filter((x) => x.kind === 'motif')) {
        expect(p.motif).toBeTruthy();
        expect(() => motifAspect(p.motif as MotifId)).not.toThrow();
        expect(p.motifColors).toBeTruthy();
        for (const role of ['primary', 'ink', 'accent', 'secondary'] as const) {
          expect(p.motifColors![role]).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
    }
  });

  /**
   * Every element has to survive the print. Checked against the profile's own
   * safe bounds rather than against 0..1, because the safe area is where
   * artwork is actually guaranteed.
   */
  it('keeps every motif inside the safe area, at any artwork aspect', () => {
    const s = safeBounds(CUP_8OZ, geom);
    const { widthPx, heightPx } = CUP_8OZ.designCanvas;
    for (const aspect of [0.3, 1, 2.5]) {
      for (const c of seasons(aspect)) {
        // Anything the layout MARKED as bleeding is exempt - a sea, a snow
        // line, a sun cropped by the rim. The exemption comes from the data
        // rather than from a list of ids kept here, so a new motif meant to
        // run off an edge does not need this test edited.
        for (const p of c.placements.filter((x) => x.kind === 'motif' && !x.bleeds)) {
          const halfV = (p.widthU! * motifAspect(p.motif as MotifId) * (widthPx / heightPx)) / 2;
          expect(p.v + halfV).toBeLessThanOrEqual(s.vTop + 1e-9);
          expect(p.v - halfV).toBeGreaterThanOrEqual(s.vBottom - 1e-9);
        }
      }
    }
  });

  it('lets the snow line bleed off the base, as a ground should', () => {
    const s = safeBounds(CUP_8OZ, geom);
    const { widthPx, heightPx } = CUP_8OZ.designCanvas;
    const june = seasons().find((c) => c.id === 'season-june')!;
    const drift = june.placements.find((p) => p.motif === 'drift')!;
    const halfV = (drift.widthU! * motifAspect('drift') * (widthPx / heightPx)) / 2;
    expect(drift.v - halfV).toBeLessThan(s.vBottom);
    // And it wraps past both seams, so the join is never visible.
    expect(drift.widthU!).toBeGreaterThan(1);
  });

  it('sits grounded motifs above the ground band, not through it', () => {
    // June's snowman stands on the drift; if grounding regressed it would be
    // centred on v=0 and half of it would be off the cup.
    const june = seasons().find((c) => c.id === 'season-june')!;
    const band = june.placements.find((p) => p.kind === 'band')!;
    const snowman = june.placements.find((p) => p.motif === 'snowman')!;
    expect(snowman.v).toBeGreaterThan(band.v + (band.heightV ?? 0) / 2);
  });

  it('is deterministic — the same upload gives the same scenes', () => {
    const a = seasons();
    const b = seasons();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('carries a real headline and a description for every generated campaign', () => {
    for (const c of seasons()) {
      // January is a supplied illustration - its lettering is drawn INTO the
      // artwork, so it has no text placements and should not be asked for any.
      const generated = c.placements.some((p) => p.kind === 'template') === false;
      if (generated) {
        const text = c.placements.filter((p) => p.kind === 'text');
        expect(text.length).toBeGreaterThanOrEqual(1);
        expect(text[0]!.text!.length).toBeGreaterThan(3);
      }
      expect(c.description.length).toBeGreaterThan(20);
      expect(c.background).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

/**
 * JANUARY — the supplied illustration, recoloured.
 *
 * Not a generated scene: a finished piece of artwork with an accent colour
 * meant to be replaced and a disc reserved for the mark. So what is worth
 * asserting is the contract with that file - the accent follows the logo, the
 * mark lands in the disc and fits it, and the artwork covers the whole cup.
 */
describe('January template', () => {
  const geom = deriveFrustum(CUP_8OZ.dimensions);
  const jan = (palette: RGB[], artworkAspect = 1) =>
    generateConcepts({ artworkAspect, palette, profile: CUP_8OZ, geom, seed: 7 })
      .find((c) => c.id === 'season-january')!;

  const GREEN: RGB[] = [[26, 77, 61]];
  const ORANGE: RGB[] = [[232, 85, 45]];

  const tpl = (c: ReturnType<typeof jan>) => c.placements.find((p) => p.kind === 'template')!;
  const mark = (c: ReturnType<typeof jan>) => c.placements[c.placements.length - 1]!;

  it('names the illustration and an accent taken from the logo', () => {
    const a = jan(GREEN), b = jan(ORANGE);
    expect(tpl(a).template).toBe('january-2027');
    expect(tpl(a).color).toMatch(/^#[0-9a-f]{6}$/i);
    // The accent is the BRAND colour, so two brands give two accents.
    expect(tpl(a).color).not.toBe(tpl(b).color);
  });

  it('uses the logo colour itself, not a tone derived from it', () => {
    // The pink in the artwork is being replaced, so the point is the café's
    // actual colour rather than something that merely suits a scene.
    expect(tpl(jan(ORANGE)).color!.toLowerCase()).toBe('#e8552d');
  });

  it('leaves a greyscale logo neutral rather than inventing a hue', () => {
    const c = tpl(jan([[15, 15, 15], [240, 240, 240]])).color!;
    const n = parseInt(c.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(10);
  });

  /**
   * Fitted by WIDTH, so the whole illustration is on the blank.
   *
   * The artwork is proportionally taller than the wrap, so one axis has to
   * overhang. Fitting by height made it 25% wider than the blank and threw
   * the right-hand lettering off the edge - so the width is what is matched,
   * exactly, and the overhang goes to the top and bottom instead.
   */
  it('spans the blank exactly, edge to edge', () => {
    const t = tpl(jan(GREEN));
    const u = boundaryURange(CUP_8OZ, geom, 'bleed');
    const uLeft = Math.min(u.atTop.uLeft, u.atBottom.uLeft);
    const uRight = Math.max(u.atTop.uRight, u.atBottom.uRight);
    expect(t.u - t.widthU! / 2).toBeCloseTo(uLeft, 6);
    expect(t.u + t.widthU! / 2).toBeCloseTo(uRight, 6);
    expect(t.bleeds).toBe(true);
  });

  it('still covers the cup top to bottom, with the overhang there instead', () => {
    const t = tpl(jan(GREEN));
    const { widthPx, heightPx } = CUP_8OZ.designCanvas;
    const heightV = t.widthU! * (836 / 1882) * (widthPx / heightPx);
    expect(t.v - heightV / 2).toBeLessThan(0);
    expect(t.v + heightV / 2).toBeGreaterThan(1);
  });

  it('centres the design on the CUP, not on the blank', () => {
    // What a person looking at the cup sees should be the middle of the art.
    expect(tpl(jan(GREEN)).v).toBeCloseTo(0.5, 6);
  });

  it('puts the mark in the reserved disc, painted LAST', () => {
    const c = jan(GREEN);
    expect(mark(c).kind).toBe('artwork');
    expect(c.placements.filter((p) => p.kind === 'artwork')).toHaveLength(1);
    // The disc sits just right of centre and above the middle in the artwork.
    expect(mark(c).u).toBeCloseTo(0.498, 2);
    expect(mark(c).v).toBeGreaterThan(0.6);
    // It is a dark disc, so the mark has to read light on it.
    expect(mark(c).treatment).toEqual({ dropPlate: true, tone: 'lighten' });
  });

  it('fits the mark inside the disc whatever shape it is', () => {
    const { widthPx, heightPx } = CUP_8OZ.designCanvas;
    const ratio = widthPx / heightPx;
    for (const aspect of [0.2, 0.5, 1, 2, 4]) {
      const c = jan(GREEN, aspect);
      const t = tpl(c);
      const discW = 0.199 * t.widthU!;
      const discH = discW * ratio;
      const w = mark(c).widthU!;
      const h = w * aspect * ratio;
      // Inside the disc's box on both axes, with room to spare for the ring.
      expect(w).toBeLessThanOrEqual(discW * 0.7);
      expect(h).toBeLessThanOrEqual(discH * 0.7 + 1e-9);
      expect(w).toBeGreaterThan(0);
    }
  });

  it('is deterministic', () => {
    expect(JSON.stringify(jan(GREEN))).toBe(JSON.stringify(jan(GREEN)));
  });
});
