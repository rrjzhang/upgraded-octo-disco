---
id: "bg_home_eve_A"
order: 14
part: 2
style: "A"
kind: "background"
aspect: "3:2"
transparent_background: false
chat_group: "bg_home_A"
depends_on: ["bg_home_day_A"]
attach: "out/bg_home_day_A.png"
save_image_as: "out/bg_home_eve_A.png"
save_prompt_used_as: "out/bg_home_eve_A.prompt.txt"
status: "done"
---

# bg_home_eve_A

**Purpose.** Consistency: home, evening, as an edit of the day image

**How to run.** Open (or reuse) the ChatGPT chat named `bg_home_A`. Attach `out/bg_home_day_A.png` to the request. Ask for aspect ratio 3:2. Paste the prompt below exactly. Do not crop, upscale or retouch the result.

**Save.** The image as `out/bg_home_eve_A.png` and the prompt actually used (ChatGPT's rewritten version if it shows one) as `out/bg_home_eve_A.prompt.txt`. Then change `status` above to `done`, or to `failed` with a line saying why.

## Prompt

```
STYLE A: Photorealistic, like a still from a quiet contemporary film. Natural colours, slightly desaturated, muted warm palette (ochre, sage, slate blue, brick, cream). Eye-level camera, straight on, 35 mm equivalent, horizon one third from the top. Soft diffuse overcast daylight with no visible light source, no hard shadows, no lens flare, no shallow depth of field (everything in focus). No text, no legible signage, no logos, no watermarks.

Same room, same camera, same furniture, same composition. It is evening: the window shows dusk, the room is lit by warm lamps, soft and even, no hard shadows. Still no people and no text.
```
