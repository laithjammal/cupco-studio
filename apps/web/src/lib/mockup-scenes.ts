'use client';

/**
 * The five settings a cup is shown in.
 *
 * These are DRAWN, not photographed - crafted surfaces, light and shadow. They
 * are meant to read as a clean brand presentation, not to pass as photographs,
 * and they are deliberately restrained for that reason: a few well-judged
 * gradients hold up, while attempted detail in flat canvas work does not.
 *
 * What matters more than the scenery is that the CUP is honest. It is drawn
 * from the real profile at real proportions, with the artwork mapped through
 * the geometry engine - so a customer approving one of these is approving what
 * the press will produce.
 */

import type { CupImage } from './cup-render';

export interface MockupScene {
  id: string;
  name: string;
  description: string;
  /** Width / height of the finished image. */
  aspect: number;
  /** How much of the frame height the cup occupies. */
  cupScale: number;
  /** Which way the cup is turned, so a set of five is not five identical cups. */
  centreU: number;
  tiltRad: number;
  /** Scene light, applied to the cup so it belongs in its setting. */
  exposure: number;
  lightFrom: number;
  /**
   * `cup(centreU?)` renders the cup turned to face a given part of the design.
   * Scenes that show more than one cup ask for more than one angle, so a pair
   * shows the front AND the reverse rather than the same face twice.
   */
  paint: (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    cup: (centreU?: number) => CupImage,
  ) => void;
}

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

/** Place the cup so its base sits at (cx, groundY). */
function placeCup(
  ctx: CanvasRenderingContext2D,
  cup: CupImage,
  cx: number,
  groundY: number,
  scale: number,
): { left: number; top: number; w: number; h: number } {
  const w = cup.widthPx * scale;
  const h = cup.heightPx * scale;
  const left = cx - (cup.baseCentre.x * scale);
  const top = groundY - (cup.baseCentre.y * scale);
  ctx.drawImage(cup.canvas, left, top, w, h);
  return { left, top, w, h };
}

/**
 * The contact shadow.
 *
 * Drawn as a squashed ellipse that is darkest and tightest directly under the
 * cup and fades outwards, because that is how an occluded surface behaves: the
 * closer two surfaces are, the less light reaches between them.
 */
