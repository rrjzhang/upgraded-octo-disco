# Great Vote demo

A scene-based life-sim that doubles as a bicultural-identity research instrument. Plain TypeScript + Vite, no framework. All game content is data under `public/content/` (YAML and CSV), all art under `public/assets/`, and a checker proves the dialogue sheets are complete and reachable before anything ships.

## Run it

```bash
cd demo
npm install          # once
npm run dev          # http://localhost:5173
```

- `/?dev=1` drops straight into day 1 at home (room `DEV1`, enforcement condition). Add `&reset=1` to wipe the save (the flag is then dropped from the address so a reload resumes), `&leader=inclusive`, `&culture=mx|in`, `&name=Alex`, `&eod=<url>` to load the end-of-day questionnaire from a URL (logged as `source: "room"`).
- `/` is the participant entry: room code and password, then character setup.
- `/researcher.html` creates rooms (randomised parameters, every field editable), lists rooms on this computer with their day reached, exports a room's action log as JSON lines, and has the "Show debugging aids" switch.
- `/?fixtures=1` loads a tiny built-in test world instead of the real content.

In dev mode `window.gv` exposes helpers: `gv.goto('library')`, `gv.talk('us_neighbor')`, `gv.set('cn_leader_sep','rapport',2)`, `gv.lean(8,1)`, `gv.actions(0)`, `gv.endDay()`, `gv.present()`, `gv.cost('us_neighbor')` (0 = a short, free conversation), `gv.order('DN01')` (today's choice order), `gv.override()` (what the researcher override changed), `gv.place('cn_leader_sep','near')` (in memory only, never saved).

### Researcher edits (overrides)

`/editor.html` saves edits without a rebuild: text in `localStorage['gv:override:v1']` (`{ v:1, updated, dialogue:{<npcId>:<csv>}, news, events, npcs, scenes }`, each key optional and replacing that whole file) and images in IndexedDB `gv` / `images` under `portraits/<npcId>/<neutral|warm|guarded|worried>`, `figures/<figure asset id>`, `backgrounds/<bg id>`, `tv/<nat_enforcement|nat_inclusive>/<index>`, `cast/<castId>/<bust|tv>`. The game parses an override with the same parser and validation as the bundled file; a file that fails validation is skipped (console warning, the bundled file is used) and the "edited content" chip in the top bar turns red with the problem in its tooltip. The chip shows whenever an override is active. `&nooverride=1` loads the bundled files only. Overrides are per browser.

### Rules added 2026-10-18

- Choices are shown in a deterministic shuffled order per (room seed, row id, day); log lines keep `choice` = authored index and add `shown` = displayed position.
- A conversation whose opening row has depth < 3 over the `next` chain (a cycle counts as 3) is free: no cost dot, 0 actions. Talking still needs at least one action left in the day.
- NPC presence rolls are per (room seed, day, scene, NPC id, slot), so editing or reordering `npcs.yaml` never moves anyone else; when two people roll into one slot the lower roll wins.
- An event from someone who is not in the scene is labelled by how it arrives ("Invitation from Dr. Helen Zhou", "Call from …"). An event on screen and the ones queued behind it survive a reload.
- Cast (authority figures): `news.csv` `figure` and `events.csv` `portrait` name a cast id (`content/cast.yaml`). TV shows that person's still, print news shows the bust beside the headline, an event shows the bust in the portrait panel; without art each shows PLACEHOLDER.
- Debugging aids (Show interactables and H, the rule/lean/phase line, rapport and valence in Contacts, figure guides) are off unless the researcher page's "Show debugging aids" switch is on (`localStorage['gv:settings'].debug`) or the URL has `?dev=1`.

## Editor

`/editor.html` lets a researcher edit content in the browser without a rebuild (SPEC "Researcher editing, overrides and casting").

- **Dialogue**: pick an NPC; its sheet is an editable table (id, the six conditions, priority, emotion, line, three choices with effect and next). Row actions: add, duplicate, move up/down, delete (refused while another row's `next` points at it), and `+↳` on a choice to add a follow-up row (priority -1, met yes) linked from that choice. The side panel runs the checker core (`tools/checker/core.mjs`) live: schema errors, missing fallback, dangling next, ties, coverage, unreachable and never-winning rows, the witness path for the selected row, and a conversation tree (entry rows and their follow-up chains, with turn and depth). Rows and cells with problems get badges.
- **Events / News**: the same table treatment for `events.csv` and `news.csv`, including the optional cast columns (`portrait`, `figure`).
- **Images**: every slot the game draws (busts per expression, figures, backgrounds incl. evening and painted variants, TV stills, cast bust/TV). Upload a PNG/JPEG, see its pixel size and shape warnings, preview at game size, revert.
- **Save** writes only files that differ from the bundled ones to `localStorage['gv:override:v1']` and images to IndexedDB `gv`/`images` (keys like `portraits/us_neighbor/warm`). The game applies them on load and shows an "edited content" chip; `?dev=1&nooverride=1` ignores them. Overrides live in this browser only.
- **Export** downloads each changed file (`us_neighbor.csv`, `events.csv`, PNGs named after their manifest file) to commit into `public/content` and `image_generation/out`. **Revert** per file or image (in the table toolbar or under Changes); **Revert all** clears the override key and every image key. **Copy override JSON** gives the `{ text, imageKeys }` snapshot for a room config. Leaving with unsaved changes asks first; Ctrl/Cmd+S saves.

## Check the content

```bash
npm run check        # node tools/checker/check.mjs
open tools/checker/report/index.html
```

Validates every sheet against the schema in `SPEC.md`, enumerates all 432 parameter cells per NPC to find ties, shadowed rows and fallback-only cells, and searches the transition graph for the cheapest path to every row (unreachable rows and rows over the 40-action budget are flagged, with a witness path for each reachable row). `node tools/checker/test.mjs` runs the fixture suite.

## Rebuild the art

```bash
npm run assets       # node tools/assets/build.mjs
```

Regenerates `public/assets/**` and `manifest.json` from `../image_generation/out/`. Characters without generated art get silhouette placeholders and are tagged "art pending" in the game. Cast members (authority figures listed in `public/content/cast.yaml`) get `manifest.cast[<id>] = { name, role, bust, tv, ref }` from `cast_<id>_{ref,bust,tv}_A.png`. See `tools/assets/README.md` for the mapping.

## Where things live

| Path | What |
| --- | --- |
| `SPEC.md` | The build contract: layout, rules, schemas, manifest shape, window-module API |
| `src/` | Engine: `game.ts` (scene, dialogue, events, phone, windows), `rules.ts` (row selection, effects, lean, phases), `content.ts` (loading and validation), `store.ts` (save and action log), `researcher.ts` |
| `public/modules/` | `tv.html`, `work.html`, `survey.html`, loaded in an iframe and driven by `postMessage` |
| `public/content/` | `scenes.yaml`, `npcs.yaml`, `dialogue/<npc>.csv`, `events.csv`, `news.csv`, `questionnaire/eod.json` |
| `public/assets/` | Processed backgrounds, portraits, figures, props, TV stills and `manifest.json` |
| `tools/checker/` | Completeness and reachability checker (`core.mjs` pure checks shared with the editor, `check.mjs` CLI), fixtures, HTML report |
| `editor.html`, `src/editor/` | Researcher content editor |
| `tools/assets/` | Asset build script |

## Art conventions

- The word **PLACEHOLDER** appears wherever an image is missing: grey silhouettes for people, a dashed box over a hotspot flagged `placeholder: true` (the living-room and clinic TVs until the Round 2 backgrounds land), the TV still, and a flat panel for a missing background.
- Figures are sized from each scene's `horizon` (and optional `cameraHeight`) in `scenes.yaml`: a standing adult's head lands just above the eye-level line wherever they stand. Each scene has a `near` slot for the person the player is there to talk to (feet at or just below the bottom edge); overheard or incidental people stand further back. In dev mode, H also shows the horizon and each figure's head line, and `gv.place('cn_leader_sep','near')` puts someone on a slot to check the size.
- A scene can declare a `painted` background variant with some NPCs generated into the image (the park with its two chess players). It switches on by itself once `bg_park_chess_day` exists in the manifest; the NPCs are then reached through `talk` hotspots. Adjust those zones to the generated figures.
- End-of-day survey: BIIS-2 (Bicultural Identity Integration Scale, version 2), 17 items, scored in the module and logged with each submission; see `public/content/questionnaire/README.md`.

## Known gaps

- No server. Rooms, saves and the action log live in `localStorage`; the engine already attempts `POST /api/log` and ignores failures, so a server can be added without touching the client.
- Seven roster characters (Kelsey, Ruth Hale, Gary Pruitt, Mrs. Chen, Jia, Dr. Zhou, the inclusive-condition president) have no generated art yet and show as silhouettes.
- Mexico and India packs are selectable but fall back to the China roster with a banner.
