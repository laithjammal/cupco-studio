/**
 * Seasonal concepts — one per campaign in Cupco's calendar.
 *
 * These differ from the layout strategies next door in kind, not degree. Those
 * ask "how should a mark meet a cup"; these ask "what is a café selling this
 * month", and answer with a scene: a ground colour, a drift of snow, a scatter
 * of motifs, a line of type, and a clear place for the customer's logo.
 *
 * THE LOGO IS THE SUBJECT, NOT AN INGREDIENT. Every scene here is built around
 * a reserved band the mark sits in, and the motifs are placed to frame it
 * rather than to fill the cup. A seasonal cup that buries a café's logo in
 * snowflakes is worse than no seasonal cup.
 *
 * Motifs are NAMED, not drawn here. The layout stays plain data and the
 * adapter builds the vector, which is what lets the same scene be rendered to
 * a thumbnail, a 3D preview and a production fan from one description.
 *
 * Colour comes from the season, not from the artwork - a Halloween cup is
 * orange and near-black whatever the café's logo happens to be - but the
 * ACCENT is drawn from the uploaded palette wherever a season can carry it,
 * so the cup still looks like it belongs to that café.
 */

import { isDark, toHex } from './contrast';
import {
  safeBounds, type ConceptInput, type ConceptLayout, type ConceptStrategy, type Placement,
} from './types';
import { motifAspect, type MotifId, type RGB } from '@cupco/vector';

/** A season's palette. Four roles, matching what a motif asks for. */
interface Scene {
  ground: string;
  primary: string;
  ink: string;
  accent: string;
  secondary: string;
  /** Type colour, when it differs from `ink`. */
  type?: string;
}

/** One scattered motif: which, how big, and roughly where. */
interface Scatter {
  motif: MotifId;
  /** Width as a fraction of the circumference. */
  widthU: number;
  /** Positions in design space. */
  at: [u: number, v: number][];
  rotation?: number;
  opacity?: number;
  /**
   * Sit the motif ON the ground line rather than at the v given.
   *
   * A snowman floating above the snow is the single thing that stops a scene
   * reading as a scene, and the offset that fixes it depends on the motif's
   * own aspect - so it is computed, not guessed per placement.
   */
  ground?: boolean;
  /** Override the scene's roles for this motif. */
  colors?: Partial<Scene>;
}

interface SeasonSpec {
  id: string;
  label: string;
  month: string;
  description: string;
  scene: Scene;
  headline: string;
  /** Where the logo sits, as a v centre. */
  logoV: number;
  /** Target logo height, in v units. */
  logoHeightV: number;
  /**
   * The ground the scene stands on.
   *
   * `soft` lays the drift motif over the band, so the snow line is a set of
   * mounds rather than a ruled edge. Seasons with a hard horizon (a table, a
   * shelf) leave it off.
   */
  drift?: { color: string; heightV: number; v: number; soft?: boolean };
  scatter: Scatter[];
  /** Small line under the headline, if any. */
  subhead?: string;
}

/* -------------------------------------------------------------------------- */

