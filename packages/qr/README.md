# @cupco/qr

Scannable QR codes as **vector artwork**, in six styles.

Output is `PlacedArtwork` — the same shape an imported SVG logo becomes — so a QR travels
the identical path as any other artwork: it warps onto the production fan, exports as
vector CMYK, and prints as crisp geometry at any size. Rasterising a QR is the one thing
guaranteed to make it unscannable in print.

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
npx vitest run --root packages/qr                                   # 62 tests
npx tsx packages/qr/scripts/qr-styles-sheet.ts cupco.com.au out/qr-styles.svg
```

## Dependencies

At runtime, **`qrcode-generator` and nothing else**. The encoder produces the module grid;
everything in this package is about turning that grid into geometry that still scans.

`@cupco/vector` is imported **for types only** (`PlacedArtwork`, `RGB`) and is erased at
compile time. Importing the artwork format rather than restating it is what stops the two
drifting — a second copy of that shape would eventually disagree with the one the exporter
reads.

To lift this package out of the monorepo, declare those two types locally; nothing else
here knows about cups.
