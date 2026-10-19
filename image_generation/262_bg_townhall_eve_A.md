---
id: "bg_townhall_eve_A"
order: 262
part: 18
style: "A"
kind: "background"
aspect: "3:2"
transparent_background: false
chat_group: "bg_townhall_A"
depends_on: []
attach: "none"
save_image_as: "out/bg_townhall_eve_A.png"
save_prompt_used_as: "out/bg_townhall_eve_A.prompt.txt"
status: "done"
---

# bg_townhall_eve_A

**Purpose.** Round 13: the town hall on the last evening (`scenes.yaml` scene `townhall`, hidden; the engine enters it from bed on day 5). A public library's meeting room set up for a governor's campaign town hall, seen from a seat in the second row, with a podium at the centre where the speaking leader's cut-out figure will stand (slot `podium`, feet at about 78% of the height, horizon at about 36%). No people: the audience is implied by the chairs and coats, so the engine can place one figure without clashes.

**How to run.** Open (or reuse) the ChatGPT chat named `bg_townhall_A`. Ask for aspect ratio 3:2 with a plain PNG. Paste the prompt below exactly. Do not crop, upscale or retouch the result.

**Save.** The image as `out/bg_townhall_eve_A.png` and the prompt actually used (ChatGPT's rewritten version if it shows one) as `out/bg_townhall_eve_A.prompt.txt`. Then change `status` above to `done`, or to `failed` with a line saying why.

## Prompt

```
STYLE A: Photorealistic, like a still from a quiet contemporary film. Natural colours, slightly desaturated, muted warm palette (ochre, sage, slate blue, brick, cream). Eye-level camera, straight on, 35 mm equivalent, horizon one third from the top. Soft diffuse overcast daylight with no visible light source, no hard shadows, no lens flare, no shallow depth of field (everything in focus). No text, no legible signage, no logos, no watermarks.

A public library's community meeting room on a weekday evening, photographed from a seat in the second row of folding chairs, the camera at seated eye level looking straight at the front of the room. Centre: a plain wooden podium with a small microphone, standing on a low carpeted dais about one step high, with open floor in front of it and nothing on it. Behind the podium a long folding table with two empty chairs, two paper cups and a water jug, and a cloth campaign banner in two muted colours hanging slightly crooked on the wall with no legible words, just blurred lettering shapes. Fluorescent ceiling panels and one warm floor lamp at the side; evening outside the tall windows on the right, dark blue with a street light. The rows of folding chairs in front of the camera are empty but used: a coat over a chair back, a tote bag on a seat, a folded flyer on the floor. A notice board with pinned sheets on the left wall, a book trolley in the corner. No people anywhere. No text that can be read. The podium and the dais occupy the middle of the frame with clear floor around them so a person can be composited standing behind the podium. Landscape 3:2.
```
