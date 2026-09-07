import { describe, it, expect } from 'vitest';
import { buildArtworkTemplateSvg, deriveFrustum, BUILT_IN_PROFILES, CUP_8OZ } from '../src/index';

/**
 * Minimal well-formedness scanner.
 *
 * The geometry package has no DOM and no dependencies, so rather than pull in
 * a parser this walks the tags with a stack. That is enough to catch the class
 * of bug worth catching here: an unbalanced or mis-nested element, which makes
 * Illustrator and most viewers reject the file outright.
 */
function checkWellFormed(svg: string): { ok: boolean; error?: string } {
  const stripped = svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '');

  const tagRe = /<\s*(\/)?\s*([A-Za-z_][\w.:-]*)([^>]*?)(\/)?>/g;
  const stack: string[] = [];
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(stripped)) !== null) {
    const [, closing, name, attrs, selfClose] = m;
    const tag = name!.toLowerCase();
    if (selfClose || attrs?.trimEnd().endsWith('/')) continue;
    if (closing) {
      const top = stack.pop();
      if (top !== tag) {
        return { ok: false, error: `</${tag}> closes <${top ?? 'nothing'}>` };
      }
    } else {
      stack.push(tag);
    }
  }
  if (stack.length > 0) return { ok: false, error: `unclosed: ${stack.join(', ')}` };
  return { ok: true };
}

/** Text content must not contain raw &, < or > — they break XML parsers. */
function checkTextEscaping(svg: string): string[] {
  const bad: string[] = [];
  const re = /<text[^>]*>([^<]*)</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    const text = m[1]!;
    if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(text)) bad.push(text);
    if (/[<>]/.test(text)) bad.push(text);
  }
  return bad;
}

describe('artwork template — the file must actually open', () => {
  it.each(BUILT_IN_PROFILES.map((p) => [p.displayName, p] as const))(
    '%s: is well-formed XML',
    (_name, profile) => {
      // A stray closing tag once shipped here; Illustrator rejects the whole
      // file rather than recovering, so this is worth asserting per profile.
      const result = checkWellFormed(buildArtworkTemplateSvg(profile));
      expect(result.error ?? 'ok').toBe('ok');
      expect(result.ok).toBe(true);
    },
  );

  it.each(BUILT_IN_PROFILES.map((p) => [p.displayName, p] as const))(
    '%s: no unescaped entities in text',
    (_name, profile) => {
      expect(checkTextEscaping(buildArtworkTemplateSvg(profile))).toEqual([]);
    },
  );

  it('declares millimetre dimensions matching the derived geometry', () => {
    const svg = buildArtworkTemplateSvg(CUP_8OZ);
    const g = deriveFrustum(CUP_8OZ.dimensions);
    const w = /width="([\d.]+)mm"/.exec(svg);
    const h = /height="([\d.]+)mm"/.exec(svg);
    expect(w).not.toBeNull();
    expect(h).not.toBeNull();
    // Trim width plus bleed on both sides, plus the page padding.
    const c = CUP_8OZ.margins.cut;
    const bl = CUP_8OZ.margins.bleedMm;
    const cutL = Math.max(c.left.atTopMm, c.left.atBottomMm);
    const cutR = Math.max(c.right.atTopMm, c.right.atBottomMm);
    const expectedW = g.topArcMm + cutL + cutR + bl * 2 + 18 * 2;
    expect(Number(w![1])).toBeCloseTo(expectedW, 1);
    // Height also carries the legend panel, so it must EXCEED the artwork box.
    expect(Number(h![1])).toBeGreaterThan(g.slantMm + c.topMm + c.bottomMm + bl * 2 + 36);
  });

  it('has a viewBox matching its declared size, so it scales correctly', () => {
    const svg = buildArtworkTemplateSvg(CUP_8OZ);
    const w = Number(/width="([\d.]+)mm"/.exec(svg)![1]);
    const h = Number(/height="([\d.]+)mm"/.exec(svg)![1]);
    const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)!;
    expect(Number(vb[1])).toBeCloseTo(w, 2);
    expect(Number(vb[2])).toBeCloseTo(h, 2);
  });

  it('carries the layers a designer is told to use', () => {
    const svg = buildArtworkTemplateSvg(CUP_8OZ);
    for (const id of ['ARTWORK', 'GUIDES', 'LEGEND']) {
      expect(svg).toContain(`id="${id}"`);
    }
  });

  it('the legend explains every guide line that is drawn', () => {
    const svg = buildArtworkTemplateSvg(CUP_8OZ);
    for (const term of ['BLEED', 'CUT', 'TRIM', 'SAFE AREA', 'CENTRE LINE']) {
      expect(svg).toContain(term);
    }
  });

  it('states the real measurements, not placeholders', () => {
    const svg = buildArtworkTemplateSvg(CUP_8OZ);
    expect(svg).toContain(`${CUP_8OZ.margins.cut.bottomMm}mm base`);
    expect(svg).not.toContain('SEAM OVERLAP');
  });

  it('detects a deliberately broken document', () => {
    // Guards the guard: a scanner that always passes would be worse than none.
    expect(checkWellFormed('<svg><g></g></g></svg>').ok).toBe(false);
    expect(checkWellFormed('<svg><g></svg>').ok).toBe(false);
    expect(checkWellFormed('<svg><g/></svg>').ok).toBe(true);
  });
});
