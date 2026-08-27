# Cupco Studio

Customer mockup studio + internal production studio, on **one shared cup-geometry engine**.

The architectural commitment: what the customer sees wrapped around the 3D cup and what the
printer receives as a flat fan are two renderings of **one design**, through **one geometry
engine**. There is no second, approximate mockup pipeline that could drift out of step.

## Status

Roughly 15,300 lines of TypeScript across seven packages. **417 tests, all passing.**

| Area | State | Tests |
|---|---|---|
| Geometry engine, real 8oz profile | ✅ | 88 |
| Fan rasteriser | ✅ | 18 |
| Vector: SVG import, tracing, QR styles, CMYK | ✅ | 110 |
| Concept generation (10 layouts) | ✅ | 35 |
| Persistence: assets, migration, GC | ✅ | 51 |
| Preflight: 12 production rules | ✅ | 48 |
| App: serialisation, snapping, uploads | ✅ | 67 |
| 3D cup, studio lighting, turntable MP4/GIF | ✅ | — |
| Editing: undo, clipboard, guides, eyedropper | ✅ | — |
| Vector CMYK PDF + SVG export | ✅ | — |

### Not built

The gaps, roughly in order of how much they hurt:

1. **No customer-facing half.** No accounts, no roles, no simplified customer studio,
   no lifestyle mockup gallery, no approval workflow, no Wix embed.
2. **Storage is local to one browser.** Work is saved, but only on the machine and
   browser that made it — there is no server, no sync, no sharing, and no backup.
   Clearing site data deletes everything.
3. **No server-side export worker**, so no certified PDF/X (current PDF is genuine
   CMYK but carries no output intent or ICC profile).
4. **12oz and 16oz are placeholders** — blocked on real measurements from Cupco.

### Waiting on Cupco

- 12oz and 16oz dimensions (top Ø, bottom Ø, height) — same three numbers as 8oz
- Confirmation that the 8oz `baseAllowanceMm` estimate is right (it drives no output,
  so this is informational only)
- Whether the printer wants certified PDF/X, or whether CMYK vector is sufficient

## Run it

```bash
npm install
npm run dev -w @cupco/web     # http://localhost:3000
```

Three tabs: **Design** (the logical canvas), **3D Preview** (rotate/zoom/pan the real 8oz cup),
**Production Fan** (the warped fan with trim/bleed/safe/overlap dieline, and export).

## Layout

```
packages/geometry/   ★ pure TS, zero deps — CupProfile, frustum maths, coordinate mappings, path warping
packages/render/     rasteriser: design canvas -> production fan, shared browser + Node
packages/vector/     SVG import, raster tracing, palette extraction, RGB->CMYK
packages/concepts/   rule-based layout strategies + contrast selection
packages/persistence/ stored-document format, content-addressed assets, storage adapters
packages/preflight/  production validation rules — what would go wrong if this were printed
apps/web/            Next.js app; 3D via React Three Fiber, export via Web Worker
```

`packages/geometry` has **no runtime dependencies** on purpose: the same code runs in the browser
for the 3D preview, in Node for export, and in the test runner. One implementation, no drift.

## The 8oz cup

Dimensions and every print-affecting margin are **confirmed by Cupco**. See
[packages/geometry/README.md](packages/geometry/README.md) for the maths and the full table.

```
Dt 73.62  Db 55.00  h 90.00 (vertical)
  -> slant 90.4803mm, sector 37.0423deg, R_bot 267.2618mm, R_top 357.7420mm
  -> blank 239.91 x 115.70mm incl. 5mm bleed
  -> export 2834 x 1367px @ 300dpi
```

Arc-length identity `R_top * theta = pi * Dt` closes to 2.8e-14.

## What you can upload

| Format | How it arrives | Can it export as vector? |
|---|---|---|
| **SVG** | Parsed to real paths | **Yes — lossless.** Always prefer this. |
| PNG / JPG / WebP | Bitmap | Yes, after tracing (⟡ on the layer) |
| PDF / AI | Rendered to a bitmap at ~2000px | Yes, after tracing — but lossy twice over |
| EPS | Rejected with guidance | No — PostScript; needs Illustrator or Ghostscript |
| PSD / INDD / Sketch / Figma | Rejected with guidance | No — export from the tool first |

Tracing is **opt-in**, not automatic: it is excellent on flat-colour logos and poor on
photographs, so the operator decides. A traced logo exports as genuine vector CMYK.

