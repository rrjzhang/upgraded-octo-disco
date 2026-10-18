# Scene grids

`grid.mjs` draws a measuring grid over every background so slots, hotspot zones and TV screen quads in
`public/content/scenes.yaml` can be placed on the real image (SPEC "Presence, place and conversation limits").

```
node tools/scenes/grid.mjs                                   # every background -> tools/scenes/grid/<scene>.jpg
node tools/scenes/grid.mjs --only clinic                     # one scene (or a background id)
node tools/scenes/grid.mjs --only home --crop 0.02,0.06,0.26,0.40 --out /tmp/x
                                                             # zoomed crop with a 1% grid, for measuring corners
```

Each 1350x900 render shows:

- a 10% grid (5% dashed), labelled 0.0-1.0 on all four edges (crops: 5% labelled, 1% dashed);
- the scene's `horizon` in red, with its `cameraHeight`;
- hotspot zones (blue, dashed) and `screens` quads (green);
- every slot as a dot with its id and `x,y`, and a ghost box of the figure the engine would draw there:
  height = (y - horizon) x H / cameraHeight with H = 1.70 m standing or 1.30 m for `seated: true` slots, clamped
  0.12..0.95 (a slot `scale` wins); width uses a typical figure aspect (0.30 standing, 0.48 seated with stool).
  The tick across the box is the head line. Slots with y > 1 sit on the bottom edge.

Output names: `<scene>.jpg` for the scene background, `<scene>_eve.jpg` for the evening variant, `<scene>_painted.jpg`
for a `painted` background, and the background id for backgrounds no scene uses (`bg_center_in_day.jpg`, ...).

Rendering is a canvas in one headless Chrome driven over the DevTools protocol (Node 22+ built-in `WebSocket`), so
there are no dependencies beyond `js-yaml`. The Chrome binary defaults to the Playwright Chromium under
`~/Library/Caches/ms-playwright`; set `CHROME=/path/to/chrome` to use another.

## Placement rules used in scenes.yaml

- Standing slots: feet on open floor (rug, parquet, paving, path), never on furniture or a table's footprint, and not
  where a foreground object would have to hide the legs. Where someone must be near a table, the table is behind them.
- Seated slots (`seated: true`): on real seating where the image has it (benches, waiting chairs, the library chair
  and armchair); the seated figures bring their own stool, so the slot y is the floor under the seat. The checker only
  allows seated figures on these slots.
- Figures should not cover the hotspots the player needs (TV, newspaper/magazines, computer, bed).
- `near` slots: feet at or below the bottom edge so the head lands near the horizon (camera 1.6 m). Home is the
  exception: its camera is about 1.0 m, so standing adults rise well above the horizon there.
- Each slot carries a comment naming the spot. Re-run the grid after any edit and check the result in the game with
  `gv.place(npc, slot)` at `?dev=1` (H shows the horizon and head lines).
