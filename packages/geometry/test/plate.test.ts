import { describe, it, expect } from 'vitest';
import {
  plateU, plateFacing, platePoint, plateBounds, defaultCalibration,
  DEFAULT_VISIBLE_SPAN,
} from '../src/index';
import type { PlateCalibration } from '../src/index';

/** A square-on calibration, 400px wide, 300 tall, with sagging edges. */
const CAL: PlateCalibration = {
  topLeft: { x: 100, y: 100 },
  topRight: { x: 500, y: 100 },
  bottomLeft: { x: 140, y: 400 },
  bottomRight: { x: 460, y: 400 },
  topBow: 30,
  bottomBow: 20,
  centreU: 0.5,
  visibleSpan: DEFAULT_VISIBLE_SPAN,
};

describe('horizontal mapping is the foreshortening, not a stretch', () => {
  it('puts the centred design on the centre of the face', () => {
    expect(plateU(0.5, CAL)).toBeCloseTo(0.5, 12);
  });

  it('sweeps a quarter turn to each edge at the default span', () => {
    expect(plateU(1, CAL)).toBeCloseTo(0.75, 12);
    expect(plateU(0, CAL)).toBeCloseTo(0.25, 12);
  });

  it('covers half the circumference edge to edge', () => {
    expect(plateU(1, CAL) - plateU(0, CAL)).toBeCloseTo(DEFAULT_VISIBLE_SPAN, 12);
  });

  it('is NOT linear — a flat stretch would be, and would look wrong', () => {
    const quarter = plateU(0.25, CAL);
    const linear = 0.25 + 0.5 * 0.25;
    expect(Math.abs(quarter - linear)).toBeGreaterThan(0.01);
    // asin(-0.5) = -30 degrees, a twelfth of a turn back from centre.
    expect(quarter).toBeCloseTo(0.5 - 1 / 12, 10);
  });

  it('magnifies the middle of the face relative to the edges', () => {
    const middle = plateU(0.55, CAL) - plateU(0.45, CAL);
    const edge = plateU(1.0, CAL) - plateU(0.9, CAL);
    expect(edge).toBeGreaterThan(middle * 2);
  });

  it('honours a narrower visible span for a cup shot at an angle', () => {
    const narrow = { ...CAL, visibleSpan: 0.3 };
    expect(plateU(1, narrow) - plateU(0, narrow)).toBeCloseTo(0.3, 12);
  });

  it('rotates with centreU, one for one', () => {
    expect(plateU(0.5, { ...CAL, centreU: 0.2 })).toBeCloseTo(0.2, 12);
  });

  it('always returns u inside [0,1)', () => {
    for (const centre of [0, 0.05, 0.5, 0.95, 1]) {
      for (const s of [0, 0.3, 0.5, 0.8, 1]) {
        const u = plateU(s, { ...CAL, centreU: centre });
        expect(u).toBeGreaterThanOrEqual(0);
        expect(u).toBeLessThan(1);
      }
    }
  });

  it('clamps outside the calibrated area instead of returning NaN', () => {
    expect(Number.isFinite(plateU(-0.4, CAL))).toBe(true);
    expect(Number.isFinite(plateU(1.4, CAL))).toBe(true);
  });
});

describe('facing', () => {
  it('is full head-on and zero at the silhouette', () => {
    expect(plateFacing(0.5)).toBeCloseTo(1, 12);
    expect(plateFacing(0)).toBeCloseTo(0, 12);
    expect(plateFacing(1)).toBeCloseTo(0, 12);
  });
  it('is symmetric', () => {
    expect(plateFacing(0.3)).toBeCloseTo(plateFacing(0.7), 12);
  });
});

describe('surface points follow the calibrated quad', () => {
  it('lands exactly on the handles at the corners', () => {
    expect(platePoint(0, 0, CAL)).toEqual(CAL.topLeft);
    expect(platePoint(1, 0, CAL)).toEqual(CAL.topRight);
    expect(platePoint(0, 1, CAL)).toEqual(CAL.bottomLeft);
    expect(platePoint(1, 1, CAL)).toEqual(CAL.bottomRight);
  });

  it('bows the edges at their centre by the stated amount', () => {
    // The sag is what makes it read as a cylinder rather than a poster.
    const topMid = platePoint(0.5, 0, CAL);
    expect(topMid.y).toBeCloseTo(100 + CAL.topBow, 10);
    const bottomMid = platePoint(0.5, 1, CAL);
    expect(bottomMid.y).toBeCloseTo(400 + CAL.bottomBow, 10);
  });

  it('does not bow at the handles themselves', () => {
    expect(platePoint(0, 0, CAL).y).toBeCloseTo(100, 10);
    expect(platePoint(1, 0, CAL).y).toBeCloseTo(100, 10);
  });

  it('follows the taper — the base is narrower than the top', () => {
    const topWidth = platePoint(1, 0, CAL).x - platePoint(0, 0, CAL).x;
    const bottomWidth = platePoint(1, 1, CAL).x - platePoint(0, 1, CAL).x;
    expect(bottomWidth).toBeLessThan(topWidth);
  });

  it('interpolates smoothly down the wall', () => {
    const a = platePoint(0.5, 0, CAL);
    const b = platePoint(0.5, 0.5, CAL);
    const c = platePoint(0.5, 1, CAL);
    expect(b.y).toBeGreaterThan(a.y);
    expect(c.y).toBeGreaterThan(b.y);
  });

  it('a flat calibration produces a flat quad', () => {
    const flat = { ...CAL, topBow: 0, bottomBow: 0 };
    expect(platePoint(0.5, 0, flat).y).toBeCloseTo(100, 10);
  });
});

describe('bounds', () => {
  it('contains every surface point', () => {
    const b = plateBounds(CAL);
    for (let i = 0; i <= 10; i++) {
      for (let j = 0; j <= 10; j++) {
        const p = platePoint(i / 10, j / 10, CAL);
        expect(p.x).toBeGreaterThanOrEqual(b.minX - 1e-9);
        expect(p.x).toBeLessThanOrEqual(b.maxX + 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(b.minY - 1e-9);
        expect(p.y).toBeLessThanOrEqual(b.maxY + 1e-9);
      }
    }
  });

  it('includes the sag below the bottom edge', () => {
    expect(plateBounds(CAL).maxY).toBeCloseTo(400 + CAL.bottomBow, 6);
  });
});

describe('default calibration', () => {
  it('sits inside the image', () => {
    const cal = defaultCalibration(1000, 1200);
    const b = plateBounds(cal);
    expect(b.minX).toBeGreaterThan(0);
    expect(b.minY).toBeGreaterThan(0);
    expect(b.maxX).toBeLessThan(1000);
    expect(b.maxY).toBeLessThan(1200);
  });

  it('starts tapered and bowed, so it reads as a cup before any dragging', () => {
    const cal = defaultCalibration(1000, 1200);
    expect(cal.bottomRight.x - cal.bottomLeft.x)
      .toBeLessThan(cal.topRight.x - cal.topLeft.x);
    expect(cal.topBow).toBeGreaterThan(0);
  });
});
