/**
 * Blank artwork template in DESIGN SPACE.
 *
 * Lives in the geometry package rather than the web app because it derives
 * entirely from a CupProfile and touches no browser API - which also means it
 * can be generated from the command line for handing to a designer.
 */

import { deriveFrustum } from './frustum';
import type { CupProfile } from './types';

/**
 * Blank artwork template in DESIGN SPACE, for laying out full-wrap artwork in
 * Illustrator and uploading back.
 *
 * Design space is a rectangle: the unrolled cup with u across and v up. The
 * width is set to the TOP circumference (the widest point) and the height to
 * the slant length, both in true millimetres.
 *
 * IMPORTANT for whoever uses it: the cup tapers, so a shape keeps its ANGULAR
 * width as it wraps - meaning it renders physically narrower toward the base.
 * The template marks that compression explicitly rather than pretending the
 * rectangle is dimensionally faithful at every height.
 */
export function buildArtworkTemplateSvg(profile: CupProfile): string {
  const geom = deriveFrustum(profile.dimensions);

  const W = geom.topArcMm;        // full circumference at the rim
  const H = geom.slantMm;         // rim to base, along the cup wall
  const safeT = profile.margins.safeTopMm;
  const safeB = profile.margins.safeBottomMm;
  const safeS = profile.margins.safeSeamMm;
  const bottomRatio = geom.bottomArcMm / geom.topArcMm;

  // The cut line, per edge. A blank is not a uniform outset of the cup: the
  // bottom runs past the base by the material the base seam takes, and the
  // two seam edges differ because one laps over the other.
  const { topMm: cutT, bottomMm: cutB, leftMm: cutL, rightMm: cutR } = profile.margins.cut;
  const cutW = W + cutL + cutR;
  const cutH = H + cutT + cutB;

  const pad = 18;
  const totalW = cutW + pad * 2;
  // Extra height below the artwork for the legend panel.
  const legendH = 70;
  const totalH = cutH + pad * 2 + legendH;
  const ox = pad + cutL;
  const oy = pad + cutT;

  const label = (x: number, y: number, text: string, anchor = 'start', size = 3, fill = '#64748b') =>
    `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="monospace" font-size="${size}" fill="${fill}" text-anchor="${anchor}">${text}</text>`;

  const legendPanel = (
    x: number, y: number, w: number, _p: CupProfile,
    st: number, sb: number, ss: number, ratio: number,
  ): string => {
    const rows: [string, string, string, string][] = [
      // swatch style, name, measurement, what it means
      ['stroke="#db2777" stroke-width="0.7" stroke-dasharray="2.2 1.2"',
        'CUT', `${cutT}mm top / ${cutB}mm base / ${cutL}mm left / ${cutR}mm right`,
        'Where the blank is die-cut. Artwork meant to reach an edge must run all the way to this line — cutting is never exact, and stopping at trim leaves a white sliver.'],
      ['stroke="#0f172a" stroke-width="0.9"',
        'TRIM', `${W.toFixed(1)} x ${H.toFixed(1)}mm`,
        'The finished cup wall: what is still showing once the cup is formed. The blank itself is bigger — see CUT.'],
      ['stroke="#0284c7" stroke-width="0.7" stroke-dasharray="1.4 1.4"',
        'SAFE AREA', `${st}mm top / ${sb}mm base / ${ss}mm sides`,
        'Keep logos and text inside this box. Anything outside risks being lost in the rim curl, the base, or the glued seam.'],
      ['stroke="#94a3b8" stroke-width="0.6" stroke-dasharray="1.6 1.6"',
        'CENTRE LINE', 'opposite the seam',
        'The point facing a person holding the cup. Best place for a logo.'],
    ];

    const rowH = 8.2;
    // Header + rows + two footer lines, with clearance so the last row's
    // description cannot collide with the taper note beneath it.
    const boxH = rows.length * rowH + 26;
    let out = `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${boxH.toFixed(2)}" ` +
      `fill="#ffffff" stroke="#cbd5e1" stroke-width="0.3"/>` +
      `<text x="${(x + 4).toFixed(2)}" y="${(y + 6).toFixed(2)}" font-family="monospace" font-size="3.6" font-weight="bold" fill="#0f172a">LEGEND — what each line means</text>`;

    rows.forEach((r, i) => {
      const ry = y + 12 + i * rowH;
      out += `<line x1="${(x + 4).toFixed(2)}" y1="${(ry + 1.6).toFixed(2)}" x2="${(x + 14).toFixed(2)}" y2="${(ry + 1.6).toFixed(2)}" ${r[0]}/>` +
        `<text x="${(x + 17).toFixed(2)}" y="${(ry + 2.6).toFixed(2)}" font-family="monospace" font-size="3.1" font-weight="bold" fill="#0f172a">${r[1]}</text>` +
        `<text x="${(x + 52).toFixed(2)}" y="${(ry + 2.6).toFixed(2)}" font-family="monospace" font-size="2.9" fill="#64748b">${r[2]}</text>` +
        `<text x="${(x + 4).toFixed(2)}" y="${(ry + 6).toFixed(2)}" font-family="monospace" font-size="2.7" fill="#475569">${r[3]}</text>`;
    });

    const footY = y + rows.length * rowH + 16;
    out += `<line x1="${(x + 4).toFixed(2)}" y1="${(footY - 3.5).toFixed(2)}" x2="${(x + w - 4).toFixed(2)}" y2="${(footY - 3.5).toFixed(2)}" stroke="#e2e8f0" stroke-width="0.3"/>` +
      `<text x="${(x + 4).toFixed(2)}" y="${footY.toFixed(2)}" font-family="monospace" font-size="2.9" fill="#b45309">` +
      `TAPER: the cup narrows, so the base is only ${(ratio * 100).toFixed(1)}% of the rim width. Horizontal artwork compresses toward the base; vertical lines converge on the cup.</text>` +
      `<text x="${(x + 4).toFixed(2)}" y="${(footY + 4).toFixed(2)}" font-family="monospace" font-size="2.9" fill="#b45309">` +
      `Delete the GUIDES and LEGEND layers before exporting your artwork.</text>`;
    return out;
  };

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- ===================================================================
     CUPCO ARTWORK TEMPLATE - ${profile.displayName}
     ===================================================================
     Design space (the unrolled cup). 1:1 millimetres.

       Artwork area (trim) : ${W.toFixed(2)} x ${H.toFixed(2)} mm
       Blank (to the cut)  : ${cutW.toFixed(2)} x ${cutH.toFixed(2)} mm
       Cut line            : ${cutT}mm top, ${cutB}mm base, ${cutL}mm left, ${cutR}mm right
       Safe area           : ${safeT}mm top, ${safeB}mm bottom, ${safeS}mm from each seam edge

     HOW TO USE
       1. Place artwork inside the CUT rectangle. Anything meant to reach the
          edge must extend to the cut line, not stop at trim.
       2. Keep logos and text inside the SAFE rectangle.
       3. The LEFT and RIGHT edges are the same place on the cup - the glue
          seam. Artwork must line up across them.
       4. Export as PNG/SVG at this exact aspect ratio and upload.

     THE CUT IS NOT SYMMETRIC
       The blank is bigger than the finished cup, and by different amounts on
       each edge. The base runs ${cutB}mm past the cup because that material is
       consumed forming the base seam.

     THE CUP TAPERS
       This rectangle is the cup wall unrolled by ANGLE, so horizontal
       distance compresses toward the base. Width at the rim is
       ${geom.topArcMm.toFixed(2)}mm but only ${geom.bottomArcMm.toFixed(2)}mm at the base
       (${(bottomRatio * 100).toFixed(1)}%). Vertical lines drawn here converge on the
       finished cup; a circle near the base prints slightly narrowed.
       Delete the GUIDES layer before exporting artwork.

     Geometry: sector ${geom.sectorAngleDeg.toFixed(4)}deg, R_bot ${geom.rBottomMm.toFixed(4)}mm, R_top ${geom.rTopMm.toFixed(4)}mm
     =================================================================== -->
<svg xmlns="http://www.w3.org/2000/svg" width="${totalW.toFixed(3)}mm" height="${totalH.toFixed(3)}mm"
     viewBox="0 0 ${totalW.toFixed(4)} ${totalH.toFixed(4)}">

  <g id="ARTWORK">
    <!-- Put artwork in this layer. Fill the cut rectangle below. -->
    <rect x="${(ox - cutL).toFixed(3)}" y="${(oy - cutT).toFixed(3)}"
          width="${cutW.toFixed(3)}" height="${cutH.toFixed(3)}" fill="#ffffff"/>
  </g>

  <g id="GUIDES" fill="none">
    <rect x="${(ox - cutL).toFixed(3)}" y="${(oy - cutT).toFixed(3)}"
          width="${cutW.toFixed(3)}" height="${cutH.toFixed(3)}"
          stroke="#db2777" stroke-width="0.3" stroke-dasharray="3 1.5"/>
    <rect x="${ox.toFixed(3)}" y="${oy.toFixed(3)}"
          width="${W.toFixed(3)}" height="${H.toFixed(3)}"
          stroke="#0f172a" stroke-width="0.45"/>
    <rect x="${(ox + safeS).toFixed(3)}" y="${(oy + safeT).toFixed(3)}"
          width="${(W - safeS * 2).toFixed(3)}" height="${(H - safeT - safeB).toFixed(3)}"
          stroke="#0284c7" stroke-width="0.3" stroke-dasharray="1.5 1.5"/>

    <!-- Centre line: the point opposite the seam, facing the customer. -->
    <line x1="${(ox + W / 2).toFixed(3)}" y1="${oy.toFixed(3)}"
          x2="${(ox + W / 2).toFixed(3)}" y2="${(oy + H).toFixed(3)}"
          stroke="#94a3b8" stroke-width="0.2" stroke-dasharray="2 2"/>

    ${label(ox, oy - cutT - 4.5, `${profile.displayName}  -  artwork template  -  1:1 mm`, 'start', 4, '#0f172a')}
    ${label(ox, oy - cutT - 1.2, `trim ${W.toFixed(2)} x ${H.toFixed(2)}mm   |   blank to the cut ${cutW.toFixed(2)} x ${cutH.toFixed(2)}mm`)}
    ${label(ox + W / 2, oy + H + cutB + 4.5, 'CENTRE  (faces the customer)', 'middle')}
    ${label(ox + 1, oy + H + cutB + 4.5, 'SEAM', 'start', 3, '#16a34a')}
    ${label(ox + W - 1, oy + H + cutB + 4.5, 'SEAM', 'end', 3, '#16a34a')}
  </g>

  <g id="LEGEND">
    <!-- Delete this layer along with GUIDES before exporting artwork. -->
    ${legendPanel(ox, oy + H + cutB + 10, W, profile, safeT, safeB, safeS, bottomRatio)}
  </g>
</svg>`;
}
