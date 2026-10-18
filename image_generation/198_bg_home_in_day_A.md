---
id: "bg_home_in_day_A"
order: 198
part: 14
style: "A"
kind: "background"
aspect: "3:2"
transparent_background: false
chat_group: "bg_home_in_A"
depends_on: ["bg_home_tv_day_A"]
attach: "out/bg_home_tv_day_A.png"
save_image_as: "out/bg_home_in_day_A.png"
save_prompt_used_as: "out/bg_home_in_day_A.prompt.txt"
status: "done"
---

# bg_home_in_day_A

**Purpose.** Round 9: the living room for the Indian pack (day), a gentle edit of the culture-neutral `bg_home_tv_day_A` with three small culture-specific objects; the TV and its screen must not move (the engine projects the news onto that exact quad)

**How to run.** Open (or reuse) the ChatGPT chat named `bg_home_in_A`. Attach `out/bg_home_tv_day_A.png` to the request. Ask for aspect ratio 3:2. Paste the prompt below exactly. Do not crop, upscale or retouch the result.

**Save.** The image as `out/bg_home_in_day_A.png` and the prompt actually used (ChatGPT's rewritten version if it shows one) as `out/bg_home_in_day_A.prompt.txt`. Then change `status` above to `done`, or to `failed` with a line saying why.

## Prompt

```
STYLE A: Photorealistic, like a still from a quiet contemporary film. Natural colours, slightly desaturated, muted warm palette (ochre, sage, slate blue, brick, cream). Eye-level camera, straight on, 35 mm equivalent, horizon one third from the top. Soft diffuse overcast daylight with no visible light source, no hard shadows, no lens flare, no shallow depth of field (everything in focus). No text, no legible signage, no logos, no watermarks.

Using the attached photo, change ONLY the following three things, keep everything else pixel-identical including the television and its screen, the window, the door, the furniture positions, the lighting: (1) on the bookshelf's middle shelf, the small ceramic vase becomes a small unlit brass oil lamp (diya) on a tiny brass stand, about the same size, with a soft dull shine. (2) the cream-and-blue striped cushion in the middle of the sofa gets a cotton cushion cover of the same size with a small, muted hand-block-printed floral pattern in faded indigo and rust on cream. (3) on the coffee table, the small trailing pothos in the cream pot becomes a small bushy holy basil (tulsi) plant in a plain terracotta pot of the same size. Each new object is small, ordinary and lived-in, the size of what it replaces; nothing is added anywhere else. The television stays dark and switched off. No people. No animals. No text, no logos.
```
