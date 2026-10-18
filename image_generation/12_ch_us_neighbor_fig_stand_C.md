---
id: "ch_us_neighbor_fig_stand_C"
order: 12
part: 1
style: "C"
kind: "figure"
aspect: "2:3"
transparent_background: true
chat_group: "ch_us_neighbor_C"
depends_on: ["ch_us_neighbor_ref_C"]
attach: "out/ch_us_neighbor_ref_C.png"
save_image_as: "out/ch_us_neighbor_fig_stand_C.png"
save_prompt_used_as: "out/ch_us_neighbor_fig_stand_C.prompt.txt"
status: "done"
---

# ch_us_neighbor_fig_stand_C

**Purpose.** Style comparison: Dana's in-scene figure on green, to paste into the library at game scale

**How to run.** Open (or reuse) the ChatGPT chat named `ch_us_neighbor_C`. Attach `out/ch_us_neighbor_ref_C.png` to the request. Ask for aspect ratio 2:3 with a transparent background PNG (a flat solid colour is acceptable if transparency is refused). Paste the prompt below exactly. Do not crop, upscale or retouch the result.

**Save.** The image as `out/ch_us_neighbor_fig_stand_C.png` and the prompt actually used (ChatGPT's rewritten version if it shows one) as `out/ch_us_neighbor_fig_stand_C.prompt.txt`. Then change `status` above to `done`, or to `failed` with a line saying why.

## Prompt

```
STYLE C: Clean contemporary illustration, flat cel shading with soft edges, no outlines heavier than a pencil line, matte colours, muted warm palette (ochre, sage, slate blue, brick, cream), no gradients or glow. Eye-level camera, straight on, 35 mm equivalent, horizon one third from the top. Soft diffuse daylight with no visible light source and no hard shadows. No text, no signage with legible words, no logos, no watermarks. Nothing photographic. Consistent with a narrative life-sim game.

Using the attached reference image: the same person, same clothes, same hair. Full body, standing at ease in a three-quarter turn toward the viewer's left, weight on one leg, hands relaxed, neutral expression, feet visible, no cast shadow, on a plain flat bright green background. No text.
```
