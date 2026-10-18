# Great Vote demo

A scene-based life-sim that doubles as a bicultural-identity research instrument. Plain TypeScript + Vite, no framework. All game content is data under `public/content/` (YAML and CSV), all art under `public/assets/`, and a checker proves the dialogue sheets are complete and reachable before anything ships.

## Run it

```bash
cd demo
npm install          # once
npm run dev          # http://localhost:5173
```

- `/?dev=1` drops straight into day 1 at home (room `DEV1`, enforcement condition). Add `&reset=1` to wipe the save, `&leader=inclusive`, `&culture=mx|in`, `&name=Alex`.
- `/` is the participant entry: room code and password, then character setup.
- `/researcher.html` creates rooms (randomised parameters, every field editable), lists rooms on this computer with their day reached, and exports a room's action log as JSON lines.
- `/?fixtures=1` loads a tiny built-in test world instead of the real content.

In dev mode `window.gv` exposes helpers: `gv.goto('library')`, `gv.talk('us_neighbor')`, `gv.set('cn_leader_sep','rapport',2)`, `gv.lean(8,1)`, `gv.actions(0)`, `gv.endDay()`, `gv.present()`.

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

Regenerates `public/assets/**` and `manifest.json` from `../image_generation/out/`. Characters without generated art get silhouette placeholders and are tagged "art pending" in the game. See `tools/assets/README.md` for the mapping.

## Where things live

| Path | What |
| --- | --- |
| `SPEC.md` | The build contract: layout, rules, schemas, manifest shape, window-module API |
| `src/` | Engine: `game.ts` (scene, dialogue, events, phone, windows), `rules.ts` (row selection, effects, lean, phases), `content.ts` (loading and validation), `store.ts` (save and action log), `researcher.ts` |
| `public/modules/` | `tv.html`, `work.html`, `survey.html`, loaded in an iframe and driven by `postMessage` |
| `public/content/` | `scenes.yaml`, `npcs.yaml`, `dialogue/<npc>.csv`, `events.csv`, `news.csv`, `questionnaire/eod.json` |
| `public/assets/` | Processed backgrounds, portraits, figures, props, TV stills and `manifest.json` |
| `tools/checker/` | Completeness and reachability checker, fixtures, HTML report |
| `tools/assets/` | Asset build script |

## Art conventions

- The word **PLACEHOLDER** appears wherever an image is missing: grey silhouettes for people, a dashed box over a hotspot flagged `placeholder: true` (the living-room and clinic TVs until the Round 2 backgrounds land), the TV still, and a flat panel for a missing background.
- Each scene has a `near` slot for the person the player is there to talk to (about 90% of the frame height); overheard or incidental people use the smaller slots further back.
- A scene can declare a `painted` background variant with some NPCs generated into the image (the park with its two chess players). It switches on by itself once `bg_park_chess_day` exists in the manifest; the NPCs are then reached through `talk` hotspots. Adjust those zones to the generated figures.
- End-of-day survey: BIIS-2 (Bicultural Identity Integration Scale, version 2), 17 items, scored in the module and logged with each submission; see `public/content/questionnaire/README.md`.

## Known gaps

- No server. Rooms, saves and the action log live in `localStorage`; the engine already attempts `POST /api/log` and ignores failures, so a server can be added without touching the client.
- Seven roster characters (Kelsey, Ruth Hale, Gary Pruitt, Mrs. Chen, Jia, Dr. Zhou, the inclusive-condition president) have no generated art yet and show as silhouettes.
- Mexico and India packs are selectable but fall back to the China roster with a banner.
