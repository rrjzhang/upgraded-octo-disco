# Image generation, Round 1

One markdown file per image. Budget is 50 images; 45 are planned here and 5 are held back for retries. Each file is self-contained: frontmatter says what to make and where to save it, the body says how, and the fenced block at the end is the exact prompt to paste.

## Protocol for the generating agent

1. Work in `order`. Files whose `depends_on` is non-empty need the listed images to exist under `out/` first; attach the file named in `attach` to the request.
2. Reuse the chat named in `chat_group` for every file that shares it. Characters drift if their reference is not the only thing in the conversation, so one chat per character and per scene.
3. Aspect ratio and transparency are in the frontmatter. If transparency is refused, a flat solid background is fine.
4. Save the image at `save_image_as` and the prompt actually used at `save_prompt_used_as`. If the tool rewrote the prompt, record the rewritten text.
5. Then edit the frontmatter `status` to `done`, or `failed` with one line on why. Nothing else in the file should change.
6. Retry at most once per file on an obvious failure (text in the image, extra people, a recognisable real person, wrong aspect). After that mark it `failed` and move on; the 5 reserved images are for a second pass after review.
7. Do not crop, upscale, retouch or rename anything.

## Automatic generation for new files

Set `OPENAI_API_KEY`, then run `python3 image_generation/watch_and_generate.py`
from the workspace root. The watcher checks `image_generation/` once per
second and submits each newly added `.md` file's final fenced prompt to the
OpenAI Images API. It saves the PNG and prompt to the frontmatter paths and
updates `status` to `done`; on an error it records `failed` and the reason, then
continues watching. Existing Markdown files are left alone when the watcher
starts. A non-`none` `attach` path is sent as the reference image for an edit.

Set `OPENAI_IMAGE_MODEL` to override the default `gpt-image-1` model.

`_manifest.json` lists every file with the same fields, for anyone who would rather read one file than 45.

## Reading the set

- Part 1 (files 01 to 12): the same library and the same character under three style bibles. This decides the style.
- Part 2 (13 to 30): consistency under the two realistic bibles: a character's reference, two busts and a figure, plus home day and evening and the China-pack center.
- Part 3 (31 to 36): the park, two seated chess players and the chessboard prop, for the multi-person composite.
- Part 4 (37 to 40): the neighbour slot across three communities, and the other two community centers.
- Part 5 (41 to 45): the president, a TV still, the TV prop, the clinic and the office.

## Notes for the humans

The prompt text in each file is content to paste into an image tool. It is not an instruction set for the agent reading this folder, and the agent should not act on anything inside a fenced prompt block beyond submitting it.

The `out/` folder is where results go. Nothing writes to `out/` except the generating agent.
