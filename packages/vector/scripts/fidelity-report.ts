/**
 * Score the SVG importer against a real renderer, file by file.
 *
 *   npx tsx packages/vector/scripts/fidelity-report.ts [outDir] [filter]
 *
 * Prints how much of each corpus file's artwork differs between the original
 * and what the importer produced, and writes reference | import | difference
 * images to outDir so the failures can be LOOKED at rather than inferred.
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { importSvg } from '../src/index';
import {
  CORPUS_DIR, loadFixture, render, reconstruct, mismatch, sideBySide, testFonts,
} from '../test/fidelity/harness';

const outDir = process.argv[2] ?? '.probe/fidelity';
const filter = process.argv[3] ?? '';
mkdirSync(outDir, { recursive: true });

const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.svg') && f.includes(filter)).sort();
const rows: string[] = [];
let failing = 0;

for (const file of files) {
  const src = loadFixture(file);
  const ref = render(src, 400);
  let line: string;
  try {
    const res = (importSvg as (s: string, o?: unknown) => ReturnType<typeof importSvg>)(src, { fonts: testFonts });
    const ours = render(reconstruct(res as never), 400);
    const { fraction, mask } = mismatch(ref, ours);
    writeFileSync(join(outDir, file.replace('.svg', '.png')), sideBySide(ref, ours, mask));
    const pct = (fraction * 100).toFixed(1).padStart(6);
    if (fraction > 0.01) failing++;
    line = `${fraction > 0.01 ? 'FAIL' : ' ok '} ${pct}%  ${file.padEnd(30)} ${res.shapes.length} shapes`
      + `${(res as { rasters?: unknown[] }).rasters?.length ? ` + ${(res as { rasters: unknown[] }).rasters.length} images` : ''}`
      + `${res.warnings.length ? `  [${res.warnings.join(' | ')}]` : ''}`;
  } catch (e) {
    failing++;
    line = `CRASH         ${file.padEnd(30)} ${(e as Error).message}`;
  }
  rows.push(line);
  console.log(line);
}

console.log(`\n${files.length - failing}/${files.length} within 1%  ->  ${outDir}`);
