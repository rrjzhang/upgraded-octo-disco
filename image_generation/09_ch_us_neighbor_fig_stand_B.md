---
id: "ch_us_neighbor_fig_stand_B"
order: 9
part: 1
style: "B"
kind: "figure"
aspect: "2:3"
transparent_background: true
chat_group: "ch_us_neighbor_B"
depends_on: ["ch_us_neighbor_ref_B"]
attach: "out/ch_us_neighbor_ref_B.png"
save_image_as: "out/ch_us_neighbor_fig_stand_B.png"
save_prompt_used_as: "out/ch_us_neighbor_fig_stand_B.prompt.txt"
status: "done"
---

# ch_us_neighbor_fig_stand_B

**Purpose.** Style comparison: Dana's in-scene figure on green, to paste into the library at game scale

**How to run.** Open (or reuse) the ChatGPT chat named `ch_us_neighbor_B`. Attach `out/ch_us_neighbor_ref_B.png` to the request. Ask for aspect ratio 2:3 with a transparent background PNG (a flat solid colour is acceptable if transparency is refused). Paste the prompt below exactly. Do not crop, upscale or retouch the result.

**Save.** The image as `out/ch_us_neighbor_fig_stand_B.png` and the prompt actually used (ChatGPT's rewritten version if it shows one) as `out/ch_us_neighbor_fig_stand_B.prompt.txt`. Then change `status` above to `done`, or to `failed` with a line saying why.

## Prompt

```
STYLE B: Painterly realism, like a contemporary digital matte painting: realistic proportions, materials and light, with soft visible brushwork and no outlines. Natural colours, slightly desaturated, muted warm palette (ochre, sage, slate blue, brick, cream). Eye-level camera, straight on, 35 mm equivalent, horizon one third from the top. Soft diffuse daylight with no visible light source and no hard shadows. No text, no legible signage, no logos, no watermarks. Not cartoonish, not cel-shaded, not photographic.

Photographic face realism: natural skin texture, no retouching, no studio glamour.

Using the attached reference image: the same person, same clothes, same hair. Full body, standing at ease in a three-quarter turn toward the viewer's left, weight on one leg, hands relaxed, neutral expression, feet visible, no cast shadow, on a plain flat bright green background. No text.
```
