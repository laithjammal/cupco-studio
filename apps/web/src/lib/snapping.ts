/**
 * Alignment guides and snapping.
 *
 * Two kinds of guide, matching how Illustrator and Figma behave:
 *
 *   CANVAS guides  — fixed lines on the cup: centre, both thirds, the middle.
 *                    The element's CENTRE snaps to these.
 *   OBJECT guides  — lines derived from the other artwork on the cup. Here any
 *                    EDGE or centre of the dragged element can align to any
 *                    edge or centre of another, which is what makes "line these
 *                    two logos up" work without measuring.
 *
 * A guide only appears once the element is close to it. Guides that are always
 * visible become wallpaper; guides that appear at the moment of decision are
 * what make alignment feel effortless.
 */

import type { DesignUV } from '@cupco/geometry';

export type GuideAxis = 'u' | 'v';
export type GuideKind = 'canvas' | 'object';

export interface Guide {
  axis: GuideAxis;
  /** Position in design space. */
  at: number;
  label: string;
  kind: GuideKind;
  /**
   * Extent to draw along the PERPENDICULAR axis.
   *
   * Object guides are drawn only across the two elements they relate, so it is
   * obvious which one is being aligned to. Canvas guides span the whole cup.
   */
  from?: number;
  to?: number;
}

/** Axis-aligned bounds of an element in design space. */
export interface ElementBounds {
  id: string;
  u0: number; u1: number; uC: number;
  v0: number; v1: number; vC: number;
}

/**
 * The fixed lines worth snapping to on a cup.
 *
 * Horizontal thirds matter more than they would on a flat page: the cup is
 * seen from one side at a time, so a mark on a third sits comfortably in view
 * as the cup turns.
 */
export const GUIDES: Guide[] = [
  { axis: 'u', at: 1 / 3, label: 'Left third', kind: 'canvas' },
  { axis: 'u', at: 0.5, label: 'Centred', kind: 'canvas' },
  { axis: 'u', at: 2 / 3, label: 'Right third', kind: 'canvas' },
  { axis: 'v', at: 0.5, label: 'Middle', kind: 'canvas' },
];

export interface SnapResult {
  uv: DesignUV;
  active: Guide[];
}

/** One candidate line to snap against. */
interface Candidate {
  /** Where the dragged element's CENTRE must sit to make the match. */
  centre: number;
  guide: Guide;
}

/** Which part of the dragged element is being aligned. */
const ANCHORS: { offset: (half: number) => number; name: string }[] = [
  { offset: (h) => h, name: 'left' },    // dragged LEFT edge meets the line
  { offset: () => 0, name: 'centre' },
  { offset: (h) => -h, name: 'right' },  // dragged RIGHT edge meets the line
];

function edgeLabel(anchor: string, target: string): string {
  if (anchor === 'centre' && target === 'centre') return 'Centres aligned';
  if (anchor === target) return `${cap(target)} edges aligned`;
  if (anchor === 'centre') return `Centre on ${target}`;
  if (target === 'centre') return `${cap(anchor)} on centre`;
  return `${cap(anchor)} meets ${target}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Build every line the dragged element could align to on one axis.
 *
 * Each of the dragged element's three anchors (leading edge, centre, trailing
 * edge) is tested against each of the other element's three, so a logo can be
 * flushed left with another, centred on it, or butted edge to edge.
 */
function objectCandidates(
  axis: GuideAxis,
  others: readonly ElementBounds[],
  half: number,
  perpHalf: number,
  centrePerp: number,
): Candidate[] {
  const out: Candidate[] = [];
  for (const o of others) {
    const targets = axis === 'u'
      ? [{ at: o.u0, name: 'left' }, { at: o.uC, name: 'centre' }, { at: o.u1, name: 'right' }]
      : [{ at: o.v0, name: 'bottom' }, { at: o.vC, name: 'centre' }, { at: o.v1, name: 'top' }];

    // Span the guide across both elements on the other axis, so it is clear
    // which element is being aligned to.
    const oFrom = axis === 'u' ? o.v0 : o.u0;
    const oTo = axis === 'u' ? o.v1 : o.u1;
    const from = Math.min(oFrom, centrePerp - perpHalf) - 0.02;
    const to = Math.max(oTo, centrePerp + perpHalf) + 0.02;

    for (const t of targets) {
      for (const a of ANCHORS) {
        out.push({
          centre: t.at + a.offset(half),
          guide: {
            axis, at: t.at, kind: 'object',
            label: edgeLabel(a.name, t.name),
            from: Math.max(0, from),
            to: Math.min(1, to),
          },
        });
      }
    }
  }
  return out;
}

export interface SnapInput {
  uv: DesignUV;
  /** Half-extent of the dragged element in design space. */
  halfU: number;
  halfV: number;
  /** Bounds of every OTHER element. */
  others: readonly ElementBounds[];
  toleranceU: number;
  toleranceV: number;
  enabled?: boolean;
}

/**
 * Snap a position to whichever guide is nearest, per axis.
 *
 * Object guides win ties against canvas guides at equal distance: if a logo is
 * equally close to the cup's centre line and to another logo's edge, matching
 * the other logo is almost always the intent.
 */
export function snapToGuides(input: SnapInput): SnapResult {
  const { uv, halfU, halfV, others, toleranceU, toleranceV } = input;
  if (input.enabled === false) return { uv, active: [] };

  const pick = (
    axis: GuideAxis,
    current: number,
    half: number,
    perpHalf: number,
    perpCentre: number,
    tolerance: number,
  ): { value: number; guide: Guide } | null => {
    const candidates: Candidate[] = [
      // Canvas guides align the element's CENTRE only.
      ...GUIDES.filter((g) => g.axis === axis).map((g) => ({ centre: g.at, guide: g })),
      ...objectCandidates(axis, others, half, perpHalf, perpCentre),
    ];

    let best: { value: number; guide: Guide; d: number } | null = null;
    for (const c of candidates) {
      // u wraps: a mark just past the seam is still near a guide near 0 or 1.
      const d = axis === 'u'
        ? Math.min(Math.abs(current - c.centre), Math.abs(current - c.centre + 1), Math.abs(current - c.centre - 1))
        : Math.abs(current - c.centre);
      if (d > tolerance) continue;
      const better = !best || d < best.d - 1e-9
        || (Math.abs(d - best.d) < 1e-9 && c.guide.kind === 'object' && best.guide.kind === 'canvas');
      if (better) best = { value: c.centre, guide: c.guide, d };
    }
    return best ? { value: best.value, guide: best.guide } : null;
  };

  const u = pick('u', uv.u, halfU, halfV, uv.v, toleranceU);
  const v = pick('v', uv.v, halfV, halfU, uv.u, toleranceV);

  const active: Guide[] = [];
  if (u) active.push(u.guide);
  if (v) active.push(v.guide);

  return {
    uv: { u: u ? u.value : uv.u, v: v ? v.value : uv.v },
    active,
  };
}

/** Distance in design units equivalent to a screen-pixel tolerance. */
export function toleranceFor(pixels: number, designPixels: number): number {
  return pixels / Math.max(1, designPixels);
}
