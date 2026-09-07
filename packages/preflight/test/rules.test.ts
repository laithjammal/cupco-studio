import { describe, it, expect } from 'vitest';
import { CUP_8OZ, CUP_12OZ, circumferenceAtV, deriveFrustum, withMargins } from '@cupco/geometry';
import { rgbToCmyk } from '@cupco/vector';
import type { CMYK } from '@cupco/vector';
import { runPreflight, summarise, MIN_QR_MODULE_MM, MIN_TEXT_MM } from '../src/index';
import type { PreflightDesign, PreflightElement } from '../src/index';

const GEOM = deriveFrustum(CUP_8OZ.dimensions);
const WHITE: CMYK = { c: 0, m: 0, y: 0, k: 0 };

/**
 * Circumferences come from the geometry engine rather than being pasted in as
 * rounded constants.
 *
 * That is not the test mirroring the code: the engine is what defines how wide
 * a millimetre is on this cup, and it has its own 88 tests including the
 * arc-length identity. What is under test here is whether preflight APPLIES
 * that geometry correctly. Rounded literals also fail outright - 25.4mm
 * computed from a 4dp circumference lands a hair under 300dpi.
 */
const circAt = (v: number) => circumferenceAtV(v, GEOM);

/**
 * Build an element from a centre and unrotated extents.
 *
 * The corners are the plain box corners, which is what the editor produces for
 * an unrotated element. Rotation cases pass `corners` explicitly rather than
 * re-deriving the editor's rotation maths here - a test that reimplements the
 * code under test proves only that it was copied correctly.
 */
function el(over: Partial<PreflightElement> & { kind: PreflightElement['kind'] }): PreflightElement {
  const u = over.u ?? 0.5, v = over.v ?? 0.5;
  const widthU = over.widthU ?? 0.2, heightV = over.heightV ?? 0.2;
  const corners = over.corners ?? [
    { u: u - widthU / 2, v: v - heightV / 2 },
    { u: u + widthU / 2, v: v - heightV / 2 },
    { u: u + widthU / 2, v: v + heightV / 2 },
    { u: u - widthU / 2, v: v + heightV / 2 },
  ];
  return {
    id: 'el-1', name: 'Logo', rotation: 0, opacity: 1, inks: [WHITE],
    ...over, u, v, widthU, heightV, corners,
  };
}

const design = (elements: PreflightElement[], background: CMYK = WHITE): PreflightDesign =>
  ({ background, elements });

const run = (elements: PreflightElement[], profile = CUP_8OZ, background = WHITE) =>
  runPreflight(design(elements, background), profile, { geom: profile === CUP_8OZ ? GEOM : undefined });

const rules = (elements: PreflightElement[], rule: string, profile = CUP_8OZ) =>
  run(elements, profile).issues.filter((i) => i.rule === rule);

/* -------------------------------------------------------------------------- */

describe('a clean design', () => {
  const clean = el({ kind: 'vector', u: 0.5, v: 0.5, widthU: 0.2, heightV: 0.2 });

  it('passes with no issues at all', () => {
    const report = run([clean]);
    expect(report.issues).toEqual([]);
    expect(report.passed).toBe(true);
    expect(summarise(report)).toBe('Ready to print');
  });
});

describe('profile provenance', () => {
  it('BLOCKS a profile with placeholder dimensions', () => {
    const report = run([el({ kind: 'vector' })], CUP_12OZ);
    expect(report.passed).toBe(false);
    expect(report.issues.some((i) => i.rule === 'profile-provenance' && i.severity === 'error')).toBe(true);
  });

  it('only WARNS about unconfirmed margins, which must not block a proof', () => {
    const assumed = withMargins(CUP_8OZ, { provenance: 'PLACEHOLDER' });
    const report = runPreflight(design([el({ kind: 'vector' })]), assumed);
    const issue = report.issues.find((i) => i.rule === 'profile-provenance');
    expect(issue?.severity).toBe('warning');
    expect(report.passed).toBe(true);
  });
});

