import { describe, it, expect } from 'vitest';
import { matchFamily, cssWeightMatch } from '@/lib/fonts';

describe('matching a file\'s font to a bundled face', () => {
  it.each([
    [['Inter'], 'inter'],
    [['"Montserrat"', 'sans-serif'], 'montserrat'],
    [['Playfair Display'], 'playfair'],
    [['roboto-slab'], 'slab'],
    [['Bebas Neue'], 'bebas'],
  ])('uses %j exactly when the file names it', (families, id) => {
    expect(matchFamily(families)).toEqual({ id, exact: true });
  });

  it('prefers a later family that IS bundled over an earlier one that is not', () => {
    // font-family: "Brandon Grotesque", Montserrat - the designer's own
    // fallback is the better guess than our classification of the first.
    expect(matchFamily(['Brandon Grotesque', 'Montserrat'])).toEqual({ id: 'montserrat', exact: true });
  });

  it.each([
    ['Futura PT', 'montserrat'],
    ['Gotham Rounded', 'montserrat'],
    ['Brandon Grotesque', 'montserrat'],
    ['Helvetica Neue', 'inter'],
    ['Arial', 'inter'],
    ['Noto Sans', 'inter'],
    ['Merriweather Sans', 'inter'],
    ['Noto Serif', 'playfair'],
    ['Times New Roman', 'playfair'],
    ['EB Garamond', 'playfair'],
    ['Roboto Condensed', 'oswald'],
    ['Impact', 'oswald'],
    ['Courier New', 'slab'],
    ['Rockwell', 'slab'],
    ['Bebas Kai', 'bebas'],
  ])('sets %s in the nearest face of the same kind', (family, id) => {
    expect(matchFamily([family])).toEqual({ id, exact: false });
  });

  it('answers the generic families without calling it exact', () => {
    expect(matchFamily(['sans-serif'])).toEqual({ id: 'inter', exact: false });
    expect(matchFamily(['serif'])).toEqual({ id: 'playfair', exact: false });
    expect(matchFamily(['monospace'])).toEqual({ id: 'slab', exact: false });
  });

  it('falls back to a clean sans for a name it cannot place', () => {
    expect(matchFamily(['Qwertyuiop Display'])).toEqual({ id: 'inter', exact: false });
  });
});

describe('weight matching follows CSS, not "nearest"', () => {
  const both = [400, 700];
  it.each([
    [400, 400], [700, 700],
    // 500 looks lighter first; 600 looks heavier first.
    [500, 400], [600, 700],
    [300, 400], [100, 400],
    [800, 700], [900, 700],
  ])('asks for %i, gets %i', (desired, got) => {
    expect(cssWeightMatch(both, desired)).toBe(got);
  });

  it('copes with a family that has one weight', () => {
    expect(cssWeightMatch([400], 700)).toBe(400);
  });
});
