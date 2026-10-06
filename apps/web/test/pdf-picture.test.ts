import { describe, it, expect } from 'vitest';
import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFRawStream, PDFDict, PDFRef } from 'pdf-lib';
import { createImage } from '@cupco/render';
import { drawFanPicture, cmykSamples } from '@/lib/pdf-picture';

const pic = () => {
  const image = createImage(2, 1);
  image.data.set([255, 0, 0, 255, 0, 0, 0, 0]); // red, then nothing
  return { image, originXMm: 10, originYMm: 20, mmPerPixel: 1 };
};

describe('pictures in the vector PDF', () => {
  it('converts colour through the same ink conversion as the paths', () => {
    const { cmyk, alpha } = cmykSamples(pic());
    // Pure red is full magenta and yellow, no cyan, no black.
    expect([...cmyk.subarray(0, 4)]).toEqual([0, 255, 255, 0]);
    expect([...alpha]).toEqual([255, 0]);
  });

  it('writes a DeviceCMYK image with its coverage as a soft mask', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([200, 200]);
    drawFanPicture(pdf, page, pic(), { minX: 0, minY: 0, pageH: 200, ptPerMm: 72 / 25.4 });
    const reread = await PDFDocument.load(await pdf.save());

    const xobjects = reread.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
    const [ref] = xobjects.values() as PDFRef[];
    const image = reread.context.lookup(ref!) as PDFRawStream;
    expect(image.dict.get(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceCMYK'));
    expect(image.dict.get(PDFName.of('Width'))?.toString()).toBe('2');

    const samples = inflateSync(image.contents);
    expect([...samples.subarray(0, 4)]).toEqual([0, 255, 255, 0]);

    const mask = reread.context.lookup(image.dict.get(PDFName.of('SMask')) as PDFRef) as PDFRawStream;
    expect(mask.dict.get(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceGray'));
    expect([...inflateSync(mask.contents)]).toEqual([255, 0]);
  });
});
