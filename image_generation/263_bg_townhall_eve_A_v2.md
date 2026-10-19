---
id: "bg_townhall_eve_A_v2"
order: 263
part: 19
style: "A"
kind: "background"
aspect: "3:2"
transparent_background: false
chat_group: "bg_townhall_A"
depends_on: ["bg_townhall_eve_A"]
attach: "out/bg_townhall_eve_A.png"
save_image_as: "out/bg_townhall_eve_A_v2.png"
save_prompt_used_as: "out/bg_townhall_eve_A_v2.prompt.txt"
status: "done"
---

# bg_townhall_eve_A_v2

**Purpose.** Round 14, an edit of the town hall room: an American flag instead of the two-colour campaign banner, and the folding chairs filled with an audience seen from behind. The engine crops the podium out of this image (x 0.452-0.556, y 0.29-0.527 of the frame) to draw it in front of the speaker, so the podium, the dais and the table must stay exactly where they are and nobody in the audience may overlap the podium or the floor in front of it.

**How to run.** Open (or reuse) the ChatGPT chat named `bg_townhall_A`. Attach `out/bg_townhall_eve_A.png` to the request. Ask for aspect ratio 3:2, plain PNG. Paste the prompt below exactly. Do not crop, upscale or retouch the result.

**Save.** The image as `out/bg_townhall_eve_A_v2.png` and the prompt actually used (ChatGPT's rewritten version if it shows one) as `out/bg_townhall_eve_A_v2.prompt.txt`. Then change `status` above to `done`, or to `failed` with a line saying why.

## Prompt

```
STYLE A: Photorealistic, like a still from a quiet contemporary film. Natural colours, slightly desaturated, muted warm palette (ochre, sage, slate blue, brick, cream). Eye-level camera, straight on, 35 mm equivalent, horizon one third from the top. Soft diffuse overcast daylight with no visible light source, no hard shadows, no lens flare, no shallow depth of field (everything in focus). No text, no legible signage, no logos, no watermarks.

Using the attached image as the base, make two changes. First, replace the cloth banner hanging on the wall behind the podium with a United States flag, hung flat on the same wall at the same place and about the same size, stars at the upper left as seen by the viewer, slightly uneven at one corner as if pinned by hand; remove the banner entirely. Second, fill the rows of folding chairs with an ordinary small-town audience of about twenty people seen from behind and slightly above, as from a seat in the second row: backs of heads, shoulders, coats and cardigans, one or two hats, varied ages, hair and skin, a couple of people turned a little toward a neighbour; nobody faces the camera, no faces visible, nobody standing. Leave the centre aisle clear and leave the dais, the podium, the floor directly in front of the dais and the table completely uncovered: no head, hat or shoulder may rise in front of the podium or the dais. Keep everything else exactly as it is: the podium and its microphone, the carpeted dais, the folding table with its two chairs, the paper cups and water jug, the floor lamp, the notice board, the book trolley, the windows and the evening light, the rows of folding chairs, the coat and the tote bag, the camera position, the framing, the lighting and the colours. No people. No text that can be read. Landscape 3:2.
```
