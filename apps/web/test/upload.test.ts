import { describe, it, expect } from 'vitest';
import { isSvgFile, isPdfFile, unsupportedReason } from '@/lib/upload';

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
