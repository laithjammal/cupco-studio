/**
 * SVG document -> filled shapes and positioned images.
 *
 * The implementation lives in ./svg - a small XML reader, a CSS engine, a
 * style model, region booleans, gradients, text and images - and is measured
 * file by file against a real renderer in test/fidelity. This module is the
 * stable entry point the rest of the codebase imports.
 */

export {
  importSvg,
  IMPORTER_VERSION,
  parseCssColour,
  type FillRule,
  type ImportedShape,
  type ImportedRaster,
  type SvgImportResult,
  type SvgImportOptions,
  type FontResolver,
  type FontUse,
  type OutlineFont,
  type OutlineGlyph,
  type FontMatch,
} from './svg/import';
export { gposKerning, type KernFn } from './svg/kerning';
