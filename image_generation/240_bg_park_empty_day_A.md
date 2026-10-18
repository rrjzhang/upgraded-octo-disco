---
id: "bg_park_empty_day_A"
order: 240
part: 16
style: "A"
kind: "background"
aspect: "3:2"
transparent_background: false
chat_group: "bg_park_A"
depends_on: ["bg_park_board_day_A"]
attach: "out/bg_park_board_day_A.png"
save_image_as: "out/bg_park_empty_day_A.png"
save_prompt_used_as: "out/bg_park_empty_day_A.prompt.txt"
status: "pending"
---

# bg_park_empty_day_A

**Purpose.** Round 11: the park with the chessboard empty, for the moments nobody sits at the table (the game in progress, bg_park_board_day_A, is shown only while a chess player is present). An edit of the game-in-progress image so the two match exactly apart from the pieces.

**How to run.** Open (or reuse) the ChatGPT chat named `bg_park_A`. Attach `out/bg_park_board_day_A.png` to the request. Ask for aspect ratio 3:2. Paste the prompt below exactly. Do not crop, upscale or retouch the result.

**Save.** The image as `out/bg_park_empty_day_A.png` and the prompt actually used (ChatGPT's rewritten version if it shows one) as `out/bg_park_empty_day_A.prompt.txt`. Then change `status` above to `done`, or to `failed` with a line saying why.

## Prompt

```
STYLE A: Photorealistic, like a still from a quiet contemporary film. Natural colours, slightly desaturated, muted warm palette (ochre, sage, slate blue, brick, cream). Eye-level camera, straight on, 35 mm equivalent, horizon one third from the top. Soft diffuse overcast daylight with no visible light source, no hard shadows, no lens flare, no shallow depth of field (everything in focus). No text, no legible signage, no logos, no watermarks.

Using the attached image as the base: remove every chess piece from the nearest stone table, the square one in the left foreground, including the captured pieces standing on the stone beside the board. Leave the chessboard itself exactly as it is, inlaid flush in the table top, its light and dark squares clearly readable, with nothing standing on it. Where a piece stood, show the stone or the board square that was under it, matching the surrounding surface. Keep everything else exactly as it is: the table's shape, size and position, the benches, the other tables, the path, the fence, the trees, the camera position, the framing, the lighting and the colours. No people. No animals. Photoreal, matching the grain, sharpness and light of the rest of the photo. No text.
```
