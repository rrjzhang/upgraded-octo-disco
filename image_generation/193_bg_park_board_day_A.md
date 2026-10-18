---
id: "bg_park_board_day_A"
order: 193
part: 13
style: "A"
kind: "background"
aspect: "3:2"
transparent_background: false
chat_group: "bg_park_A"
depends_on: ["bg_park_day_A"]
attach: "out/bg_park_day_A.png"
save_image_as: "out/bg_park_board_day_A.png"
save_prompt_used_as: "out/bg_park_board_day_A.prompt.txt"
status: "done"
---

# bg_park_board_day_A

**Purpose.** Round 8: the empty park (Mexican and Indian packs) with a chess game in progress baked into the top of the nearest stone table, replacing the cut-out chessboard prop that was warped onto the photo and looked pasted on (too big, rotated 45 degrees, flat pieces)

**How to run.** Open (or reuse) the ChatGPT chat named `bg_park_A`. Attach `out/bg_park_day_A.png` to the request. Ask for aspect ratio 3:2. Paste the prompt below exactly. Do not crop, upscale or retouch the result.

**Save.** The image as `out/bg_park_board_day_A.png` and the prompt actually used (ChatGPT's rewritten version if it shows one) as `out/bg_park_board_day_A.prompt.txt`. Then change `status` above to `done`, or to `failed` with a line saying why.

## Prompt

```
STYLE A: Photorealistic, like a still from a quiet contemporary film. Natural colours, slightly desaturated, muted warm palette (ochre, sage, slate blue, brick, cream). Eye-level camera, straight on, 35 mm equivalent, horizon one third from the top. Soft diffuse overcast daylight with no visible light source, no hard shadows, no lens flare, no shallow depth of field (everything in focus). No text, no legible signage, no logos, no watermarks.

Using the attached image as the base: change only the top of the nearest stone table, the square one in the left foreground. Show a chess game in progress on it. Its top already has a faint chessboard inlaid in the stone: keep that board exactly where it is, flush with the table top and inside a margin of stone all round, its edges parallel to the table's own edges, in the same perspective as the table, and make its light and dark squares clearly readable. On the board, ordinary wooden Staunton-style chess pieces, light and dark, standing upright mid-game, about two dozen of them spread over the board as in a real game, each piece casting a soft contact shadow consistent with the overcast light, seen in the same perspective as the table. A few captured pieces stand on the stone beside the board. Keep everything else exactly as it is: the table's shape, size and position, the benches, the other tables, the path, the fence, the trees, the camera position, the framing, the lighting and the colours. No people. No animals. Photoreal, matching the grain, sharpness and light of the rest of the photo. No text.
```
