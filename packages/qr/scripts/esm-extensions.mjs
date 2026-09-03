/**
 * Add `.js` to relative imports in the built output.
 *
 * Node's ESM loader requires a real file extension; TypeScript emits whatever
 * the source wrote. The source cannot simply write `./artwork.js`, because
 * inside Cupco Studio these files are consumed by webpack, which resolves the
 * extension-less form and NOT the `.js` one — the two toolchains want opposite
 * things from the same line.
 *
 * So the source stays extension-less for the app, and the extensions are added
 * to `dist/` on the way out, where only Node and other bundlers ever look.
 * Declaration files get the same treatment so editors follow the types.
 *
 *   node scripts/esm-extensions.mjs
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';

/** `from './x'` / `import('./x')` -> `from './x.js'`, leaving anything already extended alone. */
function addExtensions(code) {
  return code.replace(
    /(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.\.?\/[^'"]*)\2/g,
    (whole, lead, quote, spec) => (
      /\.(js|mjs|cjs|json|css)$/.test(spec) ? whole : `${lead}${quote}${spec}.js${quote}`
    ),
  );
}

function walk(dir) {
  let changed = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { changed += walk(path); continue; }
    if (!/\.(js|d\.ts)$/.test(name)) continue;
    const before = readFileSync(path, 'utf8');
    const after = addExtensions(before);
    if (after !== before) { writeFileSync(path, after); changed += 1; }
  }
  return changed;
}

console.log(`esm-extensions: rewrote ${walk(DIST)} file(s) in ${DIST}/`);
