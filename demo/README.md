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

In dev mode `window.gv` exposes helpers: `gv.goto('library')`, `gv.talk('us_neighbor')`, `gv.set('cn_leader_sep','rapport',2)`, `gv.lean(8,1)`, `gv.actions(0)`, `gv.endDay()`, `gv.present()`, `gv.cost('us_neighbor')` (0 = a short, free conversation), `gv.order('DN01')` (today's choice order), `gv.override()` (what the researcher override changed), `gv.place('cn_leader_sep','near')` (in memory only, never saved), `gv.talk('us_neighbor', {force:true})` (ignores the per-day conversation limit), `gv.talks()` (today's conversations per NPC and the limit), `gv.screens('home', [[x,y],[x,y],[x,y],[x,y]])` (a TV quad for a scene, in memory; `null` clears), `gv.propQuad('park', 'prop_chessboard', [[x,y],[x,y],[x,y],[x,y]])` (projects a prop onto a quad, in memory; `null` draws it flat, no quad drops the override). `&talks=N` raises the conversation limit for the tab (default 1).

### Researcher edits (overrides)

`/editor.html` saves edits without a rebuild: text in `localStorage['gv:override:v1']` (`{ v:1, updated, dialogue:{<npcId>:<csv>}, news, events, npcs, scenes }`, each key optional and replacing that whole file) and images in IndexedDB `gv` / `images` under `portraits/<npcId>/<neutral|warm|guarded|worried>`, `figures/<figure asset id>`, `backgrounds/<bg id>`, `tv/<nat_enforcement|nat_inclusive>/<index>`, `cast/<castId>/<bust|tv>`. The game parses an override with the same parser and validation as the bundled file; a file that fails validation is skipped (console warning, the bundled file is used) and the "edited content" chip in the top bar turns red with the problem in its tooltip. The chip shows whenever an override is active. `&nooverride=1` loads the bundled files only. Overrides are per browser.

### Rules added 2026-10-18

- Choices are shown in a deterministic shuffled order per (room seed, row id, day); log lines keep `choice` = authored index and add `shown` = displayed position.
- A conversation whose opening row has depth < 3 over the `next` chain (a cycle counts as 3) is free: no cost dot, 0 actions. Talking still needs at least one action left in the day.
- NPC presence rolls are per (room seed, day, scene, NPC id, slot), so editing or reordering `npcs.yaml` never moves anyone else; when two people roll into one slot the lower roll wins.
- An event from someone who is not in the scene is labelled by how it arrives ("Invitation from Dr. Helen Zhou", "Call from …"). An event on screen and the ones queued behind it survive a reload.
- Cast (authority figures): `news.csv` `figure` and `events.csv` `portrait` name a cast id (`content/cast.yaml`). TV shows that person's still, print news shows the bust beside the headline, an event shows the bust in the portrait panel; without art each shows PLACEHOLDER.
- Debugging aids (Show interactables and H, the rule/lean/phase line, rapport and valence in Contacts, figure guides) are off unless the researcher page's "Show debugging aids" switch is on (`localStorage['gv:settings'].debug`) or the URL has `?dev=1`.

### Presence, place and conversation limits (2026-10-18)

- **Dialogue `scene` column** (optional, after `dayPhase`): blank = anywhere; otherwise one scene id or several joined by `|`. Selection keeps rows whose `scene` is blank or lists the current scene, then applies priority and specificity, where a non-blank `scene` counts as one more condition. The fallback is the row with all six conditions and `scene` blank. Old sheets without the column still load.
- **Per-appearance `figure`** on `appearances` entries: that asset is drawn in that scene (its seated-ness comes from the manifest `seated` flag, or `_fig_sit` in the id); blank, or an asset that does not exist yet, uses the NPC's default figure.
- **Conversation limit**: `roomConfig.maxTalksPerNpcPerDay` (researcher page field "Conversations per person per day", default 1; `?dev=1` uses 1 unless `&talks=N`). Conversations are counted per NPC per day in the save (`talks`, reset at day start). The count goes up when a conversation ends (a choice with no `next`) or is left (move, another person, a hotspot, closing the panel), never when it starts and never mid-tree, so a conversation in progress can always be finished; a reload resumes the open conversation on the row it was on. At the limit the figure (or painted talk zone) stays but is simply non-interactive: no hover outline, default cursor, no label; its aria-label is "<name> (talked today)". Log `dialogue` lines carry `talk` (which of today's conversations with that person this is) and `forced: true` for a dev override. The checker's limit model counts conversations, not turns (a conversation is charged once, follow-ups ride along), which is the same budget whether the count is taken at the start or the end.
- **Visits**: an `enter` event with a `scene` from an NPC who has no appearance there fires without them being present (someone at the door or on the phone); the panel says "Dana at the door" when the text mentions a knock or the door, else "Call from Dana".
- **Scene swap**: before a new scene (or a background variant such as evening) is shown, its background, props, present figures and TV still are loaded and decoded (at most 1.5 s, input held meanwhile), then the old scene fades out over 150 ms.
- **TV screens**: a scene's `screens: [{ id, quad, byBackground? }]` draws the story `tvContent()` would show (dark with no story, and dark for the rest of the day once the TV has been watched and closed) onto the glass with a CSS `matrix3d` homography (`src/homography.ts`), dimmed to 55 %, blurred 1.5 px, with a faint vertical sheen, under the hotspot. `byBackground[<background id>]` overrides `quad` for a variant (home's evening render).

