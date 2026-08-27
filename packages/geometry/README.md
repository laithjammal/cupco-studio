# @cupco/geometry

The shared cup geometry engine. **Zero runtime dependencies** — the same code runs in the
browser (3D preview), in Node (export worker), and in the test runner. One implementation
means the customer's 3D cup and the printer's fan cannot drift apart.

## The model

A single-wall cup body is a **truncated cone (frustum)**. A cone is a *developable* surface:
it unrolls onto a plane with zero distortion. The production fan is therefore an exact
closed-form result, not an artistic warp or a mesh deformation.

Given top diameter `Dt`, bottom diameter `Db`, vertical height `h`:

```
dr    = (Dt - Db) / 2
L     = sqrt(h^2 + dr^2)                 SLANT height, not vertical
R_bot = L * Db / (Dt - Db)               apex -> bottom rim
R_top = L * Dt / (Dt - Db) = R_bot + L   apex -> top rim
theta = pi * (Dt - Db) / L               sector sweep angle
```

**Correctness invariant** — the developed arc must equal the circumference:

```
R_top * theta = [L*Dt/(Dt-Db)] * [pi*(Dt-Db)/L] = pi * Dt    (exact)
```

Asserted at both rims for every profile in `test/frustum.test.ts`.

## Coordinate spaces

```
DESIGN SPACE (u,v)          u in [0,1) around, 0 at seam; v in [0,1] bottom->top
      |                     A plain rectangle. The customer never edits a curve.
  +---+---+
  v       v
3D CUP   FAN SPACE (polar, apex at origin) -> PRINT SPACE (mm @ dpi)
```

`designToCup()` is exactly the UV parameterisation Three.js `CylinderGeometry` already uses,
so **the 3D preview needs no pre-warp** — it consumes the design canvas directly as a texture.
The warp exists in exactly one place (`designToFan`), which is why the two views cannot
diverge.

`fanToDesign()` is the inverse, and it is what export actually runs: rasterising iterates over
*output* pixels and gathers from the design canvas. Forward-mapping would scatter samples and
leave holes.

## Why profiles never share a scaled fan

`theta` depends on `(Dt - Db) / L`. Two cups with the same top diameter but different heights
produce different sector angles *and* different apex radii, in no consistent ratio. There is no
scale factor mapping one fan onto another. Every profile derives its own geometry from its own
measurements.

## Provenance gates production

Dimensions and margins are tagged **separately**, because they fail differently:

- invented **dimensions** → the cup is the wrong shape, nothing is salvageable → **error, blocks export**
- invented **margins** → the cup is the right shape but artwork may crop or gap at the seam →
  **warning only**, so staff can still proof a correctly-shaped cup

| Profile | Dimensions | Margins | Status |
|---|---|---|---|
| `8oz-single-wall` | `MEASURED` | `MEASURED` | ✅ fully confirmed, no issues |
| `12oz-single-wall` | `PLACEHOLDER` | `PLACEHOLDER` | ⛔ export blocked |
| `16oz-single-wall` | `PLACEHOLDER` | `PLACEHOLDER` | ⛔ export blocked |

Call `provenanceIssues(profile)` for the specific errors and warnings, and `withMargins()` to
adjust margins later without disturbing any derived geometry.

### Confirmed 8oz values

| | mm | Source |
|---|---|---|
| top Ø / bottom Ø / height | 73.62 / 55.00 / 90.00 | Cupco, drawing `B55H90`; height confirmed **vertical** |
| bleed | 5 | Cupco |
| top print limit | 3 | Cupco — print runs **4mm into** the 7mm rim curl |
| bottom print limit | 2 | Cupco |
| seam clearance | 4 | Cupco |
| seam overlap | 6 | Cupco |

**Safe insets are ABSOLUTE, not additive with the rim curl or base.** Adding them would inset the
top by 10mm instead of 3mm and silently crop artwork. `rimCurlAllowanceMm` and `baseAllowanceMm`
are recorded as physical facts but drive no output.

## Usage

```ts
import { deriveFrustum, designToFan, fanToDesign, CUP_8OZ } from '@cupco/geometry';

const g = deriveFrustum(CUP_8OZ.dimensions);
const fanPoint = designToFan({ u: 0.5, v: 0.5 }, g);   // mm, apex at origin
const back     = fanToDesign(fanPoint, g);              // round-trips to 1e-9
```

Emit a 1:1 SVG to print and lay over the manufacturer's drawing:

```bash
npm run emit:fan -w @cupco/geometry -- 8oz-single-wall ../../out/8oz-fan.svg
```

## Tests

```bash
npx vitest run --root packages/geometry
```

53 tests covering: the arc-length identity at both rims for every profile, forward/inverse
round-trip to 1e-9, rim placement, seam wrapping, asymmetric safe areas, tessellation error
under 0.01mm, rejection of undevelopable input, and provenance gating.
