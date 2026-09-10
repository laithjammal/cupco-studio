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

/**
 * Everything that used to vanish without a word.
 *
 * A logo that imports as three shapes when it was drawn with nine is worse
 * than one that fails outright, because it looks like a finished import. Each
 * case here was silent before.
 */
describe('silent losses', () => {
  const wrap = (b: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${b}</svg>`;

  it('keeps a line-art logo, which is mostly strokes', () => {
    // Before: one shape, the single filled dot. The rest of the mark was gone.
    const r = importSvg(wrap(`
      <circle cx="50" cy="50" r="40" fill="none" stroke="#1d3f2b" stroke-width="4"/>
      <path d="M30 60 L50 30 L70 60" fill="none" stroke="#1d3f2b" stroke-width="4"/>
      <circle cx="50" cy="70" r="3" fill="#c8102e"/>`));
    expect(r.shapes).toHaveLength(3);
  });

  it('draws a shape that is both filled and stroked as two shapes', () => {
    const r = importSvg(wrap('<rect width="50" height="50" fill="#c8102e" stroke="#1d3f2b" stroke-width="2"/>'));
    expect(r.shapes).toHaveLength(2);
    expect(r.shapes[0]!.fill).toEqual([200, 16, 46]);
    expect(r.shapes[1]!.fill).toEqual([29, 63, 43]);
  });

  it('resolves <use>, in both the xlink and the plain form', () => {
    for (const href of ['xlink:href', 'href']) {
      const r = importSvg(wrap(
        `<defs><rect id="r" width="20" height="20" fill="#c8102e"/></defs>`
        + `<use ${href}="#r" x="10" y="10"/>`));
      expect(r.shapes).toHaveLength(1);
      expect(r.shapes[0]!.fill).toEqual([200, 16, 46]);
      // Placed by the use's own x/y, not left at the origin.
      expect(Math.min(...r.shapes[0]!.subpaths[0]!.points.map((p) => p.x))).toBeCloseTo(10, 6);
    }
  });

  it('resolves a <use> of a <symbol>, and does not call it uninterpreted', () => {
    const r = importSvg(wrap(
      '<symbol id="s"><rect width="20" height="20" fill="#c8102e"/></symbol><use href="#s"/>'));
    expect(r.shapes).toHaveLength(1);
    expect(r.warnings.join(' ')).not.toMatch(/symbol/);
  });

  it('cuts a <use> cycle instead of running out of stack', () => {
    const r = importSvg(wrap('<g id="a"><use href="#a"/></g>'));
    expect(r.warnings.join(' ')).toMatch(/itself/);
  });

  it('says when a <use> points at something the file does not contain', () => {
    const r = importSvg(wrap('<use href="#missing"/>'));
    expect(r.warnings.join(' ')).toMatch(/not in the file/);
  });

  it('does not drop an element over an unquoted or valueless attribute', () => {
    expect(importSvg(wrap('<rect width=50 height=50 fill="#c8102e"/>')).shapes).toHaveLength(1);
    expect(importSvg(wrap('<rect width="50" height="50" fill="#c8102e" data-flag/>')).shapes)
      .toHaveLength(1);
  });

  it('warns that a clip is not applied rather than quietly over-drawing', () => {
    const r = importSvg(wrap(
      '<defs><clipPath id="c"><rect width="50" height="50"/></clipPath></defs>'
      + '<circle cx="50" cy="50" r="40" fill="#c8102e" clip-path="url(#c)"/>'));
    expect(r.warnings.join(' ')).toMatch(/clipping/);
  });
});

/**
 * fill-rule.
 *
 * Two subpaths wound the same way are ONE SOLID AREA under nonzero - which is
 * SVG's default - and a HOLE under even-odd. The app filled every imported
 * path even-odd regardless of what the file said, which punched gaps through
 * logos that had none, and the SVG export wrote no rule at all, so the printed
 * file and the approved preview disagreed with each other.
 */
describe('fill-rule', () => {
  const wrap = (b: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${b}</svg>`;
  const rules = (b: string) => importSvg(wrap(b)).shapes.map((s) => s.fillRule);

  it('defaults to nonzero, as SVG does', () => {
    expect(rules('<path fill="#c8102e" d="M10 10H60V60H10Z"/>')).toEqual(['nonzero']);
  });

  it('reads an explicit rule either way', () => {
    expect(rules('<path fill="#c8102e" fill-rule="evenodd" d="M10 10H60V60H10Z"/>'))
      .toEqual(['evenodd']);
    expect(rules('<path fill="#c8102e" fill-rule="nonzero" d="M10 10H60V60H10Z"/>'))
      .toEqual(['nonzero']);
  });

  it('inherits it from a group', () => {
    expect(rules('<g fill-rule="evenodd"><path fill="#c8102e" d="M10 10H60V60H10Z"/></g>'))
      .toEqual(['evenodd']);
  });

  it('takes it from the stylesheet, with an inline style still winning', () => {
    expect(rules('<style>.a{fill:#c8102e;fill-rule:evenodd;}</style><path class="a" d="M10 10H60V60H10Z"/>'))
      .toEqual(['evenodd']);
    expect(rules('<style>.a{fill-rule:evenodd;}</style>'
      + '<path class="a" fill="#c8102e" style="fill-rule:nonzero" d="M10 10H60V60H10Z"/>'))
      .toEqual(['nonzero']);
  });

  it('always fills a stroke outline nonzero', () => {
    // The outline self-overlaps at a tight corner by design. Under even-odd
    // every one of those overlaps becomes a hole in the middle of the line.
    expect(rules('<path fill="none" stroke="#c8102e" stroke-width="6" d="M10 50 L50 10 L90 50"/>'))
      .toEqual(['nonzero']);
  });
});
