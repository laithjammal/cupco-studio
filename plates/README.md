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
| `mockup-3.png` | 1329×1183. Lidded, on a terrazzo counter, café behind. **The better plate** — nothing in front of the cup, even light, and a setting that flatters a design. |
| `hand-lidded.png` | 1337×1177. Held, lidded, concrete background. Shows scale, but the fingers crop the wrap. |

### mockup-3.png

```
topLeft     505, 620        topBow       8
topRight    832, 616        bottomBow   18
bottomLeft  551, 934        centreU      0.5
bottomRight 779, 930        visibleSpan  0.5
```

Measured: wall from y≈617 under the lid to y≈950 at the base; silhouette 510–826 at y=660,
narrowing to 551–779 near the bottom.

One thing to watch on this plate: the terrazzo counter is bright and neutral, just like the
cup, so the mask cannot tell them apart. The calibration has to sit on the cup — overshoot and
artwork will spill onto the bench. On the hand plate the opposite was true: fingers and lid are
easy to reject, so the calibration could be generous.

### hand-lidded.png

Calibration is saved in the browser, so it survives reloads but not clearing site data. Measured
values, if they ever need re-entering:

```
topLeft     521, 497        topBow      16
topRight    823, 483        bottomBow   18
bottomLeft  561, 797        centreU     0.5
bottomRight 777, 791        visibleSpan 0.5
```

These come from scanning the photograph, not from eyeballing it: the cup wall runs from
y≈475 under the lid to y≈813 at the base, spanning x 530–811 at mid-height and 561–776 near
the bottom.

`hand-lidded.png` is a generated image rather than a photograph of a real Cupco cup. It works
well as a plate, but for customer-facing work it is worth shooting the **actual product** — the
credibility of a mockup rests on the cup in it being the cup they will receive, and a generated
cup will not have the true 8oz proportions.
