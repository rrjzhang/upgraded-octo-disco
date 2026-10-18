---
id: "bg_park_chess_day_A"
order: 49
part: 6
style: "A"
kind: "background"
aspect: "3:2"
transparent_background: false
chat_group: "bg_park_A"
depends_on: ["park_chess_base"]
attach: "ref/park_chess_base.png"
save_image_as: "out/bg_park_chess_day_A.png"
save_prompt_used_as: "out/bg_park_chess_day_A.prompt.txt"
status: "done"
---

# bg_park_chess_day_A

**Purpose.** Round 2: park with the two chess players genuinely seated at the nearest table (edit of the current composite)

**How to run.** Open (or reuse) the ChatGPT chat named `bg_park_A`. Attach `ref/park_chess_base.png` to the request. Ask for aspect ratio 3:2. Paste the prompt below exactly. Do not crop, upscale or retouch the result.

**Save.** The image as `out/bg_park_chess_day_A.png` and the prompt actually used (ChatGPT's rewritten version if it shows one) as `out/bg_park_chess_day_A.prompt.txt`. Then change `status` above to `done`, or to `failed` with a line saying why.

## Prompt

```
STYLE A: Photorealistic, like a still from a quiet contemporary film. Natural colours, slightly desaturated, muted warm palette (ochre, sage, slate blue, brick, cream). Eye-level camera, straight on, 35 mm equivalent, horizon one third from the top. Soft diffuse overcast daylight with no visible light source, no hard shadows, no lens flare, no shallow depth of field (everything in focus). No text, no legible signage, no logos, no watermarks.

Photographic face realism: natural skin texture, no retouching, no studio glamour.

Using the attached image as the base: keep the park, the trees, the fence, the path, the other tables, the camera position, the framing and the overcast light exactly as they are, and keep the nearest stone chess table where it is. Repaint the two men so they are genuinely seated on the fixed benches on either side of the nearest table, facing each other across it, mid-game: a chessboard with pieces lying flat on the table top between them, bodies turned toward the board, forearms or hands near the board, one reaching to move a piece, feet flat on the ground, with soft contact shadows under them and the table consistent with the overcast light. Remove the pasted wooden stools, the upright chessboard and the grey placeholder silhouette with its label; where they were, show the paving and the park as it naturally continues. Keep each man's face, age, hair and clothes as in the attachment: the man on the left: a Chinese-American man in his late sixties, lean, short grey hair, lined tan skin, clean-shaven, dark-green zip jacket over a checked shirt, grey trousers, black sneakers; the man on the right: a white American man in his late sixties, lean, close-cropped white hair, weathered light skin, clean-shaven, faded navy windbreaker over a grey flannel shirt, khaki trousers, brown walking shoes. No other people. No animals. No text.
```
