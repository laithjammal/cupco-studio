/**
 * A scanline rasteriser, used ONLY by the QR decode tests.
 *
 * The QR builder emits polygons in a unit box. To prove those polygons
 * actually scan, they have to become pixels that a real decoder can read - so
 * this fills them the way a renderer would, using the NONZERO winding rule,
 * which is what both export paths use and which is how the eyes' reverse-wound
 * holes are meant to be cut.
 *
 * It is deliberately simple and independent of the code under test. The
 * 'square' style acts as the control: it is the shape that shipped and is known
 * to scan, so if square decodes and a stylised one does not, the finding is
 * about the style rather than about this file.
 */

export interface Pt { x: number; y: number }

/**
 * The dark module subpaths of a QR artwork.
 *
 * The artwork now carries its frame: the light plate is shape 0 and any dark
 * decoration follows it, with the modules LAST. Tests about the code's own
 * structure want that last shape, not whatever happens to be first.
 */
export function modulesOf(
  art: { shapes: readonly { subpaths: readonly (readonly Pt[])[] }[] },
): readonly (readonly Pt[])[] {
  return art.shapes[art.shapes.length - 1]!.subpaths;
}

/**
 * Fill polygons into an RGBA buffer, black on white.
 *
 * Samples at pixel centres and counts signed edge crossings to the left,
 * filling where the winding number is non-zero.
 */
export function rasterise(subpaths: readonly (readonly Pt[])[], size: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  fillInto(data, size, subpaths, [0, 0, 0]);
  return data;
}

/**
 * Render a whole QR artwork - frame plate, decoration and modules - with each
 * shape's own colour, over a chosen ground.
 *
 * The ground matters. A framed code is only safe because its plate carries the
 * quiet zone; rendering it on a DARK ground is what proves that, since any part
 * of the quiet zone falling outside the plate shows up as dark right against
 * the code and the decoders stop reading it.
 */
export function rasteriseArtwork(
  art: { shapes: readonly { subpaths: readonly (readonly Pt[])[]; fill: readonly number[] }[] },
  size: number,
  ground: readonly number[] = [255, 255, 255],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = ground[0]!; data[i * 4 + 1] = ground[1]!;
    data[i * 4 + 2] = ground[2]!; data[i * 4 + 3] = 255;
  }
  for (const sh of art.shapes) fillInto(data, size, sh.subpaths, sh.fill);
  return data;
}

function fillInto(
  data: Uint8ClampedArray,
  size: number,
  subpaths: readonly (readonly Pt[])[],
  rgb: readonly number[],
): void {

  // Flatten every edge once, in pixel coordinates.
  const edges: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const sp of subpaths) {
    for (let i = 0; i < sp.length - 1; i++) {
      const a = sp[i]!, b = sp[i + 1]!;
      if (a.y === b.y) continue; // horizontal edges never cross a scanline
      edges.push({ x0: a.x * size, y0: a.y * size, x1: b.x * size, y1: b.y * size });
    }
    // Close the ring if the caller did not repeat the first point.
    const first = sp[0]!, last = sp[sp.length - 1]!;
    if (first.x !== last.x || first.y !== last.y) {
      if (first.y !== last.y) {
        edges.push({ x0: last.x * size, y0: last.y * size, x1: first.x * size, y1: first.y * size });
      }
    }
  }

  for (let py = 0; py < size; py++) {
    const y = py + 0.5;
    // Crossings on this scanline, with the direction each edge is going.
    const hits: { x: number; dir: number }[] = [];
    for (const e of edges) {
      const { x0, y0, x1, y1 } = e;
      const yTop = Math.min(y0, y1), yBot = Math.max(y0, y1);
      if (y < yTop || y >= yBot) continue;
      const t = (y - y0) / (y1 - y0);
      hits.push({ x: x0 + (x1 - x0) * t, dir: y1 > y0 ? 1 : -1 });
    }
    if (hits.length === 0) continue;
    hits.sort((a, b) => a.x - b.x);

    let winding = 0;
    for (let i = 0; i < hits.length - 1; i++) {
      winding += hits[i]!.dir;
      if (winding === 0) continue;
      const xa = Math.ceil(hits[i]!.x - 0.5);
      const xb = Math.ceil(hits[i + 1]!.x - 0.5);
      for (let px = Math.max(0, xa); px < Math.min(size, xb); px++) {
        const o = (py * size + px) * 4;
        data[o] = rgb[0]!; data[o + 1] = rgb[1]!; data[o + 2] = rgb[2]!;
      }
    }
  }
}

/**
 * Blur and threshold, standing in for print gain and a phone camera.
 *
 * A decode from a perfect render is weaker evidence than it looks: real
 * scanning happens through ink spread and lens blur, which is exactly what
 * eats into a dot that only covers part of its module. `radius` is in pixels.
 */
export function blur(data: Uint8ClampedArray, size: number, radius: number): Uint8ClampedArray {
  if (radius <= 0) return data;
  const out = new Uint8ClampedArray(data.length).fill(255);
  const r = Math.round(radius);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0, count = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) { sum += 255; count++; continue; }
          sum += data[(ny * size + nx) * 4]!;
          count++;
        }
      }
      const v = sum / count;
      const o = (y * size + x) * 4;
      out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255;
    }
  }
  return out;
}
