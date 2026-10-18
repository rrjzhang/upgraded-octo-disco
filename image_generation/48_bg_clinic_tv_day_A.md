---
id: "bg_clinic_tv_day_A"
order: 48
part: 6
style: "A"
kind: "background"
aspect: "3:2"
transparent_background: false
chat_group: "bg_clinic_A"
depends_on: ["bg_clinic_day_A"]
attach: "out/bg_clinic_day_A.png"
save_image_as: "out/bg_clinic_tv_day_A.png"
save_prompt_used_as: "out/bg_clinic_tv_day_A.prompt.txt"
status: "done"
---

# bg_clinic_tv_day_A

**Purpose.** Round 2: clinic waiting room with the wall-mounted TV built into the image

**How to run.** Open (or reuse) the ChatGPT chat named `bg_clinic_A`. Attach `out/bg_clinic_day_A.png` to the request. Ask for aspect ratio 3:2. Paste the prompt below exactly. Do not crop, upscale or retouch the result.

**Save.** The image as `out/bg_clinic_tv_day_A.png` and the prompt actually used (ChatGPT's rewritten version if it shows one) as `out/bg_clinic_tv_day_A.prompt.txt`. Then change `status` above to `done`, or to `failed` with a line saying why.

## Prompt

```
STYLE A: Photorealistic, like a still from a quiet contemporary film. Natural colours, slightly desaturated, muted warm palette (ochre, sage, slate blue, brick, cream). Eye-level camera, straight on, 35 mm equivalent, horizon one third from the top. Soft diffuse overcast daylight with no visible light source, no hard shadows, no lens flare, no shallow depth of field (everything in focus). No text, no legible signage, no logos, no watermarks.

Using the attached image as the base: keep the waiting room, the chairs, the counter, the water cooler, the pictures, the camera position, the framing and the light exactly as they are. Add one change only: a wall-mounted flat-screen television hung high in the upper-left corner of the room on a slim bracket, angled slightly toward the chairs, its screen dark and switched off (plain black glass). Its left edge about 2% of the image width in from the left edge, its top edge about 5% of the image height down from the top, its width about 15% of the image width, a 16:9 screen with a thin black bezel, in correct perspective. Nothing else changes. No people. No animals. No text, no logo on the television.
```
