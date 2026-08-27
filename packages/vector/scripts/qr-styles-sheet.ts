/**
 * Render every QR style to one SVG sheet, from the real builder output.
 *
 * A visual check that complements the decode tests: those prove the codes
 * scan, this shows what they look like.
 */
import { writeFileSync } from 'node:fs';
import { QR_STYLES, buildQrArtwork, normaliseUrl } from '../src/index';

const url = normaliseUrl(process.argv[2] ?? 'cupco.com.au')!;
const out = process.argv[3] ?? 'out/qr-styles.svg';

const CELL = 180, GAP = 26, COLS = 3;
const rows = Math.ceil(QR_STYLES.length / COLS);
const W = COLS * CELL + (COLS + 1) * GAP;
const H = rows * (CELL + 46) + GAP * 2;

const parts: string[] = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
  `<rect width="${W}" height="${H}" fill="#f6f7f9"/>`,
  `<style>text{font-family:ui-sans-serif,system-ui,sans-serif}</style>`,
];

QR_STYLES.forEach((preset, i) => {
  const col = i % COLS, row = Math.floor(i / COLS);
  const x = GAP + col * (CELL + GAP);
  const y = GAP + row * (CELL + 46);

  const { art, moduleCount } = buildQrArtwork(url, { style: preset });
  const d = art.shapes[0]!.subpaths
    .map((sp) => sp.map((p, j) =>
      `${j === 0 ? 'M' : 'L'}${(x + p.x * CELL).toFixed(2)} ${(y + p.y * CELL).toFixed(2)}`).join('') + 'Z')
    .join('');

  parts.push(
    `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="#fff" rx="6"/>`,
    // Nonzero winding: the eyes' light rings are holes, not white paint.
    `<path d="${d}" fill="#0f172a" fill-rule="nonzero"/>`,
    `<text x="${x + CELL / 2}" y="${y + CELL + 18}" text-anchor="middle" font-size="13" font-weight="700" fill="#0f172a">${preset.name}</text>`,
    `<text x="${x + CELL / 2}" y="${y + CELL + 33}" text-anchor="middle" font-size="10.5" fill="#64748b">${moduleCount}×${moduleCount} modules</text>`,
  );
});

parts.push('</svg>');
writeFileSync(out, parts.join('\n'));
console.log(`${out} — ${QR_STYLES.length} styles, encoding ${url}`);
