# Mockup plates

Photographs of **blank** cups, for the Mockups → Photo tab. The artwork is warped onto the
cup that is already in the picture, so the table, the light, the shadows and the hand are all
real — which is the only way a mockup ends up genuinely photographic.

## What makes a good plate

- **A plain, unprinted white cup.** The artwork is multiplied onto it, so anything already
  printed on the cup shows through the new design.
- **Even light, no hard shadow line across the face.** The cup's own shading is kept — that is
  what sells the result — but a hard-edged shadow will cut across the artwork too.
- **Square-on to the cup where you can.** A strong angle needs the visible-wrap control turned
  down from 50%.
- **Fingers, lids and straws in front are fine.** They are detected and kept in front
  automatically: a pixel counts as cup board only if it is *bright and neutral*, which a white
  cup is, skin is not (too warm), and a black lid is not (too dark).

## Calibrating

Add the photo in the app, then drag six handles: four to the corners of the printable area, and
two until the top and bottom edges follow the cup's curve. The calibration saves with the plate,
so each photograph is set up once and then works for every customer's artwork.

## Files

| File | Notes |
|---|---|
| `mockup-3.png` | 1329×1183. Lidded, on a terrazzo counter, café behind. Nothing in front of the cup, even light, and a setting that flatters a design. |

`mockup-3.png` is a generated image rather than a photograph of a real Cupco cup. It works well
as a plate, but for customer-facing work it is worth shooting the **actual product** — the
credibility of a mockup rests on the cup in it being the cup they will receive, and a generated
cup will not have the true 8oz proportions.

An earlier `hand-lidded.png` was removed; it is still in the git history if it is ever wanted.

## Calibration is automatic

Adding a plate runs the fit: the cup is located in the photograph and the handles are placed on
it. The six handles remain for adjustment, and dragging one marks the plate as hand-fitted so
the automatic fit never overwrites it. **Auto-fit** re-runs it.

On `mockup-3.png` every corner lands within 2px of the silhouette measured by hand, and the
top edge within 1px. Run `npx tsx apps/web/scripts/check-plate-fit.ts` to print the comparison.

| corner | automatic | measured by hand |
|---|---|---|
| top left | 508, 612 | 510, 612 |
| top right | 828, 611 | 830, 609 |
| bottom left | 548, 943 | 548, 943 |
| bottom right | 778, 943 | 778, 943 |

Composited, that means nothing at all is painted onto the lid, onto the counter, or past
either silhouette, and the widest strip of bare cup left anywhere along an edge is 2px.

Two things to watch on this plate:

- The terrazzo counter is bright and neutral, just like the cup, so the mask cannot tell them
  apart. The calibration has to sit on the cup — overshoot and artwork will spill onto the
  bench, and nothing downstream will catch it.
- The panelling behind the cup's shaded left side produces long runs of convincing false
  edges. They are rejected, but it is the reason the fit sifts each side by least median of
  squares rather than by distance from a median.

### If a fit looks wrong

Drag the handles; that marks the plate hand-fitted and the automatic fit will leave it alone
from then on. **Auto-fit** re-runs it and discards the manual adjustment. A calibration saved
before the fit was improved keeps whatever it was saved with — press **Auto-fit** once to take
up the current one.