describe('empty design', () => {
  it('warns but does NOT block — a plain coloured cup is a real product', () => {
    const report = run([]);
    expect(report.passed).toBe(true);
    const issue = report.issues.find((i) => i.rule === 'empty-design');
    expect(issue?.severity).toBe('warning');
  });
});

describe('safe area', () => {
  it('says nothing about artwork inside the printable band', () => {
    expect(rules([el({ kind: 'vector', v: 0.5, heightV: 0.3 })], 'safe-area')).toEqual([]);
  });

  /**
   * Since 2026-09-07 the 8oz safe margins are NEGATIVE: the safe line sits
   * outside the trim, and therefore outside design space, which is the trim
   * band. So nothing that fits on the canvas can overflow it vertically.
   *
   * That is a real narrowing of what this rule catches, and it is deliberate -
   * so it is asserted rather than left to be discovered.
   */
  it('does not flag an element touching the very top edge - safe is above it', () => {
    expect(CUP_8OZ.margins.safeTopMm).toBeLessThan(0);
    expect(rules([el({ kind: 'vector', v: 0.9, heightV: 0.2 })], 'safe-area')).toEqual([]);
  });

  it('does not flag an element touching the very bottom edge', () => {
    expect(CUP_8OZ.margins.safeBottomMm).toBeLessThan(0);
    expect(rules([el({ kind: 'vector', v: 0.1, heightV: 0.2 })], 'safe-area')).toEqual([]);
  });

  /**
   * The rule still bites on an element dragged clean off the top of the
   * canvas. Measured against where the safe line actually is, derived here
   * rather than taken from the rule's own maths.
   */
  it('measures the overflow of an element past the safe line', () => {
    const slant = deriveFrustum(CUP_8OZ.dimensions).slantMm;
    const vSafeTop = 1 - CUP_8OZ.margins.safeTopMm / slant;
    const heightV = 0.2;
    const over = 3 / slant;                       // exactly 3mm past the line
    const centre = vSafeTop + over - heightV / 2;

    const issues = rules([el({ kind: 'vector', v: centre, heightV })], 'safe-area');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.measurement).toContain('3.0mm');
  });

  it('never blocks - a bleed off the rim is a legitimate choice', () => {
    expect(run([el({ kind: 'vector', v: 0.95, heightV: 0.2 })]).passed).toBe(true);
  });

  it('EXEMPTS bands, which are meant to run off the edges', () => {
    const band = el({ kind: 'band', name: 'Base block', u: 0.5, v: 0.1, widthU: 1, heightV: 0.4 });
    expect(rules([band], 'safe-area')).toEqual([]);
  });

  it('flags artwork inside the glue seam margin', () => {
    // At mid-height the circumference is 202.04mm, so u = 0.01 is 2.02mm from
    // the seam - inside the 4mm clearance Cupco asked for.
    const issues = rules([el({ kind: 'vector', u: 0.011, v: 0.5, widthU: 0.002 })], 'safe-area');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('glue seam');
    expect(issues[0]!.measurement).toMatch(/2\.0mm from the seam/);
  });

  it('does not flag artwork comfortably clear of the seam', () => {
    // u = 0.1 at mid-height is 20mm from the seam, well past the 4mm limit.
    expect(rules([el({ kind: 'vector', u: 0.1, v: 0.5, widthU: 0.02 })], 'safe-area')).toEqual([]);
  });

  it('judges the seam gap at the element\'s LOWEST corner', () => {
    // The same angular gap is physically narrower further down the taper, so a
    // tall element can clear the seam at the rim and not at the base. Checking
    // the centre, or the top, would miss it.
    //
    // Both elements are kept between v 0.1 and 0.9 so the only thing that can
    // fire is the seam check.
    const tall = (u: number) => el({
      kind: 'vector', u: 0.5, v: 0.5,
      corners: [
        { u, v: 0.1 }, { u: 0.3, v: 0.1 },
        { u: 0.3, v: 0.9 }, { u, v: 0.9 },
      ],
    });

    // Wide enough to clear 4mm even at its lowest corner.
    const clearsU = 4.2 / circAt(0.1);
    expect(rules([tall(clearsU)], 'safe-area')).toEqual([]);

    // Chosen to clear 4mm at the TOP corner but not at the bottom one. If the
    // rule looked at the top, or the centre, this would wrongly pass.
    const trickyU = 3.6 / circAt(0.1);
    expect(trickyU * circAt(0.9)).toBeGreaterThan(4);   // fine at the rim
    expect(trickyU * circAt(0.1)).toBeLessThan(4);      // too close at the base

    const issues = rules([tall(trickyU)], 'safe-area');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.measurement).toContain('3.6mm from the seam');
  });
});

