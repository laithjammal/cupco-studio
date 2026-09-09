import { describe, it, expect } from 'vitest';
import { importSvg } from '../src/svg-import';

/**
 * Internal stylesheets.
 *
 * Illustrator's default SVG export writes every fill into a <style> block and
 * references it by class. Before this was handled, each of those shapes fell
 * back to the inherited default and the logo imported as a solid black
 * silhouette - detail welded shut, and no warning to say why.
 */
describe('CSS in <style>', () => {
  const svg = (defs: string, body: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${defs}${body}</svg>`;
  const hexes = (src: string) => importSvg(src).shapes
    .map((s) => '#' + s.fill.map((n) => n.toString(16).padStart(2, '0')).join(''));

  it('reads fills from a class rule instead of importing everything black', () => {
    const r = hexes(svg(
      '<defs><style>.cls-1{fill:#e6a670;}.cls-2{fill:#1a4d3d;}</style></defs>',
      '<rect class="cls-1" width="50" height="50"/><rect class="cls-2" width="50" height="50"/>',
    ));
    expect(r).toEqual(['#e6a670', '#1a4d3d']);
  });

  it('survives the CDATA wrapper drawing tools put around the CSS', () => {
    expect(hexes(svg(
      '<style><![CDATA[ .a{fill:#123456;} ]]></style>',
      '<rect class="a" width="50" height="50"/>',
    ))).toEqual(['#123456']);
  });

  it('drops a shape the stylesheet sets to none', () => {
    // A clip or bounding rect. Imported as a filled shape it prints as a
    // black box over the artwork.
    const r = importSvg(svg(
      '<style>.bg{fill:none;}.mark{fill:#e6a670;}</style>',
      '<rect class="bg" width="100" height="100"/><rect class="mark" width="50" height="50"/>',
    ));
    expect(r.shapes).toHaveLength(1);
  });

  it('lets an inline style beat the stylesheet, and the stylesheet beat a fill attribute', () => {
    expect(hexes(svg(
      '<style>.a{fill:#00ff00;}</style>',
      '<rect class="a" fill="#ff0000" style="fill:#0000ff" width="10" height="10"/>',
    ))).toEqual(['#0000ff']);
    expect(hexes(svg(
      '<style>.a{fill:#00ff00;}</style>',
      '<rect class="a" fill="#ff0000" width="10" height="10"/>',
    ))).toEqual(['#00ff00']);
  });

  it('applies the cascade: id beats class beats element', () => {
    expect(hexes(svg(
      '<style>rect{fill:#111111;}.a{fill:#222222;}#z{fill:#333333;}</style>',
      '<rect id="z" class="a" width="10" height="10"/>',
    ))).toEqual(['#333333']);
    expect(hexes(svg(
      '<style>rect{fill:#111111;}.a{fill:#222222;}</style>',
      '<rect class="a" width="10" height="10"/>',
    ))).toEqual(['#222222']);
  });

  it('inherits a class fill from a group', () => {
    expect(hexes(svg(
      '<style>.g{fill:#abcdef;}</style>',
      '<g class="g"><rect width="10" height="10"/></g>',
    ))).toEqual(['#abcdef']);
  });

  it('says so rather than guessing when a selector is beyond it', () => {
    const r = importSvg(svg(
      '<style>.a .b{fill:#00ff00;}</style>',
      '<rect class="b" fill="#ff0000" width="10" height="10"/>',
    ));
    expect(r.warnings.join(' ')).toMatch(/too complex/);
    // and leaves the attribute's colour alone rather than misapplying the rule
    expect(r.shapes[0]!.fill).toEqual([255, 0, 0]);
  });

  it('does not let CSS containing angle brackets derail the element scanner', () => {
    const r = importSvg(svg(
      '<style>.a > .b { fill:#00ff00; }</style>',
      '<rect class="a" fill="#ff0000" width="10" height="10"/>',
    ));
    expect(r.shapes).toHaveLength(1);
  });
});
