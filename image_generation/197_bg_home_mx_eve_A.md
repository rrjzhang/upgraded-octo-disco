---
id: "bg_home_mx_eve_A"
order: 197
part: 14
style: "A"
kind: "background"
aspect: "3:2"
transparent_background: false
chat_group: "bg_home_mx_A"
depends_on: ["bg_home_tv_eve_A"]
attach: "out/bg_home_tv_eve_A.png"
save_image_as: "out/bg_home_mx_eve_A.png"
save_prompt_used_as: "out/bg_home_mx_eve_A.prompt.txt"
status: "done"
---

# bg_home_mx_eve_A

**Purpose.** Round 9: the living room for the Mexican pack (evening), a gentle edit of the culture-neutral `bg_home_tv_eve_A` with three small culture-specific objects; the same three changes as the day request, in the evening light

**How to run.** Open (or reuse) the ChatGPT chat named `bg_home_mx_A`. Attach `out/bg_home_tv_eve_A.png` to the request. Ask for aspect ratio 3:2. Paste the prompt below exactly. Do not crop, upscale or retouch the result.

**Save.** The image as `out/bg_home_mx_eve_A.png` and the prompt actually used (ChatGPT's rewritten version if it shows one) as `out/bg_home_mx_eve_A.prompt.txt`. Then change `status` above to `done`, or to `failed` with a line saying why.

## Prompt

```
STYLE A: Photorealistic, like a still from a quiet contemporary film. Natural colours, slightly desaturated, muted warm palette (ochre, sage, slate blue, brick, cream). Eye-level camera, straight on, 35 mm equivalent, horizon one third from the top. Soft diffuse overcast daylight with no visible light source, no hard shadows, no lens flare, no shallow depth of field (everything in focus). No text, no legible signage, no logos, no watermarks.

Using the attached photo, change ONLY the following three things, keep everything else pixel-identical including the television and its screen, the window, the door, the furniture positions, the lighting: (1) on the coffee table, the small shallow wooden bowl next to the potted plant becomes a small shallow Talavera-style ceramic bowl of the same size, cream with a muted cobalt-blue and faded ochre hand-painted pattern. (2) the knitted sage-green throw draped over the right arm of the sofa becomes a woven cotton blanket of the same size and drape with faded, muted horizontal stripes in brick, ochre and cream. (3) on the bookshelf's middle shelf, the small ceramic vase becomes a small matte black-clay (barro negro) vase of the same size. Keep it evening, as in the attached evening photo, lit by the lamps (dusk in the window, warm lamp light); the three new objects are lit by the same warm lamp light. Each new object is small, ordinary and lived-in, the size of what it replaces; nothing is added anywhere else. The television stays dark and switched off. No people. No animals. No text, no logos.
```