describe('seam crossing', () => {
  it('warns when a logo straddles u = 0', () => {
    const issues = rules([el({ kind: 'vector', u: 0.02, widthU: 0.2 })], 'seam-crossing');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('warning');
  });

  it('warns when a logo straddles u = 1, which is the same seam', () => {
    expect(rules([el({ kind: 'vector', u: 0.98, widthU: 0.2 })], 'seam-crossing')).toHaveLength(1);
  });

  it('BLOCKS a QR split by the seam, which cannot be read at all', () => {
    const qr = el({
      kind: 'qr', name: 'QR code', u: 0.02, widthU: 0.15,
      qr: { url: 'https://cupco.example', live: true, moduleCount: 25 },
    });
    const report = run([qr]);
    const issue = report.issues.find((i) => i.rule === 'seam-crossing');
    expect(issue?.severity).toBe('error');
    expect(report.passed).toBe(false);
  });

  it('EXEMPTS bands, which wrap continuously and have no edge to split', () => {
    const band = el({ kind: 'band', u: 0.5, widthU: 1, heightV: 0.2 });
    expect(rules([band], 'seam-crossing')).toEqual([]);
  });
});

describe('raster resolution', () => {
  const image = (naturalWidth: number, widthU: number) => el({
    kind: 'image', name: 'photo.png', v: 0.5, widthU,
    image: { naturalWidth, naturalHeight: naturalWidth },
  });

  // The design-space width that is exactly one inch at mid-height, so a 300px
  // image placed there is exactly 300dpi.
  const ONE_INCH_U = 25.4 / circAt(0.5);

  it('accepts an image at 300dpi', () => {
    expect(rules([image(300, ONE_INCH_U)], 'raster-resolution')).toEqual([]);
  });

  it('flags an image below 300dpi as soft', () => {
    const issues = rules([image(200, ONE_INCH_U)], 'raster-resolution');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.measurement).toContain('200dpi');
    expect(issues[0]!.message).toContain('softer');
  });

  it('describes a badly low-resolution image differently', () => {
    const issues = rules([image(100, ONE_INCH_U)], 'raster-resolution');
    expect(issues[0]!.message).toContain('blocky');
    expect(issues[0]!.remedy).toContain('SVG');
  });

  it('never blocks, because a soft texture can be a deliberate choice', () => {
    expect(run([image(40, ONE_INCH_U)]).passed).toBe(true);
  });

  it('judges PRINTED size, not pixel count', () => {
    // The same 1200px image: fine small, too soft when blown across the cup.
    expect(rules([image(1200, ONE_INCH_U * 4)], 'raster-resolution')).toEqual([]);
    expect(rules([image(1200, ONE_INCH_U * 8)], 'raster-resolution')).toHaveLength(1);
  });

  it('ignores vector artwork, which has no resolution', () => {
    expect(rules([el({ kind: 'vector', widthU: 0.9 })], 'raster-resolution')).toEqual([]);
  });
});

describe('ink limit', () => {
  // CMYK channels are 0-1 in @cupco/vector, so these are 345% and 240%.
  const heavy: CMYK = { c: 0.90, m: 0.85, y: 0.80, k: 0.90 };
  const rich: CMYK = { c: 0.60, m: 0.40, y: 0.40, k: 1.00 };

  it('flags a fill over 300%', () => {
    const issues = rules([el({ kind: 'vector', inks: [heavy] })], 'ink-limit');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.measurement).toContain('345%');
  });

  it('accepts a rich black under the limit', () => {
    expect(rules([el({ kind: 'vector', inks: [rich] })], 'ink-limit')).toEqual([]);
  });

  it('checks the background too', () => {
    const issues = run([el({ kind: 'vector' })], CUP_8OZ, heavy).issues
      .filter((i) => i.rule === 'ink-limit');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('background');
  });

  it('reports an element ONCE, at its heaviest ink', () => {
    const issues = rules([el({ kind: 'vector', inks: [WHITE, rich, heavy] })], 'ink-limit');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.measurement).toContain('345%');
  });

  it('does not fire on colours converted from RGB, which are already capped', () => {
    // rgbToCmyk applies full GCR and holds total ink under the limit, so pure
    // black through that path must not trip this rule.
    const black = rgbToCmyk([0, 0, 0]);
    expect(rules([el({ kind: 'vector', inks: [black] })], 'ink-limit')).toEqual([]);
  });
});

