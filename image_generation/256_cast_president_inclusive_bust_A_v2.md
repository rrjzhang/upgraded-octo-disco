---
id: "cast_president_inclusive_bust_A_v2"
order: 256
part: 17
style: "A"
kind: "bust"
aspect: "1:1"
transparent_background: true
chat_group: "cast_president_inclusive_A"
depends_on: ["cast_president_inclusive_bust_A"]
attach: "out/cast_president_inclusive_ref_A.png"
save_image_as: "out/cast_president_inclusive_bust_A_v2.png"
save_prompt_used_as: "out/cast_president_inclusive_bust_A_v2.prompt.txt"
status: "done"  # generator noted a non-square canvas (about 1312x1199); accepted, the asset build crops busts to a square and the body no longer fades out
error: "Grey halo and non-square output remain after one retry."

# cast_president_inclusive_bust_A_v2

**Purpose.** Round 12, retake: President Lena Ortiz (the inclusive president) neutral bust. In the first take the lower part of the body fades out into transparency (the generator's mask dissolves the chest), which shows on the dialogue panel as a bite out of the portrait. Same person, same expression; the body must end at the bottom edge of the frame, not fade. Saved as `_v2` beside the original; the asset build prefers the highest version present and nothing is overwritten.

**How to run.** Open (or reuse) the ChatGPT chat named `cast_president_inclusive_A`. Attach `out/cast_president_inclusive_ref_A.png` to the request. Ask for aspect ratio 1:1 with a transparent background PNG. Paste the prompt below exactly. Do not crop, upscale or retouch the result. If the body still fades out at the bottom, or a grey backdrop or halo appears, ask once more; if it comes back the same, save it anyway and note it in the status line.

**Save.** The image as `out/cast_president_inclusive_bust_A_v2.png` and the prompt actually used (ChatGPT's rewritten version if it shows one) as `out/cast_president_inclusive_bust_A_v2.prompt.txt`. Then change `status` above to `done`, or to `failed` with a line saying why.

## Prompt

```
STYLE A: Photorealistic, like a still from a quiet contemporary film. Natural colours, slightly desaturated, muted warm palette (ochre, sage, slate blue, brick, cream). Eye-level camera, straight on, 35 mm equivalent, horizon one third from the top. Soft diffuse overcast daylight with no visible light source, no hard shadows, no lens flare, no shallow depth of field (everything in focus). No text, no legible signage, no logos, no watermarks.

Photographic face realism: natural skin texture, no retouching, no studio glamour.

Using the attached reference image: the same person, same face, same hair, same clothes. Head-and-shoulders portrait, facing the viewer, eyes on the camera, soft even light from the front, fully transparent background. Framing: head and shoulders down to mid-chest, the body cut off cleanly by the bottom edge of the image, never faded, blurred or dissolved toward the bottom. Fully transparent background: a clean cut-out of the person with crisp edges, no backdrop, no grey or white glow around them, no vignette, no halo. Expression: relaxed face, mouth closed, no smile, calm eyes. No text.
```
