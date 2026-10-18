---
id: "bg_home_tv_eve_A"
order: 47
part: 6
style: "A"
kind: "background"
aspect: "3:2"
transparent_background: false
chat_group: "bg_home_A"
depends_on: ["bg_home_eve_A"]
attach: "out/bg_home_eve_A.png"
save_image_as: "out/bg_home_tv_eve_A.png"
save_prompt_used_as: "out/bg_home_tv_eve_A.prompt.txt"
status: "done"
---

# bg_home_tv_eve_A

**Purpose.** Round 2: home, evening, with the same wall-mounted TV in the same place

**How to run.** Open (or reuse) the ChatGPT chat named `bg_home_A`. Attach `out/bg_home_eve_A.png` to the request. Ask for aspect ratio 3:2. Paste the prompt below exactly. Do not crop, upscale or retouch the result.

**Save.** The image as `out/bg_home_tv_eve_A.png` and the prompt actually used (ChatGPT's rewritten version if it shows one) as `out/bg_home_tv_eve_A.prompt.txt`. Then change `status` above to `done`, or to `failed` with a line saying why.

## Prompt

```
STYLE A: Photorealistic, like a still from a quiet contemporary film. Natural colours, slightly desaturated, muted warm palette (ochre, sage, slate blue, brick, cream). Eye-level camera, straight on, 35 mm equivalent, horizon one third from the top. Soft diffuse overcast daylight with no visible light source, no hard shadows, no lens flare, no shallow depth of field (everything in focus). No text, no legible signage, no logos, no watermarks.

Using the attached image as the base: keep the room, every piece of furniture, the camera position, the framing and the evening lamp light exactly as they are (dusk in the window, warm lamps). Add one change only: a wall-mounted flat-screen television on the blank left wall, hung flush on a slim wall bracket, its screen dark and switched off (plain black glass with a faint soft reflection), and a low wooden media console standing on the floor against the wall directly beneath it. The television occupies roughly the upper-left quarter of the frame: its left edge about 6% of the image width in from the left edge, its top edge about 14% of the image height down from the top, its width about 24% of the image width, a 16:9 screen with a thin black bezel, mounted level and parallel to the wall in correct perspective. Nothing else changes. No people. No animals. No text, no logo on the television. Keep it evening, lit by the same warm lamps; the television screen stays dark.
```
