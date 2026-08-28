import { describe, it, expect } from 'vitest';
import { fitCupInGrid, type PlateGrid } from '@/lib/plate-autofit';

/**
 * A cup drawn from known numbers.
 *
 * The point of testing against a constructed cup rather than only against a
 * photograph is that the answer is not measured, it is CHOSEN - so a fit that
 * quietly agrees with the detector's own quirks has nowhere to hide.
 *
 * Edges are drawn with 4x4 coverage sampling. A hard-edged cup would let the
 * subpixel refinement land on whole pixels for free, which is exactly the
 * accuracy the real thing has to earn.
 */
interface CupSpec {
  w: number;
  h: number;
  /** Axis x at `topY`, and its lean in x per y. */
  axisTop: number;
  axisSlope: number;
  halfTop: number;
  halfBase: number;
  /** y of the wall's top corners, and of the base. */
  topY: number;
  baseY: number;
  /** How far the lid's underside sags at the centre. */
  bow: number;
  lidTop: number;
  lidOverhang: number;
  /** Luminance either side of the cup. */
  bgLeft: number;
  bgRight: number;
  /** Vertical stripes on the left background - panelling, which fools edge finders. */
  stripes?: boolean;
}

function drawCup(s: CupSpec): PlateGrid {
  const axis = (y: number) => s.axisTop + s.axisSlope * (y - s.topY);
  const half = (y: number) =>
    s.halfTop + ((s.halfBase - s.halfTop) * (y - s.topY)) / (s.baseY - s.topY);
  // The lid's underside: a parabolic arc sagging `bow` at the centre.
  const underside = (x: number) => {
    const t = (x - (axis(s.topY) - s.halfTop)) / (2 * s.halfTop);
    const u = Math.min(1, Math.max(0, t));
    return s.topY + s.bow * 4 * u * (1 - u);
  };

  const sample = (x: number, y: number): number => {
    const shadow = s.baseY + 6;
    if (y > shadow + 10) return 0.62;                       // floor beyond the shadow
    if (y > s.baseY) return 0.35;                           // contact shadow
    const a = axis(y), hw = half(y);
    if (x >= a - hw && x <= a + hw) {
      if (y >= underside(x)) return 0.85;                   // cup wall
      if (y >= s.lidTop) return 0.08;                       // lid, over the cup
    }
    // The lid overhangs the wall on both sides.
    const lidHalf = s.halfTop + s.lidOverhang;
    if (y >= s.lidTop && y <= s.topY + s.bow
        && x >= axis(s.topY) - lidHalf && x <= axis(s.topY) + lidHalf) return 0.08;
    if (x < a) {
      if (!s.stripes) return s.bgLeft;
      return Math.floor(x / 9) % 2 === 0 ? s.bgLeft : s.bgLeft + 0.16;
    }
    return s.bgRight;
  };

  const lum = new Float32Array(s.w * s.h);
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      let acc = 0;
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) acc += sample(x + (i + 0.5) / 4 - 0.5, y + (j + 0.5) / 4 - 0.5);
      }
      lum[y * s.w + x] = acc / 16;
    }
  }
  return { w: s.w, h: s.h, lum, scale: 1 };
}

const BASE: CupSpec = {
  w: 420, h: 400,
  axisTop: 210, axisSlope: 0,
  halfTop: 80, halfBase: 58,
  topY: 100, baseY: 340,
  bow: 10, lidTop: 62, lidOverhang: 6,
  bgLeft: 0.45, bgRight: 0.30,
};

/** Where the cup's corners truly are, from the spec alone. */
function truth(s: CupSpec) {
  const axis = (y: number) => s.axisTop + s.axisSlope * (y - s.topY);
  const half = (y: number) =>
    s.halfTop + ((s.halfBase - s.halfTop) * (y - s.topY)) / (s.baseY - s.topY);
  return {
    topLeft: { x: axis(s.topY) - s.halfTop, y: s.topY },
    topRight: { x: axis(s.topY) + s.halfTop, y: s.topY },
    bottomLeft: { x: axis(s.baseY) - half(s.baseY), y: s.baseY },
    bottomRight: { x: axis(s.baseY) + half(s.baseY), y: s.baseY },
  };
}

