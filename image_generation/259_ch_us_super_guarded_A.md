---
id: "ch_us_super_guarded_A"
order: 259
part: 18
style: "A"
kind: "bust"
aspect: "1:1"
transparent_background: true
chat_group: "ch_us_super_A"
depends_on: ["ch_us_super_ref_A"]
attach: "out/ch_us_super_ref_A.png"
save_image_as: "out/ch_us_super_guarded_A.png"
save_prompt_used_as: "out/ch_us_super_guarded_A.prompt.txt"
status: "done"
---

# ch_us_super_guarded_A

**Purpose.** Round 13: Vic Hollis (`us_super`) guarded bust. He has only three busts (neutral, guarded, worried): the engine never shows him warm.

**How to run.** Open (or reuse) the ChatGPT chat named `ch_us_super_A`. Attach `out/ch_us_super_ref_A.png` to the request. Ask for aspect ratio 1:1 with a transparent background PNG. Paste the prompt below exactly. Do not crop, upscale or retouch the result. If the result shows a grey or white backdrop, a soft grey glow or a blocky halo around the person instead of clean transparency, or the body fades out at the bottom, ask once more; if it comes back the same, save it anyway and note it in the status line.

**Save.** The image as `out/ch_us_super_guarded_A.png` and the prompt actually used (ChatGPT's rewritten version if it shows one) as `out/ch_us_super_guarded_A.prompt.txt`. Then change `status` above to `done`, or to `failed` with a line saying why.

## Prompt

```
STYLE A: Photorealistic, like a still from a quiet contemporary film. Natural colours, slightly desaturated, muted warm palette (ochre, sage, slate blue, brick, cream). Eye-level camera, straight on, 35 mm equivalent, horizon one third from the top. Soft diffuse overcast daylight with no visible light source, no hard shadows, no lens flare, no shallow depth of field (everything in focus). No text, no legible signage, no logos, no watermarks.

Photographic face realism: natural skin texture, no retouching, no studio glamour.

Using the attached reference image: the same person, same face, same hair, same clothes. Head-and-shoulders portrait, facing the viewer, eyes on the camera, soft even light from the front. Expression: guarded, the jaw set, lips pressed thin, eyes slightly narrowed, a small frown, as if he has heard this excuse before. No anger, no smile. Fully transparent background: a clean cut-out of the person with crisp edges, no backdrop, no grey or white glow around them, no vignette, no halo. Framing: head and shoulders down to mid-chest, the body cut off cleanly by the bottom edge of the image, never faded, blurred or dissolved toward the bottom. No text.
```