describe('QR codes', () => {
  const qr = (over: { live?: boolean; widthU?: number; moduleCount?: number; v?: number } = {}) =>
    el({
      kind: 'qr', name: 'QR code', u: 0.5, v: over.v ?? 0.5, widthU: over.widthU ?? 0.13,
      qr: {
        url: over.live === false ? '' : 'https://cupco.example',
        live: over.live ?? true,
        moduleCount: over.moduleCount ?? 25,
      },
    });

  it('BLOCKS a code still holding its placeholder', () => {
    // The rule most worth having: nothing looks wrong, the proof scans, and
    // every cup in the run points at example.com.
    const report = run([qr({ live: false })]);
    expect(report.passed).toBe(false);
    const issue = report.issues.find((i) => i.rule === 'qr-placeholder');
    expect(issue?.severity).toBe('error');
    expect(issue?.remedy).toContain('web address');
  });

  it('says nothing about a code with a real address', () => {
    expect(rules([qr()], 'qr-placeholder')).toEqual([]);
  });

  it('measures module size across the quiet zone, not just the data', () => {
    // 25 data modules plus 4 quiet each side = 33 across. At the 0.5mm floor
    // that needs 16.5mm. Sized just under, it must fire; just over, it must not.
    const needU = (MIN_QR_MODULE_MM * 33) / circAt(0.5);
    expect(rules([qr({ widthU: needU * 0.95 })], 'qr-size')).toHaveLength(1);
    expect(rules([qr({ widthU: needU * 1.05 })], 'qr-size')).toEqual([]);
  });

  it('names the width the code actually needs', () => {
    const issues = rules([qr({ widthU: 0.02 })], 'qr-size');
    expect(issues[0]!.remedy).toContain('16.5mm');
  });

  it('a longer address needs a bigger code at the same module size', () => {
    // More modules, same physical width -> smaller modules. This is why the
    // remedy offers shortening the URL as well as enlarging the code.
    const width = 0.09;
    expect(rules([qr({ widthU: width, moduleCount: 25 })], 'qr-size')).toEqual([]);
    expect(rules([qr({ widthU: width, moduleCount: 45 })], 'qr-size')).toHaveLength(1);
  });
});

describe('tiny text', () => {
  const text = (sizeV: number, content = 'CUPCO') =>
    el({ kind: 'text', name: content, text: { content, sizeV } });

  it('accepts text at the floor', () => {
    expect(rules([text(MIN_TEXT_MM / GEOM.slantMm)], 'tiny-text')).toEqual([]);
  });

  it('flags text below it', () => {
    const issues = rules([text((MIN_TEXT_MM * 0.6) / GEOM.slantMm)], 'tiny-text');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.measurement).toContain('0.9mm');
  });

  it('ignores an empty string, which prints nothing either way', () => {
    expect(rules([text(0.001, '   ')], 'tiny-text')).toEqual([]);
  });
});