function fitOrThrow(spec: CupSpec) {
  const result = fitCupInGrid(drawCup(spec));
  if (!result) throw new Error('no fit');
  return result;
}

describe('finding a cup in a plate', () => {
  it('lands every corner within two pixels of a cup it was never told about', () => {
    const cal = fitOrThrow(BASE).calibration;
    const want = truth(BASE);
    for (const [got, expected] of [
      [cal.topLeft, want.topLeft], [cal.topRight, want.topRight],
      [cal.bottomLeft, want.bottomLeft], [cal.bottomRight, want.bottomRight],
    ] as const) {
      expect(Math.abs(got.x - expected.x)).toBeLessThan(2);
      expect(Math.abs(got.y - expected.y)).toBeLessThan(2);
    }
  });

  /**
   * The bug this was written for. The top edge used to be measured down the
   * cup's CENTRE column and then handed to the corners, so the whole edge sat
   * a lid's sag too low - and `topBow` then pushed the middle lower again.
   */
  it("does not count the lid's sag twice", () => {
    const cal = fitOrThrow(BASE).calibration;
    expect(Math.abs(cal.topBow - BASE.bow)).toBeLessThan(2);
    // What the two together actually put on screen: the top edge at the centre.
    const centre = (cal.topLeft.y + cal.topRight.y) / 2 + cal.topBow;
    expect(Math.abs(centre - (BASE.topY + BASE.bow))).toBeLessThan(2);
  });

  /**
   * Panelling behind the shaded side of a cup produces long runs of confident,
   * consistent, wrong edges - which is what breaks a fit that rejects outliers
   * by their distance from a median.
   */
  it('is not taken in by panelling behind the shaded side', () => {
    const spec = { ...BASE, stripes: true, bgLeft: 0.52 };
    const cal = fitOrThrow(spec).calibration;
    const want = truth(spec);
    expect(Math.abs(cal.topLeft.x - want.topLeft.x)).toBeLessThan(3);
    expect(Math.abs(cal.bottomLeft.x - want.bottomLeft.x)).toBeLessThan(3);
  });

  it('follows a cup that leans', () => {
    const spec = { ...BASE, axisSlope: -0.02 };
    const cal = fitOrThrow(spec).calibration;
    const want = truth(spec);
    for (const [got, expected] of [
      [cal.topLeft, want.topLeft], [cal.bottomRight, want.bottomRight],
    ] as const) {
      expect(Math.abs(got.x - expected.x)).toBeLessThan(2.5);
    }
    // Held vertical, the fit would split the difference and miss both ends.
    const fittedLean = ((cal.bottomLeft.x + cal.bottomRight.x)
      - (cal.topLeft.x + cal.topRight.x)) / 2 / (BASE.baseY - BASE.topY);
    expect(fittedLean).toBeLessThan(-0.005);
  });

  it('reports the taper rather than averaging it away', () => {
    const cal = fitOrThrow(BASE).calibration;
    const topWidth = cal.topRight.x - cal.topLeft.x;
    const baseWidth = cal.bottomRight.x - cal.bottomLeft.x;
    expect(topWidth / baseWidth).toBeCloseTo((2 * BASE.halfTop) / (2 * BASE.halfBase), 1);
  });

  it('scales its answer back to the source image', () => {
    const g = drawCup(BASE);
    const scaled = fitCupInGrid({ ...g, scale: 3 });
    const plain = fitCupInGrid(g);
    expect(plain).not.toBeNull();
    expect(scaled).not.toBeNull();
    expect(scaled!.calibration.topLeft.x).toBeCloseTo(plain!.calibration.topLeft.x * 3, 6);
    expect(scaled!.calibration.topBow).toBeCloseTo(plain!.calibration.topBow * 3, 6);
  });

  it('gives up rather than guessing when there is no cup', () => {
    const flat: PlateGrid = { w: 200, h: 200, lum: new Float32Array(200 * 200).fill(0.7), scale: 1 };
    expect(fitCupInGrid(flat)).toBeNull();
  });

  it('is deterministic, so a reopened mockup looks the way it did', () => {
    const g = drawCup(BASE);
    expect(JSON.stringify(fitCupInGrid(g))).toBe(JSON.stringify(fitCupInGrid(g)));
  });
});
