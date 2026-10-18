---
id: "bg_home_eve_B"
order: 23
part: 2
style: "B"
kind: "background"
aspect: "3:2"
transparent_background: false
chat_group: "bg_home_B"
depends_on: ["bg_home_day_B"]
attach: "out/bg_home_day_B.png"
save_image_as: "out/bg_home_eve_B.png"
save_prompt_used_as: "out/bg_home_eve_B.prompt.txt"
status: "done"
---

# bg_home_eve_B

**Purpose.** Consistency: home, evening, as an edit of the day image

**How to run.** Open (or reuse) the ChatGPT chat named `bg_home_B`. Attach `out/bg_home_day_B.png` to the request. Ask for aspect ratio 3:2. Paste the prompt below exactly. Do not crop, upscale or retouch the result.

**Save.** The image as `out/bg_home_eve_B.png` and the prompt actually used (ChatGPT's rewritten version if it shows one) as `out/bg_home_eve_B.prompt.txt`. Then change `status` above to `done`, or to `failed` with a line saying why.

## Prompt

```
STYLE B: Painterly realism, like a contemporary digital matte painting: realistic proportions, materials and light, with soft visible brushwork and no outlines. Natural colours, slightly desaturated, muted warm palette (ochre, sage, slate blue, brick, cream). Eye-level camera, straight on, 35 mm equivalent, horizon one third from the top. Soft diffuse daylight with no visible light source and no hard shadows. No text, no legible signage, no logos, no watermarks. Not cartoonish, not cel-shaded, not photographic.

Same room, same camera, same furniture, same composition. It is evening: the window shows dusk, the room is lit by warm lamps, soft and even, no hard shadows. Still no people and no text.
```
