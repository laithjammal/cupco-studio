/**
 * Which modules a QR code CANNOT have drawn over.
 *
 * A decoder does not read a QR uniformly. Some modules carry data and are
 * protected by error correction; others are structure, are not protected at
 * all, and are what let the code be found and its grid established:
 *
 *   finder patterns    the three eyes, plus their light separator
 *   format information the ring of modules around each eye
 *   timing patterns    the alternating row and column that fix the grid pitch
 *   alignment patterns the smaller eyes that correct for perspective
 *   version info       two blocks, on version 7 and up
 *
 * Painting a picture over data modules costs error-correction budget, which is
 * affordable. Painting over these costs the code itself.
 *
 * The alignment-pattern coordinates are the standard table from ISO 18004; the
 * centres are every combination of the listed values, minus the three that
 * would collide with a finder.
 */

const ALIGNMENT_CENTRES: Record<number, readonly number[]> = {
  1: [],
  2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  11: [6, 30, 54], 12: [6, 32, 58], 13: [6, 34, 62],
  14: [6, 26, 46, 66], 15: [6, 26, 48, 70], 16: [6, 26, 50, 74],
  17: [6, 30, 54, 78], 18: [6, 30, 56, 82], 19: [6, 30, 58, 86], 20: [6, 34, 62, 90],
};

/** Version from the module count: n = 4v + 17. */
export function versionOf(moduleCount: number): number {
  return (moduleCount - 17) / 4;
}

/**
 * Is (row, col) a structural module that must be drawn exactly?
 *
 * Conservative on purpose: the 9x9 block at each finder covers the eye, its
 * separator AND the format information in one test, rather than three that
 * could each be off by one.
 */
export function isStructural(row: number, col: number, n: number): boolean {
  // Finder, separator and format info, at three corners.
  if (row <= 8 && col <= 8) return true;
  if (row <= 8 && col >= n - 8) return true;
  if (row >= n - 8 && col <= 8) return true;

  // Timing patterns.
  if (row === 6 || col === 6) return true;

  const v = versionOf(n);

  // Alignment patterns: 5x5, centred on the table's coordinates.
  const centres = ALIGNMENT_CENTRES[v] ?? [];
  for (const r of centres) {
    for (const c of centres) {
      const collidesWithFinder =
        (r <= 8 && c <= 8) || (r <= 8 && c >= n - 9) || (r >= n - 9 && c <= 8);
      if (collidesWithFinder) continue;
      if (Math.abs(row - r) <= 2 && Math.abs(col - c) <= 2) return true;
    }
  }

  // Version information, version 7 and up.
  if (v >= 7) {
    if (row < 6 && col >= n - 11 && col < n - 8) return true;
    if (col < 6 && row >= n - 11 && row < n - 8) return true;
  }

  return false;
}
