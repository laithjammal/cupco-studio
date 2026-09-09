import { describe, it, expect } from 'vitest';
import { needsSeamCopies } from '@/lib/design';
import type { DesignElement } from '@/lib/design';

/**
 * The seam wrap.
 *
 * Design space is a cylinder cut open at u = 0, so an element crossing that
 * cut has to be drawn again either side of it. The bug this pins is the
 * opposite case: an element WIDER than the circumference had its wrapped
 * copies drawn on top of itself, painting the far side of the artwork over
 * the near side. On the January template that buried the "LOCAL CAFES /
 * BRIGHTER TOGETHER" block under the leaves from the artwork's other edge -
 * which read as the words being cut off.
 */
describe('seam copies', () => {
  const W = 2732, H = 1019;
  const img = (widthU: number): DesignElement => ({
    id: 'x', type: 'image', name: 'art', u: 0.5, v: 0.5, rotation: 0,
    widthU, opacity: 1,
    image: { naturalWidth: 1855, naturalHeight: 848 } as HTMLImageElement,
  } as DesignElement);

  it('draws the wrapped copies for anything narrower than the wrap', () => {
    expect(needsSeamCopies(img(0.25), W, H)).toBe(true);
    expect(needsSeamCopies(img(0.999), W, H)).toBe(true);
  });

  it('does NOT wrap an element that already spans the circumference', () => {
    // The January template is 1.1193 wide - it covers the bleed box.
    expect(needsSeamCopies(img(1.1193), W, H)).toBe(false);
    expect(needsSeamCopies(img(1), W, H)).toBe(false);
  });

  it('does not wrap a band, which is full width by definition', () => {
    const band = {
      id: 'b', type: 'band', u: 0.5, v: 0.5, rotation: 0,
      heightV: 0.2, color: '#000', opacity: 1,
    } as unknown as DesignElement;
    expect(needsSeamCopies(band, W, H)).toBe(false);
  });
});