const SEASONS: SeasonSpec[] = [
  {
    id: 'season-january', label: 'January — New Year', month: 'JANUARY',
    description: 'Fresh start. Confetti and sparkles over deep ink, with the mark centre stage.',
    scene: { ground: '#101828', primary: '#f4d58d', ink: '#ffffff', accent: '#e8705a', secondary: '#7bb0d6', type: '#ffffff' },
    headline: 'HELLO 2027', subhead: 'a fresh start',
    logoV: 0.52, logoHeightV: 0.3,
    scatter: [
      { motif: 'star', widthU: 0.09, at: [[0.13, 0.8], [0.87, 0.78]], colors: { primary: '#f4d58d' } },
      { motif: 'sparkle', widthU: 0.07, at: [[0.3, 0.88], [0.7, 0.9], [0.06, 0.55], [0.94, 0.52]] },
      { motif: 'confetti', widthU: 0.075, rotation: 24, at: [[0.2, 0.68], [0.8, 0.66], [0.44, 0.92]], colors: { primary: '#e8705a' } },
      { motif: 'confetti', widthU: 0.075, rotation: -38, at: [[0.1, 0.32], [0.9, 0.3], [0.58, 0.92]], colors: { primary: '#7bb0d6' } },
      { motif: 'sparkle', widthU: 0.05, at: [[0.26, 0.2], [0.74, 0.2]], colors: { primary: '#f4d58d' } },
    ],
  },
  {
    id: 'season-february', label: 'February — Valentine’s Day', month: 'FEBRUARY',
    description: 'Made with love. A blush ground, a fall of hearts and a clear band for the mark.',
    scene: { ground: '#fbe7ea', primary: '#d1495b', ink: '#8c2f39', accent: '#f2a1ad', secondary: '#ffffff', type: '#8c2f39' },
    headline: 'MADE WITH LOVE',
    logoV: 0.5, logoHeightV: 0.28,
    scatter: [
      { motif: 'heart', widthU: 0.13, at: [[0.11, 0.74], [0.89, 0.7]] },
      { motif: 'heart', widthU: 0.085, at: [[0.29, 0.87], [0.71, 0.89]], colors: { primary: '#f2a1ad' } },
      { motif: 'heart', widthU: 0.07, at: [[0.05, 0.4], [0.95, 0.36]], colors: { primary: '#f2a1ad' } },
      { motif: 'heart', widthU: 0.055, at: [[0.2, 0.19], [0.5, 0.13], [0.8, 0.2]] },
    ],
  },
  {
    id: 'season-march', label: 'March — Autumn', month: 'MARCH',
    description: 'Autumn colours. Leaves falling to a warm ground band, cosy under the mark.',
    scene: { ground: '#e8d3b0', primary: '#c1622d', ink: '#5c3317', accent: '#9c4a1a', secondary: '#8a6a3c', type: '#5c3317' },
    headline: 'COSY SEASON',
    logoV: 0.56, logoHeightV: 0.28,
    drift: { color: '#9c4a1a', heightV: 0.2, v: 0.1 },
    scatter: [
      { motif: 'leaf', widthU: 0.1, rotation: 18, at: [[0.1, 0.8]] },
      { motif: 'leaf', widthU: 0.085, rotation: -35, at: [[0.62, 0.88], [0.9, 0.76]], colors: { primary: '#9c4a1a' } },
      { motif: 'leaf', widthU: 0.075, rotation: 62, at: [[0.3, 0.9], [0.05, 0.5]], colors: { primary: '#8a6a3c' } },
      { motif: 'leaf', widthU: 0.06, rotation: -14, at: [[0.95, 0.44], [0.22, 0.33]] },
      { motif: 'cup', widthU: 0.075, ground: true, at: [[0.82, 0]], colors: { primary: '#5c3317', ink: '#3a1f0d', accent: '#e8d3b0' } },
    ],
  },
  {
    id: 'season-april-easter', label: 'April — Easter', month: 'APRIL',
    description: 'A bunny and painted eggs along a spring meadow, with the mark held clear above.',
    scene: { ground: '#fdf3e3', primary: '#8ecae6', ink: '#4a4e69', accent: '#f4978e', secondary: '#b5e48c', type: '#4a4e69' },
    headline: 'HAPPY EASTER',
    logoV: 0.58, logoHeightV: 0.26,
    drift: { color: '#b5e48c', heightV: 0.2, v: 0.1, soft: true },
    scatter: [
      { motif: 'bunny', widthU: 0.11, ground: true, at: [[0.15, 0]], colors: { primary: '#ffffff', accent: '#f4978e', ink: '#4a4e69' } },
      { motif: 'egg', widthU: 0.075, ground: true, at: [[0.33, 0]], colors: { primary: '#8ecae6', accent: '#f4978e', secondary: '#ffffff' } },
      { motif: 'egg', widthU: 0.07, rotation: 14, ground: true, at: [[0.84, 0]], colors: { primary: '#f4978e', accent: '#ffffff', secondary: '#8ecae6' } },
      { motif: 'egg', widthU: 0.065, rotation: -12, ground: true, at: [[0.68, 0]], colors: { primary: '#ffd166', accent: '#4a4e69', secondary: '#ffffff' } },
      { motif: 'flower', widthU: 0.05, ground: true, at: [[0.5, 0]], colors: { primary: '#f4978e', accent: '#ffd166' } },
      { motif: 'sparkle', widthU: 0.055, at: [[0.1, 0.84], [0.5, 0.92], [0.9, 0.82]], colors: { primary: '#f4978e' } },
    ],
  },
  {
    id: 'season-april-anzac', label: 'April — ANZAC Day', month: 'APRIL',
    description: 'A single poppy, held on a quiet ground. Restrained on purpose — remembrance, not a promotion.',
    scene: { ground: '#f2efe9', primary: '#a4161a', ink: '#1b1b1b', accent: '#6a040f', secondary: '#4f5d2f', type: '#1b1b1b' },
    headline: 'LEST WE FORGET',
    logoV: 0.58, logoHeightV: 0.24,
    scatter: [
      { motif: 'poppy', widthU: 0.15, at: [[0.5, 0.2]], colors: { primary: '#a4161a', ink: '#1b1b1b', secondary: '#6a040f' } },
      { motif: 'poppy', widthU: 0.075, at: [[0.24, 0.15], [0.76, 0.15]], colors: { primary: '#6a040f', ink: '#1b1b1b', secondary: '#a4161a' } },
    ],
  },
  {
    id: 'season-may', label: 'May — Mother’s Day', month: 'MAY',
    description: 'A spray of blooms framing the mark, soft blush and gold.',
    scene: { ground: '#fdf0f3', primary: '#e07a9c', ink: '#6d435a', accent: '#f6c667', secondary: '#8fbf9f', type: '#6d435a' },
    headline: 'FOR MUM',
    logoV: 0.54, logoHeightV: 0.27,
    scatter: [
      { motif: 'flower', widthU: 0.12, at: [[0.1, 0.72], [0.9, 0.68]] },
      { motif: 'flower', widthU: 0.08, at: [[0.26, 0.87], [0.75, 0.89]], colors: { primary: '#f6c667', accent: '#e07a9c' } },
      { motif: 'leaf', widthU: 0.075, rotation: -40, at: [[0.2, 0.55]], colors: { primary: '#8fbf9f', secondary: '#6d435a' } },
      { motif: 'leaf', widthU: 0.075, rotation: 40, at: [[0.81, 0.52]], colors: { primary: '#8fbf9f', secondary: '#6d435a' } },
      { motif: 'flower', widthU: 0.065, at: [[0.32, 0.17], [0.68, 0.17]], colors: { primary: '#e07a9c', accent: '#fdf0f3' } },
      { motif: 'flower', widthU: 0.05, at: [[0.5, 0.13]], colors: { primary: '#f6c667', accent: '#e07a9c' } },
    ],
  },
  {
    id: 'season-june', label: 'June — Winter', month: 'JUNE',
    description: 'A snowy scene: snowman and pines on a drift, flakes falling past the mark.',
    scene: { ground: '#1d3557', primary: '#ffffff', ink: '#1d3557', accent: '#e63946', secondary: '#a8dadc', type: '#ffffff' },
    headline: 'WINTER WARMERS',
    logoV: 0.62, logoHeightV: 0.28,
    drift: { color: '#ffffff', heightV: 0.19, v: 0.095, soft: true },
    scatter: [
      { motif: 'snowman', widthU: 0.1, ground: true, at: [[0.19, 0]], colors: { primary: '#ffffff', ink: '#1d3557', accent: '#e63946', secondary: '#f4a261' } },
      { motif: 'tree', widthU: 0.085, ground: true, at: [[0.78, 0]], colors: { primary: '#2a6f5b', ink: '#14342b', accent: '#a8dadc' } },
      { motif: 'tree', widthU: 0.062, ground: true, at: [[0.88, 0]], colors: { primary: '#457b9d', ink: '#14342b', accent: '#a8dadc' } },
      { motif: 'snowflake', widthU: 0.075, at: [[0.1, 0.84], [0.45, 0.9], [0.72, 0.85]] },
      { motif: 'snowflake', widthU: 0.05, at: [[0.28, 0.74], [0.6, 0.77], [0.9, 0.8], [0.05, 0.55], [0.95, 0.5]], colors: { primary: '#a8dadc' } },
    ],
  },
  {
    id: 'season-july', label: 'July — Christmas in July', month: 'JULY',
    description: 'Festive winter on deep pine: trees on snow, baubles hanging past the mark.',
    scene: { ground: '#14342b', primary: '#ffffff', ink: '#0b241d', accent: '#d62828', secondary: '#e9c46a', type: '#ffffff' },
    headline: 'CHRISTMAS IN JULY',
    logoV: 0.6, logoHeightV: 0.27,
    drift: { color: '#ffffff', heightV: 0.18, v: 0.09, soft: true },
    scatter: [
      { motif: 'tree', widthU: 0.11, ground: true, at: [[0.14, 0]], colors: { primary: '#2a6f5b', ink: '#0b241d', accent: '#e9c46a' } },
      { motif: 'tree', widthU: 0.08, ground: true, at: [[0.86, 0]], colors: { primary: '#2a6f5b', ink: '#0b241d', accent: '#e9c46a' } },
      { motif: 'bauble', widthU: 0.08, at: [[0.33, 0.87]], colors: { primary: '#d62828', ink: '#e9c46a', accent: '#ffffff' } },
      { motif: 'bauble', widthU: 0.065, at: [[0.68, 0.9]], colors: { primary: '#e9c46a', ink: '#d62828', accent: '#ffffff' } },
      { motif: 'snowflake', widthU: 0.06, at: [[0.08, 0.78], [0.5, 0.74], [0.92, 0.8]] },
      { motif: 'snowflake', widthU: 0.042, at: [[0.24, 0.6], [0.78, 0.58]], colors: { primary: '#a8dadc' } },
    ],
  },
  {
    id: 'season-august', label: 'August — Café Month', month: 'AUGUST',
    description: 'Coffee culture on warm kraft: beans scattered, a cup steaming beside the mark.',
    scene: { ground: '#c9a227', primary: '#3d2b1f', ink: '#2a1d14', accent: '#f5e6c8', secondary: '#7f5539', type: '#2a1d14' },
    headline: 'LOVE YOUR LOCAL', subhead: 'café month',
    logoV: 0.55, logoHeightV: 0.3,
    drift: { color: '#7f5539', heightV: 0.16, v: 0.08 },
    scatter: [
      { motif: 'cup', widthU: 0.085, ground: true, at: [[0.15, 0]], colors: { primary: '#f5e6c8', ink: '#3d2b1f', accent: '#c9a227' } },
      { motif: 'cup', widthU: 0.07, ground: true, at: [[0.85, 0]], colors: { primary: '#f5e6c8', ink: '#3d2b1f', accent: '#c9a227' } },
      { motif: 'bean', widthU: 0.06, rotation: 22, at: [[0.1, 0.78], [0.32, 0.88], [0.7, 0.87], [0.9, 0.76]] },
      { motif: 'bean', widthU: 0.05, rotation: -30, at: [[0.06, 0.42], [0.94, 0.4], [0.42, 0.92]] },
      { motif: 'steam', widthU: 0.05, at: [[0.5, 0.86]], colors: { primary: '#f5e6c8' } },
    ],
  },
  {
    id: 'season-september', label: 'September — Father’s Day', month: 'SEPTEMBER',
    description: 'Bold and graphic: a heavy base block, a moustache and medals. Confident, not cute.',
    scene: { ground: '#22333b', primary: '#eae0d5', ink: '#0a0908', accent: '#c6ac8f', secondary: '#5e503f', type: '#eae0d5' },
    headline: 'DAD FUEL',
    logoV: 0.6, logoHeightV: 0.29,
    drift: { color: '#c6ac8f', heightV: 0.2, v: 0.1 },
    scatter: [
      { motif: 'moustache', widthU: 0.15, at: [[0.5, 0.1]], colors: { primary: '#22333b' } },
      { motif: 'medal', widthU: 0.075, at: [[0.13, 0.78], [0.87, 0.78]], colors: { primary: '#c6ac8f', ink: '#22333b', accent: '#eae0d5' } },
      { motif: 'star', widthU: 0.055, at: [[0.3, 0.88], [0.7, 0.88]], colors: { primary: '#c6ac8f' } },
      { motif: 'bean', widthU: 0.045, rotation: 20, at: [[0.06, 0.45], [0.94, 0.43]], colors: { primary: '#5e503f' } },
    ],
  },
  {
    id: 'season-october', label: 'October — Halloween', month: 'OCTOBER',
    description: 'Spooky coffee: pumpkins on the ground, a ghost and bats drifting past the mark.',
    scene: { ground: '#1b1b1e', primary: '#f4791f', ink: '#0d0d0f', accent: '#8ecbf0', secondary: '#efefef', type: '#f4791f' },
    headline: 'SPOOKY BREW',
    logoV: 0.6, logoHeightV: 0.27,
    drift: { color: '#2b2b30', heightV: 0.18, v: 0.09, soft: true },
    scatter: [
      { motif: 'pumpkin', widthU: 0.11, ground: true, at: [[0.16, 0]], colors: { primary: '#f4791f', ink: '#3d2b1f', secondary: '#c25e12' } },
      { motif: 'pumpkin', widthU: 0.075, ground: true, at: [[0.3, 0]], colors: { primary: '#c25e12', ink: '#3d2b1f', secondary: '#8c4310' } },
      { motif: 'ghost', widthU: 0.095, at: [[0.83, 0.26]], colors: { primary: '#efefef', ink: '#1b1b1e' } },
      { motif: 'bat', widthU: 0.085, at: [[0.12, 0.84], [0.38, 0.9]], colors: { primary: '#efefef' } },
      { motif: 'bat', widthU: 0.06, at: [[0.64, 0.86], [0.9, 0.79]], colors: { primary: '#efefef' } },
    ],
  },
  {
    id: 'season-november', label: 'November — Spring', month: 'NOVEMBER',
    description: 'Bright and fresh: a meadow of blooms, sun above, the mark held in clear air.',
    scene: { ground: '#eaf4e2', primary: '#f28482', ink: '#3a5a40', accent: '#f6bd60', secondary: '#84a98c', type: '#3a5a40' },
    headline: 'IN FULL BLOOM',
    logoV: 0.58, logoHeightV: 0.27,
    drift: { color: '#84a98c', heightV: 0.17, v: 0.085, soft: true },
    scatter: [
      { motif: 'sun', widthU: 0.1, at: [[0.87, 0.86]], colors: { primary: '#f6bd60' } },
      { motif: 'flower', widthU: 0.095, ground: true, at: [[0.14, 0]] },
      { motif: 'flower', widthU: 0.075, ground: true, at: [[0.36, 0]], colors: { primary: '#f6bd60', accent: '#f28482' } },
      { motif: 'flower', widthU: 0.08, ground: true, at: [[0.62, 0]] },
      { motif: 'flower', widthU: 0.06, ground: true, at: [[0.82, 0]], colors: { primary: '#f6bd60', accent: '#f28482' } },
      { motif: 'leaf', widthU: 0.055, rotation: -30, ground: true, at: [[0.26, 0], [0.73, 0]], colors: { primary: '#3a5a40', secondary: '#84a98c' } },
      { motif: 'sparkle', widthU: 0.05, at: [[0.1, 0.72], [0.34, 0.84]], colors: { primary: '#f6bd60' } },
    ],
  },
  {
    id: 'season-december', label: 'December — Christmas', month: 'DECEMBER',
    description: 'Full festive: gifts and holly on a pine band, a star above the mark.',
    scene: { ground: '#8c1c13', primary: '#ffffff', ink: '#5c120c', accent: '#e9c46a', secondary: '#2a6f5b', type: '#ffffff' },
    headline: 'MERRY CHRISTMAS',
    logoV: 0.6, logoHeightV: 0.27,
    drift: { color: '#2a6f5b', heightV: 0.18, v: 0.09 },
    scatter: [
      { motif: 'gift', widthU: 0.095, ground: true, at: [[0.15, 0]], colors: { primary: '#e9c46a', accent: '#8c1c13' } },
      { motif: 'gift', widthU: 0.075, ground: true, at: [[0.3, 0]], colors: { primary: '#ffffff', accent: '#2a6f5b' } },
      { motif: 'holly', widthU: 0.12, ground: true, at: [[0.82, 0]], colors: { primary: '#1f5c4a', accent: '#e63946' } },
      { motif: 'star', widthU: 0.08, at: [[0.5, 0.9]], colors: { primary: '#e9c46a' } },
      { motif: 'snowflake', widthU: 0.055, at: [[0.12, 0.8], [0.35, 0.88], [0.68, 0.86], [0.9, 0.76]] },
    ],
  },
];

