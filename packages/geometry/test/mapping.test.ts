import { describe, it, expect } from 'vitest';
import {
  deriveFrustum,
  designToFan,
  fanToDesign,
  designToCup,
  circumferenceAtV,
  designWidthToMm,
  distanceToSeamMm,
  CUP_8OZ,
  BUILT_IN_PROFILES,
} from '../src/index';

const g8 = deriveFrustum(CUP_8OZ.dimensions);

/** A deterministic spread of design-space samples, including the edges. */
const SAMPLES = (() => {
  const out: { u: number; v: number }[] = [];
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) out.push({ u: i / 10, v: j / 10 });
  }
  return out;
})();

describe('design <-> fan round trip', () => {
  it.each(BUILT_IN_PROFILES.map((p) => [p.displayName, p] as const))(
    '%s: fanToDesign(designToFan(p)) === p',
    (_name, profile) => {
      const g = deriveFrustum(profile.dimensions);
      for (const uv of SAMPLES) {
        const back = fanToDesign(designToFan(uv, g), g);
        expect(back.u).toBeCloseTo(uv.u, 9);
        expect(back.v).toBeCloseTo(uv.v, 9);
      }
    },
  );
});

describe('fan mapping lands artwork on the true rims', () => {
  it('v=0 maps to the bottom rim radius, v=1 to the top', () => {
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const bottom = designToFan({ u, v: 0 }, g8);
      const top = designToFan({ u, v: 1 }, g8);
      expect(Math.hypot(bottom.x, bottom.y)).toBeCloseTo(g8.rBottomMm, 9);
      expect(Math.hypot(top.x, top.y)).toBeCloseTo(g8.rTopMm, 9);
    }
  });

  it('the full u sweep subtends exactly the sector angle', () => {
    const a = designToFan({ u: 0, v: 0.5 }, g8);
    const b = designToFan({ u: 1, v: 0.5 }, g8);
    const angle = Math.atan2(b.x, -b.y) - Math.atan2(a.x, -a.y);
    expect(angle).toBeCloseTo(g8.sectorAngleRad, 10);
  });

  it('the fan is centred: u=0.5 sits on the vertical axis', () => {
    const mid = designToFan({ u: 0.5, v: 0.5 }, g8);
    expect(mid.x).toBeCloseTo(0, 10);
    expect(mid.y).toBeLessThan(0); // opens downward from the apex
  });

  it('v is monotonic in distance from the apex', () => {
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const p = designToFan({ u: 0.5, v: i / 20 }, g8);
      const rho = Math.hypot(p.x, p.y);
      expect(rho).toBeGreaterThan(prev);
      prev = rho;
    }
  });
});

describe('3D cup surface mapping', () => {
  it('places v=0 and v=1 at the correct radii and heights', () => {
    const bottom = designToCup({ u: 0.3, v: 0 }, g8);
    const top = designToCup({ u: 0.3, v: 1 }, g8);
    expect(Math.hypot(bottom.x, bottom.z)).toBeCloseTo(g8.bottomRadiusMm, 9);
    expect(Math.hypot(top.x, top.z)).toBeCloseTo(g8.topRadiusMm, 9);
    expect(bottom.y).toBeCloseTo(0, 9);
    expect(top.y).toBeCloseTo(g8.heightMm, 9);
  });

  it('wraps continuously: u=0 and u=1 are the same point on the cup', () => {
    const a = designToCup({ u: 0, v: 0.5 }, g8);
    const b = designToCup({ u: 1, v: 0.5 }, g8);
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.y).toBeCloseTo(b.y, 9);
    expect(a.z).toBeCloseTo(b.z, 9);
  });

  it('radius varies linearly with height, matching CylinderGeometry UVs', () => {
    // This is what lets the 3D preview use the design canvas as a texture with
    // no pre-warp. If it ever fails, the 3D view has silently diverged.
    for (let i = 0; i <= 10; i++) {
      const v = i / 10;
      const p = designToCup({ u: 0, v }, g8);
      const expected = g8.bottomRadiusMm + (g8.topRadiusMm - g8.bottomRadiusMm) * v;
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(expected, 9);
    }
  });

  it('honours the seam position offset', () => {
    const noSeam = designToCup({ u: 0, v: 0.5 }, g8, 0);
    const shifted = designToCup({ u: 0, v: 0.5 }, g8, Math.PI);
    expect(shifted.x).toBeCloseTo(-noSeam.x, 9);
    expect(shifted.z).toBeCloseTo(-noSeam.z, 9);
  });
});

describe('the two representations agree with each other', () => {
  // The architectural promise: 3D preview and production fan are two views of
  // ONE design. Arc length travelled around the cup must equal arc length
  // travelled across the fan, at every height.
  it('arc length around the cup equals arc length across the fan', () => {
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      const du = 0.1;
      const cupArc = du * circumferenceAtV(v, g8);
      const rho = g8.rBottomMm + g8.slantMm * v;
      const fanArc = du * g8.sectorAngleRad * rho;
      expect(fanArc).toBeCloseTo(cupArc, 9);
    }
  });
});

describe('physical measurement helpers', () => {
  it('reports true circumference at the rims', () => {
    expect(circumferenceAtV(0, g8)).toBeCloseTo(Math.PI * 55.0, 9);
    expect(circumferenceAtV(1, g8)).toBeCloseTo(Math.PI * 73.62, 9);
  });

  it('the same design width is physically narrower lower down the cup', () => {
    // Not a bug — a consequence of angular design space on a tapered surface.
    const atBottom = designWidthToMm(0.2, 0, g8);
    const atTop = designWidthToMm(0.2, 1, g8);
    expect(atBottom).toBeLessThan(atTop);
    expect(atTop / atBottom).toBeCloseTo(73.62 / 55.0, 9);
  });
});

describe('seam proximity', () => {
  it('is zero at the seam and maximal opposite it', () => {
    expect(distanceToSeamMm({ u: 0, v: 0.5 }, g8)).toBeCloseTo(0, 9);
    expect(distanceToSeamMm({ u: 1, v: 0.5 }, g8)).toBeCloseTo(0, 9);
    const opposite = distanceToSeamMm({ u: 0.5, v: 0.5 }, g8);
    expect(opposite).toBeCloseTo(circumferenceAtV(0.5, g8) / 2, 9);
  });

  it('treats the seam as wrapping, not as a canvas edge', () => {
    const justBefore = distanceToSeamMm({ u: 0.99, v: 0.5 }, g8);
    const justAfter = distanceToSeamMm({ u: 0.01, v: 0.5 }, g8);
    expect(justBefore).toBeCloseTo(justAfter, 9);
  });

  it('handles u outside [0,1) by wrapping', () => {
    expect(distanceToSeamMm({ u: 1.25, v: 0.5 }, g8)).toBeCloseTo(
      distanceToSeamMm({ u: 0.25, v: 0.5 }, g8),
      9,
    );
    expect(distanceToSeamMm({ u: -0.25, v: 0.5 }, g8)).toBeCloseTo(
      distanceToSeamMm({ u: 0.75, v: 0.5 }, g8),
      9,
    );
  });
});
