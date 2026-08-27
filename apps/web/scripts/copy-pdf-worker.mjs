/**
 * Copy the pdf.js worker into public/.
 *
 * pdf.js runs its parser in a worker, and needs a URL it can fetch at runtime.
 * Bundling it through Next's module graph is fragile across versions; serving
 * the shipped file verbatim is stable and makes the version obvious.
 */
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const src = join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs');
const outDir = join(here, '..', 'public');
const dst = join(outDir, 'pdf.worker.min.mjs');

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
copyFileSync(src, dst);
console.log(`copied pdf.worker.min.mjs -> public/`);
