import { describe, it, expect } from 'vitest';
import { normaliseMarquee, elementsInMarquee, nudge } from '@/lib/editor';
import type { Design, DesignElement } from '@/lib/design';

const el = (id: string, u: number, v: number, widthU = 0.1): DesignElement => ({
  id, type: 'image', name: id, u, v, rotation: 0, widthU, opacity: 1,
  image: { naturalWidth: 100, naturalHeight: 100 } as HTMLImageElement,
} as DesignElement);

const design = (...elements: DesignElement[]): Design =>
  ({ background: '#fff', elements } as Design);

const W = 2732, H = 1019;

describe('marquee selection', () => {
  it('normalises a box dragged in any direction', () => {
    const a = normaliseMarquee({ u: 0.8, v: 0.9 }, { u: 0.2, v: 0.1 });
    expect(a).toEqual({ u0: 0.2, u1: 0.8, v0: 0.1, v1: 0.9 });
  });

  it('catches what it covers and leaves the rest', () => {
    const d = design(el('a', 0.2, 0.5), el('b', 0.8, 0.5));
    const caught = elementsInMarquee(d, { u0: 0.1, u1: 0.3, v0: 0.3, v1: 0.7 }, W, H);
    expect(caught).toEqual(['a']);
  });

  it('takes anything it TOUCHES, not only what it encloses', () => {
    // The full-bleed template is wider than the canvas, so no marquee can
    // ever enclose it. Containment would make the one element a person most
    // wants to grab the one element they cannot.
    const d = design(el('wide', 0.5, 0.5, 1.12));
    const caught = elementsInMarquee(d, { u0: 0.45, u1: 0.55, v0: 0.45, v1: 0.55 }, W, H);
    expect(caught).toEqual(['wide']);
  });

  it('catches an element straddling the seam from either side', () => {
    const d = design(el('seam', 0.99, 0.5, 0.1));
    // Drawn at the far LEFT of the canvas: the element hangs over from the
    // right, because u wraps.
    expect(elementsInMarquee(d, { u0: 0, u1: 0.02, v0: 0.4, v1: 0.6 }, W, H)).toEqual(['seam']);
    expect(elementsInMarquee(d, { u0: 0.95, u1: 1, v0: 0.4, v1: 0.6 }, W, H)).toEqual(['seam']);
  });

  it('misses an element outside it vertically even when u overlaps', () => {
    const d = design(el('a', 0.5, 0.9));
    expect(elementsInMarquee(d, { u0: 0.4, u1: 0.6, v0: 0.1, v1: 0.2 }, W, H)).toEqual([]);
  });
});

/**
 * Arrow-key nudging.
 *
 * The step is one pixel of the design DOCUMENT. Pinned because it is the kind
 * of constant that drifts to "whatever felt right on the screen I had open",
 * and the whole point is that it means the same thing everywhere.
 */
describe('nudge', () => {
  const at = { u: 0.5, v: 0.5 };

  it('moves one document pixel per press', () => {
    expect(nudge(at, 'ArrowRight', W, H)!.u).toBeCloseTo(0.5 + 1 / W, 10);
    expect(nudge(at, 'ArrowLeft', W, H)!.u).toBeCloseTo(0.5 - 1 / W, 10);
  });

  it('counts v upward, so ArrowUp raises the element on the cup', () => {
    expect(nudge(at, 'ArrowUp', W, H)!.v).toBeCloseTo(0.5 + 1 / H, 10);
    expect(nudge(at, 'ArrowDown', W, H)!.v).toBeCloseTo(0.5 - 1 / H, 10);
  });

  it('takes ten pixels when coarse', () => {
    expect(nudge(at, 'ArrowRight', W, H, true)!.u).toBeCloseTo(0.5 + 10 / W, 10);
  });

  it('wraps u at the seam but clamps v at the rim', () => {
    // Design space is a cylinder across and a finite height up.
    expect(nudge({ u: 0.9999, v: 0.5 }, 'ArrowRight', W, H)!.u).toBeLessThan(0.5);
    expect(nudge({ u: 0.0001, v: 0.5 }, 'ArrowLeft', W, H)!.u).toBeGreaterThan(0.5);
    expect(nudge({ u: 0.5, v: 1 }, 'ArrowUp', W, H)!.v).toBe(1);
    expect(nudge({ u: 0.5, v: 0 }, 'ArrowDown', W, H)!.v).toBe(0);
  });

  it('ignores a key that is not an arrow', () => {
    expect(nudge(at, 'k', W, H)).toBeNull();
  });
});
