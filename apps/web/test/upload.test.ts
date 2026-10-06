import { describe, it, expect } from 'vitest';
import { isSvgFile, isPdfFile, unsupportedReason, readSvg } from '@/lib/upload';

const file = (name: string, type = ''): File =>
  ({ name, type } as File);

describe('file type detection', () => {
  it.each(['logo.svg', 'LOGO.SVG'])('recognises %s as SVG', (n) => {
    expect(isSvgFile(file(n))).toBe(true);
  });

  it('recognises SVG by MIME even with an odd name', () => {
    expect(isSvgFile(file('export', 'image/svg+xml'))).toBe(true);
  });

  it.each(['brand.pdf', 'brand.ai', 'BRAND.AI'])('recognises %s as PDF-based', (n) => {
    // A modern .ai file IS a PDF, so one reader serves both.
    expect(isPdfFile(file(n))).toBe(true);
  });

  it('does not treat EPS as a PDF', () => {
    expect(isPdfFile(file('mark.eps'))).toBe(false);
  });
});

describe('unsupported file guidance', () => {
  it.each(['logo.svg', 'logo.png', 'photo.JPG', 'shot.jpeg', 'img.webp', 'brand.pdf', 'brand.ai'])(
    'accepts %s',
    (n) => { expect(unsupportedReason(file(n))).toBeNull(); },
  );

  it('rejects PSD despite its image/* MIME type', () => {
    // Photoshop reports image/vnd.adobe.photoshop, so trusting the MIME prefix
    // lets it reach a loader that can only fail with a useless message.
    const r = unsupportedReason(file('brand.psd', 'image/vnd.adobe.photoshop'));
    expect(r).toMatch(/Export the artwork as SVG/);
  });

  it.each(['a.indd', 'b.sketch', 'c.fig', 'd.cdr', 'e.xd', 'f.tif'])(
    'rejects design-tool file %s with guidance',
    (n) => { expect(unsupportedReason(file(n))).toMatch(/Export the artwork/); },
  );

  it('explains why EPS specifically cannot work', () => {
    const r = unsupportedReason(file('mark.eps'));
    expect(r).toMatch(/PostScript/);
    expect(r).toMatch(/Illustrator/);
  });

  it('falls back to MIME when the name has no extension', () => {
    expect(unsupportedReason(file('download', 'image/png'))).toBeNull();
  });

  it('rejects things that are not artwork at all', () => {
    expect(unsupportedReason(file('notes.txt', 'text/plain'))).toMatch(/Not an artwork file/);
  });

  it('every rejection tells the user what to do instead', () => {
    // A message that only says "could not read" leaves the operator stuck.
    for (const n of ['mark.eps', 'brand.psd', 'notes.txt', 'x.indd']) {
      const r = unsupportedReason(file(n))!;
      expect(r).toMatch(/SVG|Illustrator|Export|Upload/);
    }
  });
});

describe('reading an SVG upload', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHwyZGBgAI9UD/fgq6tgAAAAASUVORK5CYII=';

  it('takes off a white plate and fits the box to what is left', () => {
    const r = readSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
      <rect width="200" height="100" fill="#fff"/>
      <rect x="50" y="25" width="100" height="50" fill="#123456"/>
    </svg>`);
    expect(r.kind).toBe('vector');
    expect(r.plateRemoved).toBe(true);
    expect(r.art.shapes).toHaveLength(1);
    expect(r.box.x).toBeCloseTo(50, 6);
    expect(r.box.y).toBeCloseTo(25, 6);
    expect(r.box.w).toBeCloseTo(100, 6);
    expect(r.box.h).toBeCloseTo(50, 6);
    expect(r.notes).toContain('background plate removed');
  });

  it('recognises a picture in an SVG wrapper for what it is', () => {
    const r = readSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
      <image href="${PNG}" width="20" height="10"/></svg>`);
    expect(r.kind).toBe('bitmap');
    expect(r.notes[0]).toMatch(/no vector artwork — it is a 2×1px picture/);
  });

  it('says when a vector logo carries a picture inside it', () => {
    const r = readSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10">
      <image href="${PNG}" width="10" height="5"/><circle cx="15" cy="5" r="4"/></svg>`);
    expect(r.kind).toBe('vector');
    expect(r.art.rasters).toHaveLength(1);
    expect(r.notes[0]).toMatch(/an embedded picture — kept as a picture/);
  });

  it('reports an empty file as empty, not as zero shapes', () => {
    const r = readSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g/></svg>');
    expect(r.kind).toBe('empty');
    expect(r.notes).toContain('No visible artwork found');
  });

  it('reports text it could not draw when there are no fonts', () => {
    const r = readSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text y="8">Hi</text><rect width="2" height="2"/></svg>');
    expect(r.notes.join(' ')).toMatch(/no fonts are available/);
  });
});
