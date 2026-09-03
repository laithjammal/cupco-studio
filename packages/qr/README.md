# @cupco/qr

Scannable QR codes as **vector artwork**, in six styles.

Output is plain geometry in a unit box — the same shape an imported SVG logo becomes — so
inside Cupco Studio a QR travels the identical path as any other artwork: it warps onto the
production fan, exports as vector CMYK, and prints as crisp geometry at any size.
Rasterising a QR is the one thing guaranteed to make it unscannable in print.

**It stands on its own.** Copy the folder anywhere; at runtime it needs `qrcode-generator`
and nothing else.

```ts
import { buildQrArtwork, getQrStyle, normaliseUrl, QR_STYLES } from '@cupco/qr';

const url = normaliseUrl('cupco.com.au');          // -> 'https://cupco.com.au/' or null
const { art, moduleCount, pathCount } = buildQrArtwork(url!, {
  style: getQrStyle('pebble'),
});
```

## Styles

| | |
|---|---|
| **Classic** | Sharp squares. Most robust, smallest file. |
| **Dots** | Round modules, circular eyes. |
| **Rounded** | Softened corners. Subtle. |
| **Fluid** | Neighbouring modules join into flowing shapes. |
| **Petal** | Round modules, leaf-shaped eyes. Most decorative. |
| **Pebble** | Flowing modules against circular eyes. |

Styling changes only how modules are **drawn** — never what the code says. Every style
produces the identical module grid, which the tests assert.

## What can be stylised, and why

A decoder does two things, and they tolerate very different amounts of decoration:

1. **Locate** the code from the three finder patterns, by scanning for the run-length
   ratio 1:1:3:1:1. This is the fragile part.
2. **Read** the data by sampling each module at its **centre**. This is forgiving — what
   happens at a module's edges barely matters.

So data modules can be restyled fairly freely, while the eyes need care. The circular eye
works because a line through the centre of concentric circles of radius 3.5, 2.5 and 1.5
modules gives runs of exactly 1, 1, 3, 1, 1 — the ratio is preserved **exactly**, not
approximately.

Three things are not negotiable and are not exposed as options: the 4-module quiet zone,
a light ground behind the code, and genuinely dark modules.

## How the dot size was settled

The airier dots this started with (86% of a module) look better and were **rejected**,
because the two decoders disagree about them sharply:

| | separated dots (86%) | tangent dots (100%) |
|---|---|---|
| **ZXing** — most native phone scanners | reads them, down to 70%, even blurred | reads them |
| **jsQR** — most browser-based scanners | **reads nothing** | reads them |

A customer holding a cup has no say in which decoder is inside whichever app they open, so
the dots are full-module circles, tangent rather than separated. Still unmistakably round;
readable by both.

Worth knowing: an intermediate 95% *appears* to pass jsQR at low resolution and fails at
high. The low-res "pass" is aliasing closing the gaps, not scannability — which is exactly
why this was not settled by looking at one render.

## Verification

Every style is decoded by **both** decoders, in the test suite: at print size, at 300dpi
(the size the preflight floor allows), at 600px where real gaps would show, and with blur
standing in for ink spread and camera focus. All sixteen module × eye combinations are
covered, not just the six presets, so a new preset cannot ship an unverified pairing.

The suite includes a control — the plain square code, the shape that already shipped — and
a negative case, so a pass is never vacuous. *"It looks like a QR code"* is not evidence
that it scans.

`test/qr-raster.ts` is a small scanline rasteriser written for these tests and deliberately
independent of the code under test, so a shared bug cannot make both agree.

```bash
npm test                                              # 62 tests
npx tsx scripts/qr-styles-sheet.ts cupco.com.au out/qr-styles.svg
```

`scripts/qr-styles-sheet.ts` renders all six styles to one SVG sheet from the real builder
output — a visual check to sit alongside the decode tests.

## Standalone

This package has no dependency on the rest of Cupco Studio. At runtime it needs
**`qrcode-generator` and nothing else**; that encoder produces the module grid, and
everything here is about turning that grid into geometry that still scans.

```bash
npm install          # qrcode-generator, plus two decoders for the tests
npm test             # 62 tests
npm run build        # dist/ — JavaScript plus .d.ts, for consumers who need it
```

It emits its own `Artwork` type (`src/artwork.ts`) rather than importing one, which is
what lets the folder be copied out and used anywhere. Inside Cupco Studio that type is
structurally identical to `PlacedArtwork` in `@cupco/vector`, so the two interoperate with
no adapter — and `apps/web/test/qr-artwork-compat.test.ts` asserts them mutually
assignable at compile time, so the copy cannot quietly drift from the original.

Two conventions in the output matter, because getting either wrong misplaces the code:
the box is the **unit square** (0..1 on both axes, quiet zone included), and **y points
down**, the SVG convention.

## Using it somewhere else

```ts
import { buildQrArtwork, getQrStyle, normaliseUrl, QR_STYLES } from '@cupco/qr';

const url = normaliseUrl('cupco.com.au');
if (!url) throw new Error('not a usable address');

for (const preset of QR_STYLES) {
  const { art, moduleCount } = buildQrArtwork(url, { style: getQrStyle(preset.id) });
  // art.shapes[].subpaths[] are closed rings of {x, y} in 0..1, NONZERO winding.
  // Fill them however you render — SVG path, canvas, PDF operator.
}
```

The only hard requirements when you draw it: keep it **square**, keep the quiet zone,
put it on a **light ground**, and keep the dark modules genuinely dark.