### Profiles, TV once a day (2026-10-18, later)

- **TV once a day**: the TV (home and clinic share one daily state, `state.tvWatchedDay`) opens once per day. The room screen keeps showing the still it had when the TV was switched on while the window is open, then goes black for the rest of the day once the window closes. The hotspot then stays but is disabled with no visible notice (aria-label "TV (watched today)"). "Keep watching" is behind `FEATURES.tvKeepWatching` in `src/rules.ts` (false: the button is hidden and the host refuses its `spend`). Print news is unaffected.
- **Profiles**: an NPC in `npcs.yaml` may carry a writer-facing `profile` (`integrationLean`, `warmth`, `talkative` 0–10; `backstory`, `motivation`, `voice` text; `topics`, `avoid` lists). `src/content.ts` keeps it on `Npc.profile` exactly as written; the engine never reads it. The checker reports out-of-range or mistyped fields as errors and unknown profile keys as warnings (`PROFILE_KEY`).

## Published demo (GitHub Pages)

Every push to `master` runs `.github/workflows/pages.yml`, which builds with `BASE=/upgraded-octo-disco/` and deploys `demo/dist` to **https://rrjzhang.github.io/upgraded-octo-disco/** (`?dev=1` works there too; also `researcher.html`, `editor.html`, `logview.html` under the same path). To build or preview locally under that sub-path: `BASE=/upgraded-octo-disco/ npm run build && BASE=/upgraded-octo-disco/ npm run preview` (then open `http://localhost:4173/upgraded-octo-disco/`). The base defaults to `/`; in code, build URLs with `appUrl('content/…')` from `src/util.ts` (it prefixes `import.meta.env.BASE_URL`), and in static files under `public/` use relative paths, never a leading `/`.

**The Pages build is a static demo.** There is no server: `/api/log` and `/api/questionnaire` answer 404 (the game falls back silently), and rooms, saves, action logs, settings and researcher overrides live only in the browser's `localStorage` / IndexedDB. A participant and a researcher using the same browser on the same computer share that state; nobody else sees it, and logs must be exported from the researcher page on the machine where the game was played.

## Firebase log upload (proof of concept)

