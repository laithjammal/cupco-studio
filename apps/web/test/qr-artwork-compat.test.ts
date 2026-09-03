import { describe, it, expect } from 'vitest';
import { buildQrArtwork, QR_STYLES, getQrStyle } from '@cupco/qr';
import type { Artwork } from '@cupco/qr';
import { placeArtwork } from '@cupco/vector';
import type { PlacedArtwork } from '@cupco/vector';

/**
 * @cupco/qr declares the artwork shape it emits instead of importing it, so
 * that it stands alone: `npm install` on a copy of that folder pulls
 * qrcode-generator and nothing else.
 *
 * The cost of a second declaration is drift. TypeScript is structurally typed,
 * so the two work together with no adapter today — but nothing stops someone
 * adding a field to one and not the other, and the failure would surface much
 * later as a QR that exports wrongly.
 *
 * So the two are asserted mutually assignable, at COMPILE time. If either
 * shape changes, this file stops typechecking, which is the moment to notice.
 */
type MutuallyAssignable<A extends B, B extends C, C = A> = true;
type _QrFitsVector = MutuallyAssignable<Artwork, PlacedArtwork>;
type _VectorFitsQr = MutuallyAssignable<PlacedArtwork, Artwork>;

describe('the QR package and the vector package agree on artwork', () => {
  /**
   * A type check proves the shapes match. This proves the VALUES do: a real
   * code goes through `placeArtwork`, which is the function every other piece
   * of artwork in the app passes through on its way to the cup.
   */
  it('hands the rest of the app something it can place', () => {
    const { art, moduleCount } = buildQrArtwork('https://cupco.com.au');
    const asPlaced: PlacedArtwork = art;
    expect(asPlaced.aspect).toBe(1);
    expect(asPlaced.shapes.length).toBeGreaterThan(0);

    const widthU = 0.2;
    const placed = placeArtwork(asPlaced, {
      u: 0.5, v: 0.5, widthU, rotation: 0, canvasW: 2000, canvasH: 800,
    });
    const us = placed.flatMap((s) => s.subpaths.flat()).map((p) => p.u);
    expect(us.length).toBeGreaterThan(0);
    expect((Math.min(...us) + Math.max(...us)) / 2).toBeCloseTo(0.5, 4);

    // The DARK modules span the code but not the quiet zone, so the ink is
    // narrower than the box by exactly the 4 modules of margin on each side.
    const inked = widthU * (moduleCount / (moduleCount + 8));
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(inked, 4);
  });

  it('produces every style through the same boundary', () => {
    for (const preset of QR_STYLES) {
      const { art }: { art: Artwork } = buildQrArtwork('https://cupco.com.au', {
        style: getQrStyle(preset.id),
      });
      const asPlaced: PlacedArtwork = art;
      expect(asPlaced.aspect).toBe(1);
      for (const shape of asPlaced.shapes) {
        expect(shape.fill).toHaveLength(3);
        expect(shape.opacity).toBeGreaterThan(0);
      }
    }
  });
});
