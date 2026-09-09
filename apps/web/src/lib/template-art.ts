/**
 * Illustrated seasonal templates, recoloured to a café's own brand.
 *
 * A template is a finished piece of artwork - drawn by a designer, not by this
 * program - with two things marked in it: an ACCENT COLOUR that is meant to be
 * replaced, and a place for the customer's logo. Everything else is left
 * exactly as drawn. That is the difference between a template and a generator:
 * the illustration keeps its craft, and only the parts that should follow the
 * brand do.
 *
 * The accent is identified by HUE, not by an exact value. The artwork is
 * anti-aliased and shaded, so a flat "replace #ED1E79" would leave a pink
 * fringe on every edge and lose every highlight. Selecting a hue window and
 * carrying the pixel's own lightness through keeps the shading intact - a
 * berry still has a highlight, it is just no longer pink.
 *
 * RESOLUTION: the supplied January artwork is 1855px wide and is placed across
 * the visible cup wall, about 165mm, which is 286dpi. The 300dpi floor wants
 * 1948px. That is a property of the file rather than of this code, and
 * preflight will say so.
 */

export interface TemplateSpec {
  id: string;
  src: string;
  /** Height / width of the artwork. */
  aspect: number;
  /** Hue window, in degrees, treated as the recolourable accent. */
  accentHue: [number, number];
  /**
   * The accent as drawn. Swaps are measured FROM this, so a lighter or darker
   * brand colour moves the whole accent with it instead of flattening it.
   */
  accentRef: { s: number; l: number };
  /** Minimum saturation for a pixel to count as accent rather than paper. */
  accentMinSat: number;
  /**
   * Where the logo goes, in IMAGE coordinates: u across, v UP, 0..1.
   *
   * `clear` is how much of that disc is painted over with the disc's own
   * colour before the mark is placed - the artwork has "YOUR LOGO HERE" set
   * inside it, and without this it shows through from behind the logo.
   */
  logo: { u: number; v: number; diameter: number; clear: number };
  /** The paper, for the area beyond the artwork. */
  paper: string;
}

export const TEMPLATES: Record<string, TemplateSpec> = {
  'january-2027': {
    id: 'january-2027',
    src: '/templates/january-2027.png',
    aspect: 848 / 1855,
    // Measured off the file: greens sit at 150-170deg and the beans at
    // 16-30deg, so a 320-358 window takes the pink and nothing else. Of
    // 1,573,040 pixels, 47,907 land inside it and 161 read as pink but fall
    // outside - every one of those 161 touches an in-window pixel, so they
    // are antialias fringe rather than artwork left behind.
    accentHue: [320, 358],
    accentRef: { s: 0.976, l: 0.564 },
    accentMinSat: 0.3,
    // The dark disc the artwork reserves, measured from the file.
    //
    // The disc is LAYERED: solid dark to r=150px, a white ring at 151-159, a
    // dark rim to 165, then paper. The diameter recorded here is the INNER
    // dark field only - the mark belongs inside the ring, and the clearing
    // circle must not paint over it.
    logo: { u: 0.4989, v: 0.4911, diameter: 0.1617, clear: 0.70 },
    paper: '#f9f7f1',
  },
};

/* -------------------------------------------------------------------------- */

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
  const l = (mx + mn) / 2, d = mx - mn;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h: number;
  if (mx === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6;
  else if (mx === G) h = ((B - R) / d + 2) / 6;
  else h = ((R - G) / d + 4) / 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [
    Math.round(ch(h + 1 / 3) * 255),
    Math.round(ch(h) * 255),
    Math.round(ch(h - 1 / 3) * 255),
  ];
}

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** A stable id for one template in one accent colour. */
export function templateAssetId(id: string, accentHex: string): string {
  return `template:${id}:${accentHex.toLowerCase()}`;
}

const sources = new Map<string, Promise<HTMLImageElement>>();
const prepared = new Map<string, HTMLImageElement>();
const preparing = new Map<string, Promise<HTMLImageElement>>();

function loadSource(spec: TemplateSpec): Promise<HTMLImageElement> {
  const hit = sources.get(spec.id);
  if (hit) return hit;
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`template ${spec.id} failed to load`));
    img.src = spec.src;
  });
  sources.set(spec.id, p);
  return p;
}

/**
 * Recolour the accent and return the result as an image.
 *
 * Hue is taken from the brand colour; SATURATION and LIGHTNESS are carried
 * across as offsets from the accent as drawn, so a muted brand gives a muted
 * accent and a dark one gives a dark accent - while the artwork's own
 * highlights and shadows survive, because each pixel keeps its own deviation
 * from the reference.
 */
export async function prepareTemplate(id: string, accentHex: string): Promise<HTMLImageElement> {
  const key = templateAssetId(id, accentHex);
  const done = prepared.get(key);
  if (done) return done;
  const running = preparing.get(key);
  if (running) return running;

  const spec = TEMPLATES[id];
  if (!spec) throw new Error(`unknown template "${id}"`);

  const job = (async () => {
    const src = await loadSource(spec);
    const canvas = document.createElement('canvas');
    canvas.width = src.naturalWidth;
    canvas.height = src.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D context unavailable');
    ctx.drawImage(src, 0, 0);

    const [tr, tg, tb] = hexToRgb(accentHex);
    const [th, ts, tl] = rgbToHsl(tr, tg, tb);
    const dS = ts - spec.accentRef.s;
    const dL = tl - spec.accentRef.l;
    const [h0, h1] = spec.accentHue;

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3]! < 8) continue;
      const [h, s, l] = rgbToHsl(d[i]!, d[i + 1]!, d[i + 2]!);
      const deg = h * 360;
      if (deg < h0 || deg > h1 || s < spec.accentMinSat) continue;
      const ns = Math.max(0, Math.min(1, s + dS));
      const nl = Math.max(0.04, Math.min(0.96, l + dL));
      const [r, g, b] = hslToRgb(th, ns, nl);
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
    ctx.putImageData(img, 0, 0);

    // Erase the artwork's own "your logo here" wording, in the disc's own
    // colour - sampled rather than hardcoded, so it stays right if the
    // template is ever redrawn in a different green.
    const cx = spec.logo.u * canvas.width;
    const cy = (1 - spec.logo.v) * canvas.height;
    const r = (spec.logo.diameter * canvas.width) / 2;
    const sample = ctx.getImageData(
      Math.round(cx), Math.round(cy - r * 0.8), 1, 1,
    ).data;
    ctx.fillStyle = `rgb(${sample[0]},${sample[1]},${sample[2]})`;
    ctx.beginPath();
    ctx.arc(cx, cy, r * spec.logo.clear, 0, Math.PI * 2);
    ctx.fill();

    const out = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('recoloured template failed to decode'));
      el.src = canvas.toDataURL('image/png');
    });
    prepared.set(key, out);
    preparing.delete(key);
    return out;
  })();

  preparing.set(key, job);
  return job;
}

/** The prepared image, if it is already built. Safe to call while rendering. */
export function getPreparedTemplate(id: string, accentHex: string): HTMLImageElement | null {
  return prepared.get(templateAssetId(id, accentHex)) ?? null;
}

/** Rebuild a template from an asset id of the form `template:<id>:<hex>`. */
export function templateFromAssetId(assetId: string): Promise<HTMLImageElement> | null {
  const m = /^template:([^:]+):(#[0-9a-f]{6})$/i.exec(assetId);
  return m ? prepareTemplate(m[1]!, m[2]!) : null;
}
