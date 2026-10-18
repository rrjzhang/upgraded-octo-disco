---
id: "ch_us_stranger_a_neutral_A"
order: 237
part: 16
style: "A"
kind: "bust"
aspect: "1:1"
transparent_background: true
chat_group: "ch_us_stranger_a_A"
depends_on: ["ch_us_stranger_a_ref_A"]
attach: "out/ch_us_stranger_a_ref_A.png"
save_image_as: "out/ch_us_stranger_a_neutral_A.png"
save_prompt_used_as: "out/ch_us_stranger_a_neutral_A.prompt.txt"
status: "pending"
---

# ch_us_stranger_a_neutral_A

**Purpose.** Round 11, the four neutral busts still missing: Walt neutral bust (until now cropped from the reference sheet, a different framing from the other three busts)

**How to run.** Open (or reuse) the ChatGPT chat named `ch_us_stranger_a_A`. Attach `out/ch_us_stranger_a_ref_A.png` to the request. Ask for aspect ratio 1:1 with a transparent background PNG. Paste the prompt below exactly. Do not crop, upscale or retouch the result. If the result shows a grey or white backdrop, a soft grey glow or a blocky halo around the person instead of clean transparency, ask once more for a clean cut-out on a fully transparent background; if it comes back the same, save it anyway and note the halo in the status line.

**Save.** The image as `out/ch_us_stranger_a_neutral_A.png` and the prompt actually used (ChatGPT's rewritten version if it shows one) as `out/ch_us_stranger_a_neutral_A.prompt.txt`. Then change `status` above to `done`, or to `failed` with a line saying why.

## Prompt

```
STYLE A: Photorealistic, like a still from a quiet contemporary film. Natural colours, slightly desaturated, muted warm palette (ochre, sage, slate blue, brick, cream). Eye-level camera, straight on, 35 mm equivalent, horizon one third from the top. Soft diffuse overcast daylight with no visible light source, no hard shadows, no lens flare, no shallow depth of field (everything in focus). No text, no legible signage, no logos, no watermarks.

Photographic face realism: natural skin texture, no retouching, no studio glamour.

Using the attached reference image: the same person, same face, same hair, same clothes. Head-and-shoulders portrait, facing the viewer, eyes on the camera, soft even light from the front. Expression: relaxed face, mouth closed, no smile, calm eyes. Fully transparent background: a clean cut-out of the person with crisp edges, no backdrop, no grey or white glow around them, no vignette, no halo. No text.
```