/* -------------------------------------------------------------------------- */

/**
 * Height in v that one unit of widthU produces, for the uploaded artwork.
 *
 * Mirrors halfExtent() in the design model. Design space is angular and the
 * canvas is far wider than it is tall, so sizing a logo by width alone lets a
 * tall mark run straight off the rim.
 */
function heightPerWidth(input: ConceptInput): number {
  const { widthPx, heightPx } = input.profile.designCanvas;
  return input.artworkAspect * (widthPx / heightPx);
}

/** Same, for a motif of a known aspect. */
function motifHeightV(id: MotifId, widthU: number, input: ConceptInput): number {
  const { widthPx, heightPx } = input.profile.designCanvas;
  return widthU * motifAspect(id) * (widthPx / heightPx);
}

const hex = (rgb: RGB) => toHex(rgb);

/**
 * Turn one season into a layout.
 *
 * Order matters and is deliberate: ground, then the drift, then motifs, then
 * type, and the logo LAST so nothing can ever land on top of it. That ordering
 * is the difference between a seasonal cup and a café's logo lost in snow.
 */
function layoutFor(spec: SeasonSpec, input: ConceptInput): ConceptLayout {
  const safe = safeBounds(input.profile, input.geom);
  const placements: Placement[] = [];
  const scene = spec.scene;

  const colorsFor = (over?: Partial<Scene>) => ({
    primary: over?.primary ?? scene.primary,
    ink: over?.ink ?? scene.ink,
    accent: over?.accent ?? scene.accent,
    secondary: over?.secondary ?? scene.secondary,
  });

  // The ground band, where the season has one. Bleeds off the base on purpose.
  let groundTop = safe.vBottom;
  if (spec.drift) {
    placements.push({
      kind: 'band', u: 0.5, v: spec.drift.v, rotation: 0,
      heightV: spec.drift.heightV, color: spec.drift.color,
    });
    groundTop = spec.drift.v + spec.drift.heightV / 2;

    // A soft snow line: mounds laid over the band's ruled top edge. Drawn
    // slightly wider than the cup so it wraps without a visible join.
    if (spec.drift.soft) {
      const w = 1.1;
      placements.push({
        kind: 'motif', motif: 'drift', motifColors: colorsFor({ primary: spec.drift.color }),
        u: 0.5, v: groundTop - motifHeightV('drift', w, input) * 0.24,
        rotation: 0, widthU: w,
      });
      groundTop += motifHeightV('drift', w, input) * 0.16;
    }
  }

  // Motifs. Anything marked `ground` is seated ON the ground line rather than
  // centred on the v it was given - a snowman floating above the snow is the
  // one thing that stops a scene reading as a scene. Everything is clamped so
  // nothing drifts past the safe line and gets cropped.
  for (const s of spec.scatter) {
    const halfV = motifHeightV(s.motif, s.widthU, input) / 2;
    for (const [u, v] of s.at) {
      const wanted = s.ground ? groundTop + halfV * 0.86 : v;
      placements.push({
        kind: 'motif',
        motif: s.motif,
        motifColors: colorsFor(s.colors),
        u,
        v: Math.min(safe.vTop - halfV, Math.max(safe.vBottom + halfV, wanted)),
        rotation: s.rotation ?? 0,
        widthU: s.widthU,
        opacity: s.opacity ?? 1,
      });
    }
  }

  // Type: the campaign line above the mark, and a small note below it.
  const typeColor = scene.type ?? scene.ink;
  placements.push({
    kind: 'text', text: spec.headline, u: 0.5,
    v: Math.min(safe.vTop - 0.05, spec.logoV + spec.logoHeightV / 2 + 0.09),
    rotation: 0, sizeV: 0.062, color: typeColor, tracking: 0.16, weight: 700,
  });
  if (spec.subhead) {
    placements.push({
      kind: 'text', text: spec.subhead, u: 0.5,
      v: Math.max(safe.vBottom + 0.05, spec.logoV - spec.logoHeightV / 2 - 0.07),
      rotation: 0, sizeV: 0.036, color: typeColor, tracking: 0.28, weight: 400,
    });
  }

  // The logo LAST, so it sits above the scene rather than under it.
  const widthU = Math.max(0.05, Math.min(0.9, spec.logoHeightV / Math.max(0.01, heightPerWidth(input))));
  placements.push({
    kind: 'artwork', u: 0.5, v: spec.logoV, rotation: 0, widthU,
    // A seasonal ground is a flat colour, so a logo carrying its own white
    // plate would sit in a visible box. Strip it, and push the mark to whichever
    // tone reads against this season's ground.
    treatment: { dropPlate: true, tone: isDark(hexToRgbLocal(scene.ground)) ? 'lighten' : 'darken' },
  });

  return {
    id: spec.id,
    label: spec.label,
    description: spec.description,
    background: scene.ground,
    placements,
  };
}

/** Local hex -> rgb, so this file does not depend on the app's parser. */
function hexToRgbLocal(h: string): RGB {
  const s = h.replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Every seasonal concept, in calendar order. */
export const SEASONAL_STRATEGIES: ConceptStrategy[] = SEASONS.map((spec) => ({
  id: spec.id,
  label: spec.label,
  generate: (input) => layoutFor(spec, input),
}));

/** The campaign calendar, for a UI that wants to group or filter by month. */
export const SEASONAL_CAMPAIGNS = SEASONS.map((s) => ({
  id: s.id, label: s.label, month: s.month, description: s.description,
}));