describe('bleed gap', () => {
  const band = (minV: number, maxV: number) => el({
    kind: 'band', name: 'Rim stripe', u: 0.5, widthU: 1,
    v: (minV + maxV) / 2, heightV: maxV - minV,
  });

  it('flags a band stopping a hair short of the rim', () => {
    // 0.5mm short: almost certainly meant to be flush.
    const issues = rules([band(0.7, 1 - 0.5 / GEOM.slantMm)], 'bleed-gap');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('rim');
    expect(issues[0]!.measurement).toContain('0.5mm');
  });

  it('flags the same at the base', () => {
    const issues = rules([band(0.5 / GEOM.slantMm, 0.3)], 'bleed-gap');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('base');
  });

  it('says nothing about a band that reaches the edge', () => {
    expect(rules([band(0, 0.3)], 'bleed-gap')).toEqual([]);
  });

  it('says nothing about a band that clearly stops on purpose', () => {
    // 18mm below the rim is a design decision, not a near miss.
    expect(rules([band(0.3, 0.8)], 'bleed-gap')).toEqual([]);
  });

  it('only applies to bands', () => {
    const logo = el({ kind: 'vector', v: 0.5, heightV: 2 * (0.5 - 0.5 / GEOM.slantMm) });
    expect(rules([logo], 'bleed-gap')).toEqual([]);
  });
});

describe('off canvas and invisible', () => {
  it('warns about an element dragged entirely off the top', () => {
    const issues = rules([el({ kind: 'vector', v: 1.5, heightV: 0.2 })], 'off-canvas');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('will not print');
  });

  it('says nothing about an element only partly off', () => {
    expect(rules([el({ kind: 'vector', v: 0.98, heightV: 0.2 })], 'off-canvas')).toEqual([]);
  });

  it('reports a fully transparent element as info, not a problem', () => {
    const report = run([el({ kind: 'vector', opacity: 0 })]);
    const issue = report.issues.find((i) => i.rule === 'invisible-element');
    expect(issue?.severity).toBe('info');
    expect(report.passed).toBe(true);
  });
});

describe('the report', () => {
  it('orders errors before warnings before info', () => {
    const report = run([
      el({ kind: 'vector', id: 'a', opacity: 0 }),
      el({ kind: 'vector', id: 'b', v: 0.95, heightV: 0.2 }),
      el({
        kind: 'qr', id: 'c', name: 'QR code', widthU: 0.13,
        qr: { url: '', live: false, moduleCount: 25 },
      }),
    ]);
    const severities = report.issues.map((i) => i.severity);
    expect(severities).toEqual([...severities].sort(
      (a, b) => ({ error: 0, warning: 1, info: 2 })[a] - ({ error: 0, warning: 1, info: 2 })[b]));
    expect(report.issues[0]!.severity).toBe('error');
  });

  it('counts each severity', () => {
    const report = run([], CUP_12OZ);
    expect(report.errors).toBe(1);
    expect(report.errors + report.warnings + report.infos).toBe(report.issues.length);
  });

  it('summarises for a status bar', () => {
    expect(summarise(run([], CUP_12OZ))).toContain('blocks export');
    expect(summarise(run([el({ kind: 'vector', v: 0.95, heightV: 0.2 })]))).toContain('safe to export');
    expect(summarise(run([el({ kind: 'vector' })]))).toBe('Ready to print');
  });

  it('survives a rule that throws, rather than reporting a clean design', () => {
    // A preflight that reports nothing looks exactly like one that found
    // nothing, which is the most dangerous way for this module to fail.
    const boom = () => { throw new Error('rule exploded'); };
    const report = runPreflight(design([el({ kind: 'vector' })]), CUP_8OZ, { rules: [boom] });
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]!.rule).toBe('preflight-internal');
    expect(report.issues[0]!.message).toContain('rule exploded');
  });

  it('every issue carries a remedy', () => {
    // "Artwork is outside the safe area" tells an operator nothing they cannot
    // already see. Which way, and how far, is the useful part.
    const report = run([
      el({ kind: 'vector', id: 'a', v: 0.95, heightV: 0.2 }),
      el({ kind: 'image', id: 'b', name: 'photo', widthU: 0.5,
           image: { naturalWidth: 50, naturalHeight: 50 } }),
      el({ kind: 'qr', id: 'c', name: 'QR', widthU: 0.02,
           qr: { url: '', live: false, moduleCount: 25 } }),
    ], CUP_12OZ);
    expect(report.issues.length).toBeGreaterThan(3);
    for (const issue of report.issues) {
      expect(issue.remedy, `${issue.rule} has no remedy`).toBeTruthy();
    }
  });
});
