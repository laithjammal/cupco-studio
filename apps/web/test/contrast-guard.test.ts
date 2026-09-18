import { describe, it, expect } from 'vitest';
import { materialiseConcept } from '@/lib/concepts-adapter';
import { contrastRatio } from '@cupco/concepts';
import type { RGB } from '@cupco/vector';

/**
 * A treatment must not make a mark unreadable.
 *
 * `tone` is a guess about the ground, made when the layout was written. When a
 * layout names the ground with `against`, the guess is checked instead of
 * trusted - because lightening a mark that turns out to sit on something pale
 * is how a logo goes invisible while every step reports success.
 */
describe('the contrast guard on artwork treatment', () => {
  const tri = [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.5, y: 0.8 }];
  const art = (fill: RGB) => ({
    aspect: 1,
    shapes: [{ subpaths: [tri], fill, opacity: 1 }],
  });

  const treat = (fill: RGB, against: string) => {
    const layout = {
      id: 'x', label: 'x', description: '', background: '#ffffff',
      placements: [{
        kind: 'artwork' as const, u: 0.5, v: 0.5, rotation: 0, widthU: 0.2,
        treatment: { dropPlate: false, tone: 'lighten' as const, against },
      }],
    };
    const design = materialiseConcept(
      layout as never, { art: art(fill) as never, name: 'mark' }, 2732, 1019,
    );
    const el = design.elements.find((e) => e.type === 'vector');
    return (el as { art: { shapes: { fill: RGB }[] } }).art.shapes[0]!.fill;
  };

  it('lightens a dark mark for a DARK ground, as asked', () => {
    const out = treat([41, 35, 31], '#025039');
    expect(contrastRatio(out, [2, 80, 57])).toBeGreaterThan(contrastRatio([41, 35, 31], [2, 80, 57]));
  });

  it('refuses to lighten a dark mark that sits on a PALE ground', () => {
    // The reported bug: light type on a light panel. The tone said lighten,
    // the ground says otherwise, and the ground wins.
    const dark: RGB = [41, 35, 31];
    const out = treat(dark, '#f5e9d2');
    expect(out).toEqual(dark);
    expect(contrastRatio(out, [245, 233, 210])).toBeGreaterThan(4.5);
  });

  it('never returns artwork that reads worse than leaving it alone', () => {
    for (const ground of ['#ffffff', '#f5e9d2', '#025039', '#000000', '#c8102e']) {
      const original: RGB = [41, 35, 31];
      const rgb = [
        parseInt(ground.slice(1, 3), 16),
        parseInt(ground.slice(3, 5), 16),
        parseInt(ground.slice(5, 7), 16),
      ] as RGB;
      expect(contrastRatio(treat(original, ground), rgb))
        .toBeGreaterThanOrEqual(contrastRatio(original, rgb) - 1e-9);
    }
  });
});
