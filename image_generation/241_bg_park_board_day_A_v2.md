---
id: "bg_park_board_day_A_v2"
order: 241
part: 16
style: "A"
kind: "background"
aspect: "3:2"
transparent_background: false
chat_group: "bg_park_A"
depends_on: ["bg_park_board_day_A"]
attach: "out/bg_park_board_day_A.png"
save_image_as: "out/bg_park_board_day_A_v2.png"
save_prompt_used_as: "out/bg_park_board_day_A_v2.prompt.txt"
status: "pending"
---

# bg_park_board_day_A_v2

**Purpose.** Round 11, a retake of the game in progress: in bg_park_board_day_A each piece is drawn correctly but there are too many of them for a chess set. This version asks for a late-game position with few pieces, named one by one, so the count is plausible. Saved as `_v2` beside the original; the asset build prefers the highest version present and nothing is overwritten. If the count still comes out wrong the original stays in use.

**How to run.** Open (or reuse) the ChatGPT chat named `bg_park_A`. Attach `out/bg_park_board_day_A.png` to the request. Ask for aspect ratio 3:2. Paste the prompt below exactly. Do not crop, upscale or retouch the result.

**Save.** The image as `out/bg_park_board_day_A_v2.png` and the prompt actually used (ChatGPT's rewritten version if it shows one) as `out/bg_park_board_day_A_v2.prompt.txt`. Then change `status` above to `done`, or to `failed` with a line saying why.

## Prompt

```
STYLE A: Photorealistic, like a still from a quiet contemporary film. Natural colours, slightly desaturated, muted warm palette (ochre, sage, slate blue, brick, cream). Eye-level camera, straight on, 35 mm equivalent, horizon one third from the top. Soft diffuse overcast daylight with no visible light source, no hard shadows, no lens flare, no shallow depth of field (everything in focus). No text, no legible signage, no logos, no watermarks.

Using the attached image as the base: change only the chess pieces on the nearest stone table, the square one in the left foreground. Clear the board and the stone beside it of all pieces, then place a late-game position with exactly nine pieces on the board and no others anywhere: for the light side a king, a rook and two pawns; for the dark side a king, a queen, a knight and two pawns. Each piece stands upright on its own square, ordinary wooden Staunton style, in the same perspective as the table, with a soft contact shadow consistent with the overcast light. The light king and the dark king are on opposite halves of the board; the pawns are on different squares in the middle rows; no two pieces share a square. Nothing stands on the stone beside the board. Keep everything else exactly as it is: the board flush in the table top with its squares readable, the table's shape, size and position, the benches, the other tables, the path, the fence, the trees, the camera position, the framing, the lighting and the colours. No people. No animals. Photoreal, matching the grain, sharpness and light of the rest of the photo. No text.
```
