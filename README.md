# Cupco Studio

Customer mockup studio + internal production studio, on **one shared cup-geometry engine**.

The architectural commitment: what the customer sees wrapped around the 3D cup and what the
printer receives as a flat fan are two renderings of **one design**, through **one geometry
engine**. There is no second, approximate mockup pipeline that could drift out of step.

## Status

Roughly 17,600 lines of TypeScript across seven packages. **472 tests, all passing.**

| Area | State | Tests |
|---|---|---|
| Geometry engine, 8oz profile, elevation, plates | ✅ | 131 |
| Fan rasteriser | ✅ | 18 |
| Vector: SVG import, tracing, QR styles, CMYK | ✅ | 110 |
| Concept generation (10 layouts) | ✅ | 35 |
| Persistence: assets, migration, GC, plates | ✅ | 55 |
| Preflight: 12 production rules | ✅ | 48 |
| App: serialisation, snapping, uploads, plate fitting | ✅ | 75 |
| 3D cup, graduated studio backdrop, turntable MP4 | ✅ | — |
| Photo mockups: artwork composited onto real cups | ✅ | — |
| Drawn mockups, five settings | ✅ | — |
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

Five tabs: **Concepts** (ten generated layouts), **Design** (the logical canvas),
**3D Preview** (rotate/zoom/pan the real 8oz cup), **Production Fan** (the warped fan
with its trim/bleed/safe/overlap dieline, and export), and **Mockups** (the cup staged in
five settings, for sending to customers).

The sidebar holds what you *set* — project, preflight, cup, artwork, the selected element,
inks, export — grouped into collapsible sections whose headers stay useful when closed
("8oz Single Wall", "3 layers", "Vector CMYK ready"). What you *look through* — guides, the
CMYK proof, the camera and turntable — sits in the tab bar beside the view it affects,
because it changes what is on screen rather than what gets printed.

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

## Mockups

Two modes, switched from the tab bar.

### Photo — genuinely photographic

Composites the artwork onto a **photograph of a real blank cup**. This is how commercial mockup
templates work, and it is the only route to a photographic result: the table, the light, the
shadows, the hand and the out-of-focus background are all real. All the app does is put the
artwork on the cup that is already in the picture.

**You supply the plates** — photograph a plain white cup in whatever settings you want to sell
in. **The app finds the cup for you**: adding a plate locates it in the photograph and places
the handles on it. The six handles remain for adjustment, and dragging one marks the plate as
hand-fitted so the automatic fit never overwrites it.

Finding a cup is not a colour problem — a terrazzo counter is bright and neutral in exactly the
way a white cup is. It is an *edge* problem, and the search follows the structure of the object:
the lid is the one dark band with a tall bright column beneath it, which fixes the top and the
centre; the base is the strongest bright-to-dark step straight down that centre, which is the
contact shadow; and the walls are the first sustained step outward on each row.

The cup is then fitted as what it is — **a solid of revolution**. One axis and one half-width,
so every row constrains both silhouettes at once. That matters because one side is routinely
unusable: on a lit-from-the-right photograph the shaded left edge simply has no step to find
below the midpoint. Fitting the sides independently threw away the good side along with the bad
and under-tapered the cup by 35px.

Each side is sifted by **least median of squares** before any of that — the line that explains
the most samples wins, and the rest are dropped. Trimming outliers by their distance from a
median, which is what this did, assumes they are a scattered minority; behind a cup's shaded
side they are neither. There, whole runs of rows lock onto the same wrong thing — a strip of
panelling, the far edge of a shadow — and agree with each other well enough to pass for signal.
On this plate that gate rejects a third of the left-hand samples.

Two consequences follow from having clean samples:

- **The silhouette is read at the half-way point of its transition**, not at the first pixel
  that shows one. The first pixel sits about 1.5px inside the cup on *every* row, and a bias
  survives any amount of averaging — it arrives intact in the finished fit as a bare strip.
- **The axis is allowed to lean.** Holding it vertical was the safe choice while the samples
  were dirty, because a few false edges could tilt a fitted line and drag the whole cup with
  it. But cups do lean: this one leans by less than a degree, and forcing it upright cost 8px
  at the rim — artwork hanging off one side while a bare strip showed on the other.

**The top edge comes from the lid**, traced across the full width of the cup and fitted as the
arc it is. It used to be measured down the centre column and handed to the corners, which put
the whole edge a lid's sag too low — and then `topBow` pushed the middle lower again, counting
the same sag twice. Twenty pixels of bare cup under the lid, widest where the eye goes first.

Against a silhouette measured by hand off the supplied plate, every corner now lands within
2px and the top edge within 1px; nothing is painted onto the lid, the counter, or past either
edge. `npx tsx apps/web/scripts/check-plate-fit.ts` prints that comparison.

You can zoom the plate view (**− / % / +**, or ⌘-scroll) to place handles precisely.

Three things make it look real rather than pasted:

| | |
|---|---|
| **Shape** | Warped through the geometry engine, so artwork compresses towards the silhouette as it does on a real cup. A perspective transform cannot do this — a cup is neither flat nor a quadrilateral. |
| **Light** | The artwork is **multiplied** into the photograph, not drawn over it. Every highlight, shadow and bit of board texture survives underneath. Ink on paper darkens what is below it, so multiply is not a convenient blend mode — it is what ink does. |
| **What is in front** | Fingers, lids and straws crossing the cup stay in front, automatically. |
| **The paper** | Whether the design's background is printed is decided **from the design**. A near-white background is bare cup board and is dropped, so the photograph's own shading and texture show through — painting a flat panel over them makes the artwork read as a sticker. Any other background is a deliberate colour choice and is printed. **Cup colour** overrides it either way. |

