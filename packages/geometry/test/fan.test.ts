import { describe, it, expect } from 'vitest';
import {
  deriveFrustum,
  buildFanOutline,
  buildOverlapStrip,
  fanBounds,
  outlineToSvgPath,
  designBorderInFan,
  CUP_8OZ,
} from '../src/index';

const g8 = deriveFrustum(CUP_8OZ.dimensions);

describe('fan outline construction', () => {
  it('the trim outline sits exactly on the derived rims', () => {
    const { points } = buildFanOutline(CUP_8OZ, g8, 'trim');
    const radii = points.map((p) => Math.hypot(p.x, p.y));
    expect(Math.min(...radii)).toBeCloseTo(g8.rBottomMm, 6);
    expect(Math.max(...radii)).toBeCloseTo(g8.rTopMm, 6);
  });

  it('bleed is outside trim, safe area is inside it', () => {
    const trim = fanBounds(buildFanOutline(CUP_8OZ, g8, 'trim').points);
    const bleed = fanBounds(buildFanOutline(CUP_8OZ, g8, 'bleed').points);
    const safe = fanBounds(buildFanOutline(CUP_8OZ, g8, 'safe').points);

    expect(bleed.widthMm).toBeGreaterThan(trim.widthMm);
    expect(bleed.heightMm).toBeGreaterThan(trim.heightMm);
    expect(safe.widthMm).toBeLessThan(trim.widthMm);
    expect(safe.heightMm).toBeLessThan(trim.heightMm);
  });

  it('bleed extends the rims by exactly the configured bleed', () => {
    const { points } = buildFanOutline(CUP_8OZ, g8, 'bleed');
    const radii = points.map((p) => Math.hypot(p.x, p.y));
    const b = CUP_8OZ.margins.bleedMm;
    expect(Math.min(...radii)).toBeCloseTo(g8.rBottomMm - b, 6);
    expect(Math.max(...radii)).toBeCloseTo(g8.rTopMm + b, 6);
  });

  it('safe insets are ABSOLUTE, not additive with the rim curl', () => {
    // Cupco prints "up to 3mm of the top edge" while the curl is ~7mm, so
    // print runs into the curl zone. Adding the two would wrongly inset by
    // 10mm and crop artwork the customer expects to see.
    const { points } = buildFanOutline(CUP_8OZ, g8, 'safe');
    const radii = points.map((p) => Math.hypot(p.x, p.y));

    expect(Math.max(...radii)).toBeCloseTo(g8.rTopMm - CUP_8OZ.margins.safeTopMm, 6);
    expect(Math.min(...radii)).toBeCloseTo(g8.rBottomMm + CUP_8OZ.margins.safeBottomMm, 6);

    // Guard the specific regression: the additive reading must NOT reappear.
    const additive = CUP_8OZ.margins.safeTopMm + CUP_8OZ.rimBase.rimCurlAllowanceMm;
    expect(Math.max(...radii)).not.toBeCloseTo(g8.rTopMm - additive, 3);
  });

  it('the safe area is still asymmetric top vs bottom', () => {
    expect(CUP_8OZ.margins.safeTopMm).not.toBe(CUP_8OZ.margins.safeBottomMm);
  });

  it('print extends into the rim curl zone, as Cupco specified', () => {
    const intrusion = CUP_8OZ.rimBase.rimCurlAllowanceMm - CUP_8OZ.margins.safeTopMm;
    expect(intrusion).toBeCloseTo(4.0, 6);
  });

  it('the outline is closed and non-degenerate', () => {
    const { points } = buildFanOutline(CUP_8OZ, g8, 'trim', 64);
    expect(points.length).toBe(130); // (64+1) inner + (64+1) outer
    const b = fanBounds(points);
    expect(b.widthMm).toBeGreaterThan(0);
    expect(b.heightMm).toBeGreaterThan(0);
  });

  it('tessellation is fine enough that refining barely moves the bounds', () => {
    const coarse = fanBounds(buildFanOutline(CUP_8OZ, g8, 'trim', 128).points);
    const fine = fanBounds(buildFanOutline(CUP_8OZ, g8, 'trim', 4096).points);
    // Sagitta error at the default segment count must be well under 0.01mm.
    expect(Math.abs(coarse.widthMm - fine.widthMm)).toBeLessThan(0.01);
    expect(Math.abs(coarse.heightMm - fine.heightMm)).toBeLessThan(0.01);
  });
});

describe('8oz fan physical size', () => {
  it('matches the derived geometry and fits a sane sheet', () => {
    const b = fanBounds(buildFanOutline(CUP_8OZ, g8, 'bleed').points);
    // Chord across the sector at the outer radius, plus bleed. Sanity-checks
    // that we are producing a cup-sized blank rather than something absurd.
    expect(b.widthMm).toBeGreaterThan(200);
    expect(b.widthMm).toBeLessThan(270);
    expect(b.heightMm).toBeGreaterThan(90);
    expect(b.heightMm).toBeLessThan(140);
  });
});

describe('seam overlap strip', () => {
  it('sits just outside the trim edge and spans the full slant', () => {
    const strip = buildOverlapStrip(CUP_8OZ, g8);
    const radii = strip.map((p) => Math.hypot(p.x, p.y));
    expect(Math.min(...radii)).toBeCloseTo(g8.rBottomMm, 6);
    expect(Math.max(...radii)).toBeCloseTo(g8.rTopMm, 6);
  });

  it('has constant LINEAR width, so its angular width varies with radius', () => {
    // A constant angular strip would be the wrong shape — narrower in mm at
    // the bottom rim, where the glue line is most likely to show.
    const strip = buildOverlapStrip(CUP_8OZ, g8, 8);
    const half = strip.length / 2;
    const inner = strip[0]!;
    const innerOuterEdge = strip[strip.length - 1]!;
    const rhoInner = Math.hypot(inner.x, inner.y);
    const dPsiInner =
      Math.atan2(innerOuterEdge.x, -innerOuterEdge.y) - Math.atan2(inner.x, -inner.y);
    expect(dPsiInner * rhoInner).toBeCloseTo(CUP_8OZ.seam.overlapMm, 6);
    expect(half).toBeGreaterThan(0);
  });
});

describe('design border maps into the fan sector', () => {
  it('the design rectangle border becomes the fan trim outline', () => {
    const border = fanBounds(designBorderInFan(g8, 128));
    const trim = fanBounds(buildFanOutline(CUP_8OZ, g8, 'trim', 128).points);
    expect(border.widthMm).toBeCloseTo(trim.widthMm, 3);
    expect(border.heightMm).toBeCloseTo(trim.heightMm, 3);
  });
});

describe('SVG emission', () => {
  it('produces a closed path with finite coordinates', () => {
    const d = outlineToSvgPath(buildFanOutline(CUP_8OZ, g8, 'trim', 16));
    expect(d.startsWith('M ')).toBe(true);
    expect(d.endsWith(' Z')).toBe(true);
    expect(d).not.toMatch(/NaN|Infinity/);
  });
});