function groundShadow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  strength: number,
  skew = 0,
): void {
  ctx.save();
  ctx.translate(cx + skew, cy);
  ctx.scale(1, 0.24);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(28,26,24,${0.42 * strength})`);
  g.addColorStop(0.55, `rgba(28,26,24,${0.18 * strength})`);
  g.addColorStop(1, 'rgba(28,26,24,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A soft out-of-focus highlight, for backgrounds that suggest a room. */
function bokeh(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, r: number, colour: string, alpha: number,
): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, colour.replace('ALPHA', String(alpha)));
  g.addColorStop(0.7, colour.replace('ALPHA', String(alpha * 0.5)));
  g.addColorStop(1, colour.replace('ALPHA', '0'));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function verticalFill(
  ctx: CanvasRenderingContext2D,
  w: number, h: number, stops: [number, string][],
): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  for (const [at, c] of stops) g.addColorStop(at, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/* -------------------------------------------------------------------------- */
/* Scenes                                                                      */
/* -------------------------------------------------------------------------- */

const studio: MockupScene = {
  id: 'studio',
  name: 'Studio',
  description: 'Clean seamless ground. The one to lead a proposal with.',
  aspect: 4 / 5,
  cupScale: 0.62,
  centreU: 0.5,
  tiltRad: 0.16,
  exposure: 1.04,
  lightFrom: -0.45,
  paint: (ctx, w, h, getCup) => {
    const cup = getCup();
    verticalFill(ctx, w, h, [
      [0, '#f4f6f8'], [0.55, '#e7ebf0'], [1, '#d3dae2'],
    ]);
    // A pool of light behind the subject, as a softbox would leave.
    bokeh(ctx, w * 0.5, h * 0.34, w * 0.55, 'rgba(255,255,255,ALPHA)', 0.75);

    const groundY = h * 0.86;
    groundShadow(ctx, w * 0.5, groundY, w * 0.3, 1);
    placeCup(ctx, cup, w * 0.5, groundY, (h * 0.62) / cup.heightPx);
  },
};

const table: MockupScene = {
  id: 'table',
  name: 'On a table',
  description: 'Warm timber, window light from the left.',
  aspect: 4 / 5,
  cupScale: 0.56,
  centreU: 0.42,
  tiltRad: 0.24,
  exposure: 1.02,
  lightFrom: -0.6,
  paint: (ctx, w, h, getCup) => {
    const cup = getCup();
    const horizon = h * 0.42;
    // Room behind, thrown out of focus.
    verticalFill(ctx, w, horizon, [[0, '#d8cec0'], [1, '#b9ab99']]);
    bokeh(ctx, w * 0.18, horizon * 0.45, w * 0.3, 'rgba(255,246,228,ALPHA)', 0.55);
    bokeh(ctx, w * 0.78, horizon * 0.3, w * 0.22, 'rgba(255,240,214,ALPHA)', 0.35);

    // Timber, lit from the left.
    const wood = ctx.createLinearGradient(0, horizon, w, h);
    wood.addColorStop(0, '#b98b5e');
    wood.addColorStop(0.5, '#a57748');
    wood.addColorStop(1, '#8a6038');
    ctx.fillStyle = wood;
    ctx.fillRect(0, horizon, w, h - horizon);

    // Grain: long, low-contrast, converging slightly towards the horizon.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, horizon, w, h - horizon);
    ctx.clip();
    for (let i = 0; i < 26; i++) {
      const t = i / 26;
      const y = horizon + (h - horizon) * t * t;
      ctx.strokeStyle = `rgba(60,38,18,${0.05 + 0.05 * ((i * 7) % 3)})`;
      ctx.lineWidth = 1 + t * 2.5;
      ctx.beginPath();
      ctx.moveTo(-w * 0.1, y);
      ctx.bezierCurveTo(w * 0.3, y - 4 - t * 6, w * 0.7, y + 3 + t * 5, w * 1.1, y);
      ctx.stroke();
    }
    ctx.restore();

    // Light spilling across the table from the window.
    const spill = ctx.createLinearGradient(0, horizon, w * 0.9, h);
    spill.addColorStop(0, 'rgba(255,238,205,0.45)');
    spill.addColorStop(1, 'rgba(255,238,205,0)');
    ctx.fillStyle = spill;
    ctx.fillRect(0, horizon, w, h - horizon);

    const groundY = h * 0.84;
    groundShadow(ctx, w * 0.5, groundY, w * 0.34, 1.1, w * 0.06);
    placeCup(ctx, cup, w * 0.5, groundY, (h * 0.56) / cup.heightPx);
  },
};

/**
 * To go: the cup lidded, as it actually leaves the counter.
 *
 * THIS REPLACED A HAND. Three attempts at drawing one - fingers across the
 * face, fingers curling from the side, thumb-forward with fingertips past the
 * far edge - and all three looked cheap. Hands are unforgiving: everyone knows
 * exactly what one looks like, so "nearly" reads as wrong, and a mockup that
 * looks wrong is worse than one fewer mockup.
 *
 * A lid earns its place instead. It is honest about the product, it is what a
 * takeaway cup is actually sold as, and it is ellipses - which canvas draws
 * beautifully. If a photographic hand is wanted, the cup renders to a
 * transparent PNG and would composite straight into a photograph.
 */
const togo: MockupScene = {
  id: 'togo',
  name: 'To go',
  description: 'Lidded, as it leaves the counter.',
  aspect: 4 / 5,
  cupScale: 0.56,
  centreU: 0.5,
  tiltRad: 0.2,
  exposure: 1.02,
  lightFrom: -0.5,
  paint: (ctx, w, h, getCup) => {
    const cup = getCup();
    verticalFill(ctx, w, h, [[0, '#efe7db'], [0.5, '#e2d6c4'], [1, '#c8b8a1']]);
    bokeh(ctx, w * 0.5, h * 0.3, w * 0.5, 'rgba(255,250,240,ALPHA)', 0.7);

    const groundY = h * 0.85;
    const scale = (h * 0.56) / cup.heightPx;
    groundShadow(ctx, w * 0.5, groundY, w * 0.3, 1, w * 0.05);
    const box = placeCup(ctx, cup, w * 0.5, groundY, scale);

    // The lid seats on the rim, so it is placed from the cup's own geometry
    // rather than guessed at.
    const rx = cup.rimCentre.x * scale + box.left;
    const ry = cup.rimCentre.y * scale + box.top;
    const rr = cup.rimRadiusPx * scale;
    const rd = cup.rimDepthPx * scale;

    const LID = '#2f3338';
    const LID_HI = '#5c636b';
    const LID_LO = '#1d2024';

    // Skirt: the band that grips the rim.
    const skirt = rd * 1.5;
    ctx.fillStyle = LID_LO;
    ctx.beginPath();
    ctx.moveTo(rx - rr * 1.045, ry);
    ctx.lineTo(rx - rr * 1.045, ry + skirt);
    ctx.ellipse(rx, ry + skirt, rr * 1.045, rd * 1.045, 0, Math.PI, 0, true);
    ctx.lineTo(rx + rr * 1.045, ry);
    ctx.closePath();
    ctx.fill();
    const band = ctx.createLinearGradient(rx - rr, 0, rx + rr, 0);
    band.addColorStop(0, LID_LO);
    band.addColorStop(0.32, LID_HI);
    band.addColorStop(1, '#232629');
    ctx.fillStyle = band;
    ctx.beginPath();
    ctx.moveTo(rx - rr * 1.045, ry);
    ctx.lineTo(rx - rr * 1.045, ry + skirt * 0.62);
    ctx.ellipse(rx, ry + skirt * 0.62, rr * 1.045, rd * 1.045, 0, Math.PI, 0, true);
    ctx.lineTo(rx + rr * 1.045, ry);
    ctx.closePath();
    ctx.fill();

    // Domed top, lit from the same side as everything else.
    const dome = ctx.createRadialGradient(
      rx - rr * 0.35, ry - rd * 0.5, rr * 0.05,
      rx, ry, rr * 1.15,
    );
    dome.addColorStop(0, LID_HI);
    dome.addColorStop(0.55, LID);
    dome.addColorStop(1, LID_LO);
    ctx.fillStyle = dome;
    ctx.beginPath();
    ctx.ellipse(rx, ry, rr * 1.045, rd * 1.045, 0, 0, Math.PI * 2);
    ctx.fill();

    // Raised drinking lip and the sip hole through it.
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.ellipse(rx, ry - rd * 0.12, rr * 0.66, rd * 0.66, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#15171a';
    ctx.beginPath();
    ctx.ellipse(rx + rr * 0.5, ry - rd * 0.05, rr * 0.17, rd * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();

    // Specular streak along the near edge of the dome.
    ctx.strokeStyle = 'rgba(255,255,255,0.30)';
    ctx.lineWidth = Math.max(1, rd * 0.16);
    ctx.beginPath();
    ctx.ellipse(rx, ry, rr * 0.93, rd * 0.93, 0, Math.PI * 1.05, Math.PI * 1.65);
    ctx.stroke();
  },
};

const counter: MockupScene = {
  id: 'counter',
  name: 'Café counter',
  description: 'Polished stone with a reflection, café thrown out of focus.',
  aspect: 4 / 5,
  cupScale: 0.5,
  centreU: 0.62,
  tiltRad: 0.13,
  exposure: 0.98,
  lightFrom: 0.4,
  paint: (ctx, w, h, getCup) => {
    const cup = getCup();
    const horizon = h * 0.46;
    verticalFill(ctx, h, horizon, [[0, '#3b3a3f'], [1, '#5d5a57']]);
    ctx.fillStyle = '#4a4845';
    ctx.fillRect(0, 0, w, horizon);
    // Warm lights behind the counter.
    bokeh(ctx, w * 0.2, horizon * 0.34, w * 0.13, 'rgba(255,214,150,ALPHA)', 0.6);
    bokeh(ctx, w * 0.42, horizon * 0.22, w * 0.09, 'rgba(255,226,170,ALPHA)', 0.45);
    bokeh(ctx, w * 0.72, horizon * 0.4, w * 0.16, 'rgba(255,206,140,ALPHA)', 0.5);
    bokeh(ctx, w * 0.9, horizon * 0.18, w * 0.08, 'rgba(255,236,200,ALPHA)', 0.4);

    // Polished stone.
    const stone = ctx.createLinearGradient(0, horizon, 0, h);
    stone.addColorStop(0, '#8f8b84');
    stone.addColorStop(0.35, '#a49f97');
    stone.addColorStop(1, '#77736d');
    ctx.fillStyle = stone;
    ctx.fillRect(0, horizon, w, h - horizon);
    // Veining.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, horizon, w, h - horizon);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    for (let i = 0; i < 5; i++) {
      const y = horizon + (h - horizon) * (0.15 + i * 0.19);
      ctx.lineWidth = 1 + (i % 2);
      ctx.beginPath();
      ctx.moveTo(-20, y);
      ctx.bezierCurveTo(w * 0.35, y - 16, w * 0.6, y + 14, w + 20, y - 6);
      ctx.stroke();
    }
    ctx.restore();

    const groundY = h * 0.8;
    const scale = (h * 0.5) / cup.heightPx;

    // Reflection first, so the cup sits on top of it.
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.translate(0, groundY * 2);
    ctx.scale(1, -0.55);
    placeCup(ctx, cup, w * 0.5, groundY, scale);
    ctx.restore();
    // Fade the reflection out with distance.
    const fade = ctx.createLinearGradient(0, groundY, 0, h);
    fade.addColorStop(0, 'rgba(150,146,140,0)');
    fade.addColorStop(1, 'rgba(140,136,130,0.95)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, groundY, w, h - groundY);

    groundShadow(ctx, w * 0.5, groundY, w * 0.26, 1.1);
    placeCup(ctx, cup, w * 0.5, groundY, scale);
  },
};

const pair: MockupScene = {
  id: 'pair',
  name: 'Two up',
  description: 'Front and reverse together — the half a single view cannot show.',
  aspect: 4 / 5,
  cupScale: 0.52,
  centreU: 0.5,
  tiltRad: 0.17,
  exposure: 1.03,
  lightFrom: -0.5,
  paint: (ctx, w, h, getCup) => {
    verticalFill(ctx, w, h, [[0, '#f2efe9'], [0.6, '#e6e1d8'], [1, '#cfc8bc']]);
    bokeh(ctx, w * 0.44, h * 0.3, w * 0.5, 'rgba(255,255,255,ALPHA)', 0.7);

    // Turned half a turn apart, so the two cups show opposite faces of the
    // wrap. A single mockup can only ever show half the circumference - this
    // scene exists to show the other half.
    const front = getCup(0.5);
    const back = getCup(0.0);

    // The back cup is smaller and higher: further away, same ground plane.
    const backY = h * 0.74;
    groundShadow(ctx, w * 0.66, backY, w * 0.2, 0.7, w * 0.03);
    placeCup(ctx, back, w * 0.66, backY, (h * 0.44) / back.heightPx);

    const frontY = h * 0.88;
    groundShadow(ctx, w * 0.4, frontY, w * 0.28, 1, w * 0.04);
    placeCup(ctx, front, w * 0.4, frontY, (h * 0.55) / front.heightPx);
  },
};

export const MOCKUP_SCENES: readonly MockupScene[] = [studio, table, togo, counter, pair];

export function getScene(id: string): MockupScene {
  return MOCKUP_SCENES.find((s) => s.id === id) ?? MOCKUP_SCENES[0]!;
}