Getting that last one wrong is silent in *both* directions, which is why it is automatic: a
white background painted onto a photographed cup lays a flat panel over its real shading, while
a coloured background skipped leaves the cup bare and the design looking like it has lost half
of itself.

The mask thresholds are measured, not guessed. On the supplied plate, bare cup — including its
shaded edge — runs to **0.27 saturation**, and skin starts at **0.36**. The default sits at
0.32, in the gap. An earlier 0.22 sat inside the *cup's* own range and was quietly eating
artwork off the shaded side, which is exactly where a coloured design failed to reach the edge.

That last one is the trick worth knowing. A pixel is bare cup board if it is **bright and
neutral**. A white cup is both; skin is bright but distinctly warm; a black lid is neutral but
dark. One cheap test separates the cup from the two things most likely to be in front of it,
with no mask to paint and nothing for the operator to get wrong. Two sliders tune it if a plate
is unusual.

Good plates: a plain **unprinted** white cup (artwork multiplies onto it, so anything already
there shows through), even light with no hard shadow line across the face, and square-on to the
cup where possible — a strong angle needs the visible-wrap control turned down.

### Rendered — no photograph needed

Five drawn settings, downloadable as **1800px PNGs**, re-rendered at full size rather than
upscaled from the card.

| | |
|---|---|
| **Studio** | Clean seamless ground. The one to lead a proposal with. |
| **On a table** | Warm timber, window light from the left. |
| **To go** | Lidded, as it leaves the counter. |
| **Café counter** | Polished stone with a reflection, café thrown out of focus. |
| **Two up** | Front and reverse together — the half a single view cannot show. |

These are crafted surfaces, light and shadow — brand-presentation quality, not photographs.
Use them before you have plates, or where a plain studio shot is what is wanted. What matters
more is that the **cup** is honest, because a customer approving a mockup and receiving a
different-looking cup is a complaint that lands on Cupco:

- Proportions come from the `CupProfile`, so an 8oz reads as an 8oz.
- Artwork is mapped through the geometry engine, so it sits exactly where the fan puts it.
- **The CMYK proof toggle applies here too.** With it on, the customer approves print colour
  rather than screen colour.

### The foreshortening is the point

Artwork compresses towards the edges of a cup. Screen `x = r(v)·sin(φ)`, so equal steps around
the circumference cover less and less width as the surface turns away — the centre of the face
is magnified and the edges are squeezed. Stretching artwork flat across the silhouette instead
is the single most common way a cup mockup looks wrong without anyone being able to say why.

The cup is drawn as a **gather**, exactly like the production fan rasteriser: it walks the
output pixels and asks each one which piece of the design it shows. Painting strips of artwork
forward onto the shape leaves seams and spreads the design evenly across a curving surface.

A single view can only ever show **half the circumference** — the rest is behind the cup. That
is what "Two up" is for: it renders two cups half a turn apart.

### No hand, and why

There were three attempts at "in someone's hand": fingers across the face, fingers curling from
the side, thumb-forward with fingertips past the far edge. All three looked cheap. Hands are
unforgiving — everyone knows exactly what one looks like, so "nearly" reads as wrong, and a
mockup that looks wrong is worse than one fewer mockup. A lid earned the slot instead.

If a photographic hand is wanted, the cup renders to a transparent PNG and composites straight
into a photograph.

## The 3D preview

A studio product shot, not a viewport. The lighting is a real tabletop setup — a large soft key at
45°, a dimmer fill opposite to open the shadows without flattening the form, and a rim light behind
to separate the cup from the ground.

The backdrop is **graduated**, not a flat wall. Real light falls off from wherever the softbox is
pointed, pooling brightness behind the subject and letting the corners go down, and that falloff is
what separates a product from its ground without an outline. A single flat grey — which is what
this was — reads as a render precisely because nothing falls off.

The gradient is screen-space, anchored to the frame so the vignette stays put while the camera
orbits. The warm centre against cool corners is deliberate — equal-temperature greys look flat
however you ramp them.

There was a curved sweep too, a physical mesh the shadow fell across. It is gone: however seamless
it is meant to look, the arc where it turned up into the back wall read as a line across the frame,
and a line is worse than the flatness it was there to avoid. The cup is grounded by its contact
shadow instead, which needs no geometry behind it.

### Turntable export

**Record MP4** captures a full 360° from the current camera angle, via `MediaRecorder` on the live
canvas stream: smooth motion, full colour, and the browser's own H.264 encoder does the
compression. Plays in QuickTime, Keynote, Slack and every browser.

There was a GIF option. It was removed — 256 colours banded the graduated backdrop badly, and
macOS Preview lists GIF frames rather than playing them, so the format meant to be the
"plays anywhere" fallback was the one that looked broken.

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
npx vitest run --root packages/geometry     # 131 tests
npx vitest run --root packages/render       # 18 tests
npx vitest run --root packages/persistence  # 55 tests
npx vitest run --root packages/preflight    # 48 tests
npx vitest run --root packages/vector       # 110 tests, incl. QR decode
npx vitest run --root apps/web              # 75 tests, incl. finding a cup in a plate
npx tsx packages/vector/scripts/qr-styles-sheet.ts cupco.com.au out/qr-styles.svg
npx tsx packages/geometry/scripts/report-profile.ts 8oz-single-wall
npx tsx packages/geometry/scripts/emit-fan-svg.ts 8oz-single-wall out/8oz-fan.svg
npx tsx packages/render/scripts/export-check.ts
npx tsx apps/web/scripts/check-plate-fit.ts  # the plate fit, against a hand-measured cup
```

The decisive check is physical: print `out/8oz-fan.svg` at 100%, cut it out, wrap a real 8oz cup.