PDF and AI are **rasterised, not vector-extracted** — pdf.js renders to a canvas and does
not expose path geometry cleanly. Reaching vector from a PDF therefore means tracing a
render, which is an approximation of an approximation. If the customer can send an SVG,
that path is lossless and none of this applies.

Every rejection explains what to do instead rather than saying "could not read".

## Concept generation

Upload a vector logo and the Concepts tab proposes ten distinct layouts:
centred, oversized, two-tone block, ruled band, repeating, diagonal, minimal base,
mark-on-black, mark-and-QR, and mark-with-name.

**Background plates are stripped automatically.** Exported logos routinely carry a
white rectangle behind the mark — invisible on paper, but a white box on a coloured
cup. It is removed on upload and on every concept unless a strategy opts out.

**Mark on black** additionally lightens a dark logo, so a navy or black mark does not
vanish against the ground.

**Mark and QR** places the logo centred in the left half and a QR in the right half,
on the same line. Paste a web address into the QR's properties and the placeholder
becomes a working code — generated as vector geometry, so it stays sharp and
scannable at print size. See [QR styles](#qr-styles) for the six looks available.

Deterministic by design — the same logo always produces the same set, seeded from
the asset name, so a customer who reloads sees what they were shown before. Applying
a concept produces an **ordinary editable design**: every element can be moved,
recoloured or deleted, and one undo reverts the whole thing.

Backgrounds are chosen by **measured WCAG contrast** against the artwork's dominant
colour, not at random, so a navy logo never lands on a navy field.

Strategies implement a `ConceptStrategy` interface, so an AI-backed generator can be
added later without touching the data model.

## Saving your work

Work is saved automatically, about a second after you stop editing, and again if
you switch tabs or close the window. The project name and a save state sit at the
top of the sidebar.

- **Projects** — as many as you like. Switch, duplicate or delete from **All**.
  Duplicating is cheap: artwork is shared between copies rather than duplicated.
- **Versions** — a permanent, named copy of the design at a moment in time. Editing
  afterwards never changes a saved version, so it stays a true record of what was
  shown to a customer or signed off. Restoring one replaces the working design;
  the version itself is untouched, so nothing is used up by being restored.

### What is stored, and what is rebuilt

Elements in the editor hold live objects — decoded images, parsed vector paths,
generated QR matrices — none of which survive `JSON.stringify`. So saving is a real
translation, not a state dump, and it follows one rule:

| | |
|---|---|
| **Derivable** → not stored | A QR code's modules are a pure function of its URL, so only the URL is written and the code is regenerated on load. A saved code can never disagree with the generator. |
| **Expensive or lossy to re-derive** → stored as an asset | Original image bytes, kept byte for byte, and traced vector artwork. |

Assets are addressed by the SHA-256 of their content, so a logo used in eight
concepts, twenty versions and two duplicated projects is stored **once**. Orphaned
assets are swept at startup, with a grace period so an upload that has not been
autosaved yet is never collected out from under you.

Stored artwork coordinates are rounded to six decimal places. On a 60mm logo that is
a 60-nanometre shift — about 300× finer than the export's own 0.02mm flatness
tolerance — and it roughly halves the stored size.

Every document records the format version it was written at. A document from a
**newer** build is refused rather than opened, because opening it would silently drop
the fields this build does not understand and the next autosave would write the
truncated version back over the original.

### Limits

- **One browser, one machine.** IndexedDB is local. There is no server, no sync, no
  sharing between people, and no backup. Clearing site data deletes every project.
- Storage is a share of free disk. If it runs out, the save fails loudly and says so
  rather than failing quietly — but the remedy is manual: delete a project or a version.
- Two tabs open on the same project will overwrite each other. There is no locking.

All of this sits behind `ProjectStore` and `AssetStore` interfaces, with an in-memory
implementation used by the tests. Moving to Postgres and object storage is an
implementation swap rather than a rewrite — which is the reason the boundary is drawn
there and not at the call sites.

## QR styles

Six presets, picked by looking at swatches of **your own code** — a long address makes
a denser code, and that changes how a style reads more than the choice of style does.

| | |
|---|---|
| **Classic** | Sharp squares. Most robust, smallest file. |
| **Dots** | Round modules, circular eyes. |
| **Rounded** | Softened corners. Subtle. |
| **Fluid** | Neighbouring modules join into flowing shapes. |
| **Petal** | Round modules, leaf-shaped eyes. Most decorative. |
| **Pebble** | Flowing modules against circular eyes. |

Styling changes only how modules are **drawn** — never what the code says. Every style
produces the identical module grid, which is asserted in the tests.

### What can be stylised, and why

A decoder does two things, and they tolerate very different amounts of decoration:

1. **Locate** the code from the three finder patterns, by scanning for the run-length
   ratio 1:1:3:1:1. This is the fragile part.
2. **Read** the data by sampling each module at its **centre**. This is forgiving —
   what happens at a module's edges barely matters.

So data modules can be restyled fairly freely, while the eyes need care. The circular
eye works because a line through the centre of concentric circles of radius 3.5, 2.5
and 1.5 modules gives runs of exactly 1, 1, 3, 1, 1 — the ratio is preserved **exactly**,
not approximately.

Three things are not negotiable and are not exposed as options: the 4-module quiet zone,
a light ground behind the code, and genuinely dark modules.

### How the dot size was settled

The airier dots this started with (86% of a module) look better and were **rejected**,
because the two decoders disagree about them sharply:

| | separated dots (86%) | tangent dots (100%) |
|---|---|---|
| **ZXing** — most native phone scanners | reads them, down to 70%, even blurred | reads them |
| **jsQR** — most browser-based scanners | **reads nothing** | reads them |

A customer holding a cup has no say in which decoder is inside whichever app they open,
so the dots are full-module circles, tangent rather than separated. Still unmistakably
round; readable by both.

Worth knowing: an intermediate 95% *appears* to pass jsQR at low resolution and fails at
high. The low-res "pass" is aliasing closing the gaps, not scannability — which is exactly
why this was not settled by looking at one render.

### Verification

Every style is decoded by **both** decoders, in the test suite: at print size, at 300dpi
(the size the preflight floor allows), at 600px where real gaps would show, and with blur
standing in for ink spread and camera focus. All sixteen module × eye combinations are
covered, not just the six presets, so a new preset cannot ship an unverified pairing.

The suite includes a control — the plain square code, the shape that already shipped —
and a negative case, so a pass is never vacuous. *"It looks like a QR code"* is not
evidence that it scans.

To see them all: `npx tsx packages/vector/scripts/qr-styles-sheet.ts cupco.com.au out/qr-styles.svg`

## Editing

Direct manipulation on both the Design and Production Fan tabs — click to select,
drag to move, corners resize, top handle rotates.

- **⌘C / ⌘X / ⌘V** copy, cut and paste. An internal clipboard, not the system one:
  elements hold live parsed vector paths, decoded images and QR matrices that would
  degrade if serialised to text.
- **Alignment guides**, two kinds, appearing only when an element is close:
  - *Canvas guides* (pink) — centre, both thirds, the middle line. The element's
    centre snaps to these.
  - *Object guides* (purple) — any edge or centre of the dragged element aligning
    to any edge or centre of another. Drawn only across the two elements involved,
    so it is obvious which one is being matched, and labelled with what matched
    ("Left edges aligned", "Centres aligned", "Left meets right").

  Object guides win ties against canvas guides: if a logo is equally close to the
  cup's centre line and to another logo's edge, matching the other logo is almost
  always the intent. Hold **alt** to suspend snapping.
- **⌘Z / ⇧⌘Z** undo and redo. A whole drag is one step.
- **⌫** deletes the selection.

## Colour proofing

The CMYK proof toggle simulates ink on cup board. It models real process inks as
transmittance filters — process cyan is roughly rgb(0,158,224), not (0,255,255) — so
saturated screen colours come back duller, greens and bright magentas most of all.

An earlier version round-tripped through the exact inverse of the RGB→CMYK formula,
which is lossless and therefore showed no change at all. It is an approximation, not
a colour-managed proof: honest about direction and magnitude, but the printer's proof
is the authority.

## Preflight

Runs live on every edit and sits at the top of the sidebar. Click any issue to select
the element it is about.

Severity is a promise, not a mood:

| | |
|---|---|
| **Error** | The printed cup would be **unsalvageable**. Blocks export. |
| **Warning** | You may well be right — a deliberate bleed, a knowingly soft texture. Never blocks. |
| **Info** | Worth knowing, nothing to fix. |

The error list is deliberately short. A tool that blocks on judgement calls trains its
operators to override everything, and then the one real error goes through with the rest.

**Blocks export:** placeholder cup dimensions; a QR code still holding its placeholder
address; a QR split by the glued seam.

**Warns:** artwork in the rim or base curl, or inside the glue-seam margin; a logo split
by the seam; bitmaps under 300dpi *at printed size*; total ink over 300%; text under
1.5mm; a band stopping a hair short of the edge; unconfirmed margins; an element dragged
off the cup; an empty design.

Three of these are worth calling out because they are easy to get wrong:

- **The placeholder QR is the rule most worth having.** Nothing looks wrong, the proof
  scans perfectly, and every cup in the run points at `example.com`.
- **Resolution is judged at printed size.** A 4000px logo is not high resolution if it
  is printed 200mm wide.
- **The seam gap is measured at the element's lowest corner.** Design space is angular,
  so the same gap is physically narrower further down the taper: artwork can clear the
  seam at the rim and foul it at the base.

Every issue carries a **remedy in millimetres** — "move it down at least 3.0mm" — because
*"outside the safe area"* tells an operator nothing they cannot already see.

Preflight does no geometry of its own. Element outlines arrive from the same function that
draws the selection box on screen, and every millimetre conversion goes through
`@cupco/geometry`. A rule doing its own trigonometry would eventually warn about a cup
that is not the one being edited.

**Not covered:** a bitmap's ink coverage is per-pixel, so the ink rule measures flat fills
only and says so rather than averaging.

## Export

Two paths, chosen automatically:

| Design contains | Export | Result |
|---|---|---|
| only vector artwork | **true vector CMYK** | real paths, exact ink values, ~50KB |
| any bitmap or live text | RGB raster | 300–600dpi, several MB |

The UI says which will run and, when it falls back, names the element responsible. Trace a bitmap
(⟡ on its layer) to move it into the vector path.

Vector export warps paths by **adaptive subdivision with a tolerance measured in printed
millimetres** (default 0.02mm), so accuracy is a guarantee about the physical fan, not about pixels.
Verified: an exported PDF contains **5 CMYK fill operators and 0 RGB operators**.

## Turntable export

From the 3D Preview tab, records a full 360° from the current camera angle.

| Format | Use it for |
|---|---|
| **MP4 (H.264)** — default | Anything. Full colour, plays in QuickTime, Keynote, Slack, the web. |
| **GIF** | Embedding where video is not allowed. Limited to 256 colours, so the backdrop bands. |

Video is recorded via `MediaRecorder` from the live canvas stream, so motion is smooth and the
encoder handles compression. The GIF path steps frames by hand and quantises to a single shared
palette sampled across the whole rotation (a per-frame palette makes flat areas shimmer as the cup
turns).

Note: **macOS Preview lists GIF frames rather than playing them.** That is a Preview quirk, not a
broken file — use Quick Look (spacebar in Finder) or a browser. Video avoids the issue entirely.

## Honest limits

- **It is CMYK, but it is not PDF/X.** There is no output intent and no embedded ICC profile, so a
  prepress operator cannot verify it against a press condition. Certifying PDF/X needs the
  server-side Ghostscript container (M8).
- **RGB→CMYK is unmanaged arithmetic**, not colour management — full GCR, total ink capped under
  300%. Fine as a default for a digital press. For critical brand colours, type the exact ink
  percentages into the ink panel and they are written to the PDF verbatim.
- **Tracing is opt-in.** Excellent on flat-colour logos, poor on photographs, so the operator
  decides rather than having artwork silently vectorised.
- Gradients flatten to a solid colour and live text is skipped on SVG import — both are reported,
  never silently dropped.
- **12oz and 16oz carry placeholder dimensions** and are blocked from export by preflight.
- `baseAllowanceMm` is an estimate on all profiles, but is informational and drives no output.
- The source drawing says *"for reference, final drawing after mold finished and tested"* —
  re-confirm with the manufacturer before a production run.

## Verify

```bash
npx vitest run --root packages/geometry     # 88 tests
npx vitest run --root packages/render       # 18 tests
npx vitest run --root packages/persistence  # 51 tests
npx vitest run --root packages/preflight    # 48 tests
npx vitest run --root packages/vector       # 110 tests, incl. QR decode
npx tsx packages/vector/scripts/qr-styles-sheet.ts cupco.com.au out/qr-styles.svg
npx tsx packages/geometry/scripts/report-profile.ts 8oz-single-wall
npx tsx packages/geometry/scripts/emit-fan-svg.ts 8oz-single-wall out/8oz-fan.svg
npx tsx packages/render/scripts/export-check.ts
```

The decisive check is physical: print `out/8oz-fan.svg` at 100%, cut it out, wrap a real 8oz cup.