Each action-log line is also sent to Cloud Firestore (project `the-great-vote-8571`) under an anonymous Firebase user, one `sessions/<uid>` document per browser with the log in `chunks` (SPEC "Firebase log upload"). It is on by default on the dev server and both builds; `?dev=1` turns it off (so `npm run fuzz` never writes) unless `?fb=1` is added; `?fb=0` turns it off anywhere. Failures are silent apart from one `[fb]` console warning, and the lines are retried later. To see the data: Firebase console → the project → Firestore Database → `sessions`. The database rules are in `firestore.rules` at the repo root; publish them with `firebase deploy --only firestore:rules` (or paste them into the console's Rules tab). Until then every write is refused.

## Editor

`/editor.html` lets a researcher edit content in the browser without a rebuild (SPEC "Researcher editing, overrides and casting").

- **Dialogue**: pick an NPC; its sheet is an editable table (id, the six conditions, the optional `scene` cell with suggestions from the NPC's scenes and `|` pairs, priority, emotion, line, three choices with effect and next). A scene cell is written right after `dayPhase` when the sheet gains the column. The side panel lists completeness per scene, and **Talks/day** in the header sets the conversation limit the reachability check assumes. Row actions: add, duplicate, move up/down, delete (refused while another row's `next` points at it), and `+↳` on a choice to add a follow-up row (priority -1, met yes) linked from that choice. The side panel runs the checker core (`tools/checker/core.mjs`) live: schema errors, missing fallback, dangling next, ties, coverage, unreachable and never-winning rows, the witness path for the selected row, and a conversation tree (entry rows and their follow-up chains, with turn and depth). Rows and cells with problems get badges.
- **Conversation graph and Character card** (SPEC "Character profiles … conversation graph"): the dialogue toolbar switches **Table / Graph + table / Graph** (remembered per browser; the split has a draggable divider, **Hide panel** widens the graph). Nodes are rows (id, first words, emotion colour bar, `@scene`, cells won), entry rows outlined in black, the fallback dashed, rows with no incoming choice that win no cell dashed red ("no way in"); edges are choices labelled `c1 · text` into their `next` (dashed loops for cycles or returns to an entry row), `⊣` stubs for choices that end the conversation, red stubs for a missing `next`. Columns are depth (entry rows first; a row reached from several places sits at its deepest). Click a node to select its row (the table scrolls to it) and light every upstream row and edge in amber and every downstream one in teal; the strip above lists "Reached from" / "Leads to" with links. Hover shows the full line and choices; drag pans, the wheel zooms, **Fit** shows the whole sheet, double-click in Graph view opens the row in the table. The graph relayouts after each edit and is read-only. The side panel opens with a read-only Character card: pack, community, role, stance, appearances (scene · slot · chance) and the `profile` block from `npcs.yaml` (lean/warmth/talkative bars, backstory, motivation, voice, topics, avoid), or the list of profile fields to add.
- **Events / News**: the same table treatment for `events.csv` and `news.csv`, including the optional cast columns (`portrait`, `figure`).
- **Images**: every slot the game draws (busts per expression, figures, backgrounds incl. evening and painted variants, TV stills, cast bust/TV). Upload a PNG/JPEG, see its pixel size and shape warnings, preview at game size, revert.
- **Save** writes only files that differ from the bundled ones to `localStorage['gv:override:v1']` and images to IndexedDB `gv`/`images` (keys like `portraits/us_neighbor/warm`). The game applies them on load and shows an "edited content" chip; `?dev=1&nooverride=1` ignores them. Overrides live in this browser only.
- **Export** downloads each changed file (`us_neighbor.csv`, `events.csv`, PNGs named after their manifest file) to commit into `public/content` and `image_generation/out`. **Revert** per file or image (in the table toolbar or under Changes); **Revert all** clears the override key and every image key. **Copy override JSON** gives the `{ text, imageKeys }` snapshot for a room config. Leaving with unsaved changes asks first; Ctrl/Cmd+S saves.

## Check the content

```bash
npm run check        # node tools/checker/check.mjs
open tools/checker/report/index.html
```

`node tools/checker/check.mjs --talks N` checks reachability with N conversations per NPC per day (default 1). Validates every sheet against the schema in `SPEC.md`, enumerates all 432 parameter cells per NPC and per scene the NPC can be met in to find ties, shadowed rows and fallback-only cells, and searches the transition graph for the cheapest path to every row (unreachable rows and rows over the 40-action budget are flagged, with a witness path for each reachable row). `node tools/checker/test.mjs` runs the fixture suite.

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
- End-of-day survey (`eod-biis2-v2`): a 4-item BIIS-2 short form (Bicultural Identity Integration Scale, version 2; items 3, 10, 14, 17), two numeric `scale` items (community fit 1-5, how you feel today 0-9) and the mood / place / note check-in, scored in the module and logged with each submission; see `public/content/questionnaire/README.md`.
- Culture packs (SPEC "Packs"): the player's effective pack is their home culture when `npcs.yaml` has an NPC with that `pack` and `scenes.yaml` a scene with that `pack`; otherwise `cn`, with a banner naming the pack standing in. The hub and every exit list only shared scenes (no `pack`) and the effective pack's scenes, `moveTo` refuses the others, and events from other packs' NPCs or in other packs' scenes never fire. `{homeCulture}` follows the effective pack. The pack is recomputed on every load, so old saves and content that gains a pack pick it up; a player saved in a scene that is no longer theirs wakes at home. `?dev=1&culture=mx` also switches an existing dev save. `node tools/checker/check.mjs` prints which scenes each culture sees.

## Known gaps

- No server. Rooms, saves and the action log live in `localStorage`; the engine already attempts `POST /api/log` and ignores failures, so a server can be added without touching the client.
- Seven roster characters (Kelsey, Ruth Hale, Gary Pruitt, Mrs. Chen, Jia, Dr. Zhou, the inclusive-condition president) have no generated art yet and show as silhouettes.
- Mexico and India packs fall back to the China roster (with the banner) until their NPCs and a scene with their `pack` are in the content.
