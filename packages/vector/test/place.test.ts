import { describe, it, expect } from 'vitest';
import { shapeArea } from '../src/place';

describe('shapeArea', () => {
  const sq = (a: number) => [[
    { x: 0, y: 0 }, { x: a, y: 0 }, { x: a, y: a }, { x: 0, y: a },
  ]];

  it('measures a square', () => {
    expect(shapeArea(sq(0.5))).toBeCloseTo(0.25, 9);
  });

  it('subtracts a hole wound the other way', () => {
    // An "O": outer ring clockwise, counter anticlockwise. Counting the
    // counter as solid would make the letter denser than it prints.
    const outer = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    const hole = [{ x: 0.25, y: 0.75 }, { x: 0.75, y: 0.75 },
      { x: 0.75, y: 0.25 }, { x: 0.25, y: 0.25 }];
    expect(shapeArea([outer, hole])).toBeCloseTo(1 - 0.25, 9);
  });

  it('is signless, so winding order cannot make an area negative', () => {
    const cw = sq(0.5)[0]!;
    expect(shapeArea([[...cw].reverse()])).toBeCloseTo(0.25, 9);
  });
});
