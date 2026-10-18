# Great Vote demo: build contract

This file is the contract between four parallel workstreams (engine, content, checker, assets). Each owns one directory. Nobody edits another workstream's directory; if you need something from another workstream that is not in this spec, write a placeholder that matches the schema here and note it in your final report.

Read the plan for intent: the game is a scene-based life-sim that doubles as a bicultural-identity research instrument. Player is never shown. Desktop Chrome and Firefox. English only. Demo home culture pack: China (`cn`); Mexico and India are selectable but fall back to the China roster with a visible "pack not in demo" banner.

## Directory ownership

```
demo/
  package.json, package-lock.json, node_modules/   # owned by the orchestrator; already installed. Do not add deps without saying so.
  vite.config.ts, tsconfig.json, index.html, researcher.html, src/**, public/modules/**   # ENGINE agent
  public/content/**                                   # CONTENT agent  (scenes.yaml, npcs.yaml, dialogue/*.csv, events.csv, news.csv, questionnaire/*.json)
  public/assets/**, tools/assets/**                   # ASSETS agent   (processed images + manifest.json + build script)
  tools/checker/**                                    # CHECKER agent  (completeness + reachability CLI + HTML report)
```

Installed deps (import from `node_modules`, usable by all): `vite`, `typescript`, `js-yaml`, `papaparse`, `@types/js-yaml`, `@types/papaparse`. Node 24. Tools under `tools/` are plain ESM `.mjs` run with `node`, and may import `js-yaml` and `papaparse`.

Source images: `/Users/richardzhang/great_vote/image_generation/out/*.png` (read-only; never modify). Ids are the filename stem. Use the `_A` (photoreal) set. Figures and busts with `_A` suffix already have alpha channels.

## Layout (engine)

One page, 1440 x 900 logical, scaled to fit the window (CSS transform on a fixed-size root is fine).

- Top bar, 56 px: day and phase, scene name; right side: actions dots (8), wallet, room code.
- Left: scene viewport, 900 px wide. The background image keeps its 3:2 aspect (900 x 600) and sits at the top of the left column; below it a 188 px strip holds exits (buttons with arrows) and the phone button at the far left. Hotspot zones and NPC slots are given as fractions of the background image, so they map exactly onto the 900 x 600 image box.
- Right: 540 px column. Portrait panel (484 x 300, flat `#E8E2D4`, radius 12) at top: bust image of the speaking NPC with an expression chip; empty when nobody is speaking. Below: italic description, then dialogue text, then up to 3 choice buttons, then a one-line status (rule id matched, for the demo).
- Phone: overlay 420 x 800 bottom-left over the scene with tabs Journal, Contacts, Wallet, Call. Call is disabled until bedtime. When actions reach 0 the phone rings: the phone button shakes and shows a badge until the call is answered, and the Call tab reads "Answer the end-of-day call". Answering (or the bed hotspot) runs the end-of-day survey, framed as that phone call. Contacts lists, per NPC met, the number of conversations, total turns and total minutes talked (from the conversation log).
- Window modules (TV, work, survey) open as a centred iframe overlay 1120 x 700 over a dimmed scene.
- Fonts: IBM Plex Sans (UI), Source Serif 4 (dialogue), via Google Fonts link. Palette: ink `#1F1D1A`, panel `#F4F1EA`, panel2 `#E8E2D4`, accent `#1F6F6B`, hotspot amber `#D9A441`, muted `#5D574D`.
- Hotspots render as real `<button>`s absolutely positioned over the image with `aria-label`; invisible by default, amber dashed outline on hover/focus; a key (`H`) or a small "Show interactables" button outlines all for 2 s. NPC figures are `<img>` with alpha, positioned by slot, with a soft shadow ellipse drawn under the feet, and a CSS `drop-shadow` outline on hover; clicking a figure starts dialogue.

## Game rules (engine)

- Day starts with 8 actions at Home, phase `morning`. Phase is derived from actions remaining: 8..6 morning, 5..3 afternoon, 2..0 evening. When phase is evening and an `_eve` background exists for the scene, use it.
- Moving between scenes is free. A hotspot or dialogue costs the `cost` in its data (default 1). When actions reach 0, only Home and the bed/phone are available; other scenes show "Too tired, go home".
- Bed (or the phone Call tab at 0 actions) runs the end-of-day survey module, then advances the day. Demo length: 5 days, then an end screen with an export button.
- Wallet starts at $1000 (`START_WALLET`, one constant). Work pays into it; nothing else in the demo spends it.
- Conversation tracking. A conversation starts at `talkTo` and ends when a choice has no `next`, when the player leaves (move, another NPC, a hotspot, closing the panel) or when the day ends. The engine logs one `conversation` line per conversation (shape below) with the wall time in ms and the turn count (one turn = one NPC line shown). Follow-up rows reached through `next` count as turns.
- Injectable questionnaire. The end-of-day questionnaire is resolved per day, first match wins: (1) `GET /api/questionnaire?room=<code>&day=<n>` returning questionnaire JSON (same schema as `questionnaire/eod.json`), 2 s timeout, any failure falls through; (2) questionnaire JSON stored in the room config by the researcher (`researcher.html` offers an optional "Questionnaire JSON" paste field, validated on save) or a `questionnaireUrl` in the room config, fetched the same way; (3) the bundled `questionnaire/eod.json`. Dev mode accepts `&eod=<url>`, which stands in for the room's `questionnaireUrl` (source `room`). The survey log line records which source was used.
- `playerLean` is derived: over all actions spent, the share spent in scenes whose `community` is `home` versus `us`; share < 0.35 → `us-leaning`, > 0.65 → `home-leaning`, else `balanced`. Neutral scenes count for neither.
- Per-NPC dynamic state: `met` (no/yes), `rapport` 0..3, `lastValence` none/positive/negative. World: `nationalLeader` (`enforcement` | `inclusive`), `playerLean`, `dayPhase` (`early` days 1..2, `mid` 3, `late` 4..5).
- Dialogue row selection: filter rows whose non-blank condition cells all match; pick the highest `priority` (number, default 0), then the most specific (most non-blank condition cells); ties are an authoring error (checker reports; runtime takes the first and logs a warning). A row with all conditions blank is the fallback and must exist.
- Effects grammar (semicolon-separated, applied in order): `met yes` · `rapport +1` / `rapport -1` / `rapport 2` (clamped 0..3) · `lastValence positive|negative|none` · `money +20` · `invite <eventId>` (adds an invitation that fires at the next day start) · `actions -1` (extra cost). Unknown tokens are an error.
- `nextN` on a choice names a follow-up row id in the same sheet: the engine shows that row immediately (no extra cost, conditions ignored). Blank = conversation ends.
- Events: at day start and on scene entry, roll each event row whose `trigger` matches (`day_start` | `enter`) and whose conditions match (scene, npc present, minRapport, playerLean, nationalLeader), with probability `chance`; at most one event per scene entry. Invited events (`trigger: invite`) fire at day start if in the invite list. An event renders like dialogue (portrait of `npc` if any, text, up to 2 choices with effects) and costs `cost` (default 0).
- Overheard events have no choices, only Continue; they use `emotion` on the speaking NPC.
- NPC presence per scene per visit: for each NPC appearance entry for the scene, present with probability `chance`, seeded per (room seed, day, scene) so re-entering within a day gives the same answer.
- Minigame (work) only pays the wallet. Survey only records answers. Neither touches NPC state.

## Action log (engine)

Append-only JSON lines kept in `localStorage` under `gv:log:<room>`, plus `POST /api/log` attempted with `keepalive` and silently ignored on failure (server comes later). One line per action:
`{"t":"<ISO>","room":"7K3F","day":2,"actions":5,"type":"dialogue|choice|event|hotspot|move|window|survey|journal|day_end|conversation","scene":"library","target":"us_neighbor","rule":"A01","choice":1,"delta":{"us_neighbor.rapport":[0,1]},"lean":"balanced"}`

Conversation line: `{"type":"conversation","target":"us_neighbor","scene":"library","turns":5,"ms":48210,"rules":["DN02","DN09","DN20"],"exit":"ended|left|day_end"}`. Survey line: `{"type":"survey","target":"<questionnaire id>","source":"server|room|bundled","answers":{...}}` where `answers` is the module's payload unchanged (BIIS-2 adds `scores`, `labels`, `instrument`).
Survey answers go in a `survey` line with `answers:{itemId:value}`. Journal saves go in a `journal` line with the full text. The researcher page exports the log as a `.jsonl` download.

## Study administration (engine)

- `researcher.html`: a form that creates a room: randomizes `nationalLeader`, roster candidate picks (where the manifest has several candidates), event seed; every field editable; "Create room" mints a 4-char code and a two-word password, stores `{code,password,config}` in `localStorage` under `gv:room:<code>`, lists existing rooms with status (day reached) and an Export log button.
- `index.html`: room code + password → character setup (display name, home culture radio cn/mx/in, language select recorded only, eligibility checkbox) → Begin. State saved to `localStorage` under `gv:state:<room>` after every action; reload resumes.
- Dev convenience: `?dev=1` on `index.html` skips the room form with a default room `DEV1` / `enforcement`.

## Window host API (engine builds modules too)

Modules are static HTML under `public/modules/` loaded in an iframe. Host sends `postMessage({type:'init', payload:{day, actions, wallet, condition, homeCulture, content}})` after load, where `content` is module-specific (TV: the chosen news story; survey: the questionnaire JSON). Module sends `{type:'earn', amount}`, `{type:'spend', actions}`, `{type:'submit', answers}`, `{type:'close'}`. Host ignores anything else. Three modules: `work.html` (placeholder: a 20-second "sort the mail" click game; one shift costs 2 actions and pays $40), `tv.html` (shows the news still image and the story; Keep watching costs 1 action and shows a second story if any), `survey.html` (renders the questionnaire JSON: likert matrix, single choice, short text; Next/Submit).

## Content schemas (content agent)

All files under `public/content/`. Text may use `{homeCulture}` (display name, e.g. "Chinese"), `{playerName}`, `{leaderName}`; the engine substitutes.

`scenes.yaml`
```yaml
scenes:
  - id: home                 # also used as scene key everywhere
    name: Home
    community: neutral       # home | us | neutral  (drives playerLean)
    background: bg_home_day  # asset id; engine swaps to bg_home_eve in the evening if that asset exists
    lighting: warm_indoor    # warm_indoor | cool_indoor | outdoor
    description: "A quiet morning. The TV is still on from last night."
    exits:
      - { to: street, label: "Front door" }
    hotspots:
      - id: tv
        label: "TV"
        zone: { x: 0.06, y: 0.10, w: 0.16, h: 0.18 }     # fractions of the background image, top-left origin
        action: { type: window, module: tv, cost: 1 }
      - id: newspaper
        label: "Newspaper"
        zone: { x: 0.45, y: 0.58, w: 0.12, h: 0.06 }
        action: { type: news, cost: 1 }                   # engine shows a print story from news.csv in the right panel
      - id: bed
        label: "Bed"
        zone: { x: 0.86, y: 0.40, w: 0.12, h: 0.30 }
        action: { type: end_day }
    slots:                     # where NPC figures stand: feet anchor as fractions, scale = figure height / image height
      - { id: by_door, x: 0.80, y: 0.90, scale: 0.55 }
```
Action types: `window` (module tv|work|survey), `news`, `end_day`, `move` (to scene), `look` (shows `text` in the right panel, free), `talk` (`npc: <id>`; a click zone standing for a person painted into the background, costs the dialogue cost, rendered only while that NPC is present through `painted`). A hotspot may carry `placeholder: true`: the engine then draws an always-visible dashed box with the word PLACEHOLDER over the zone, for art that is not in the background yet (the living-room TV until the Round 2 background lands).

Staging convention: every scene has a `near` slot (scale about 0.9, feet on the bottom edge) for the person the player is clearly there to talk to; incidental or overheard people take the smaller slots further back, or are painted into the background. A scene may declare `painted: { background: <asset id>, npcs: [<id>, ...] }`: when that asset exists in the manifest and every listed NPC is in the roster, the engine shows that background instead, skips the scene's composited props, treats the listed NPCs as present without drawing a figure, and reaches them through the scene's `talk` hotspots. Otherwise the plain background and cut-out figures are used, so content never waits on art.

Placeholders: wherever art is missing (background, figure, bust, TV still, placeholder hotspot) the engine shows the word PLACEHOLDER in small amber capitals on a dark chip, plus a grey silhouette for people. `street` is a hub scene with no background art: the engine renders it as a simple map card listing exits; give it `background: none`.

Scenes for the demo and their backgrounds: `home` (bg_home_day/eve), `work` (bg_work_day), `clinic` (bg_clinic_day, community us), `library` (bg_library_day, us), `park` (bg_park_day, neutral, the integrated space), `center_cn` (bg_center_cn_day, home), `street` (hub). Composite the TV prop (`prop_tv`) into home and clinic as a `prop` entry: `props: [{ asset: prop_tv, x: 0.06, y: 0.10, w: 0.16 }]`, and the chessboard into park. Look at the actual images in `image_generation/out/` to place zones and slots on real furniture.

`npcs.yaml`
```yaml
npcs:
  - id: us_neighbor
    name: Dana
    pack: shared             # shared | cn | mx | in
    community: us            # us | home | other | bicultural
    role: neighbor           # neighbor | stranger | local_leader | national_leader
    stance: none             # integration | separation | none
    portrait: ch_us_neighbor # asset base id; expressions are <base>_<neutral|warm|guarded|worried>; engine falls back to neutral
    figure: ch_us_neighbor_fig_stand   # asset id, or omit for TV-only NPCs
    seated: false
    appearances:
      - { scene: library, slot: desk, chance: 0.8 }
      - { scene: park, slot: bench_left, chance: 0.2 }
    initial: { met: false, rapport: 0, lastValence: none }
```
Demo roster (12 per game): shared `us_neighbor` Dana, `us_stranger_a` Walt (seated, chess), `us_stranger_b` Kelsey, `us_leader_int` Ruth Hale, `us_leader_seg` Gary Pruitt, `nat_enforcement`, `nat_inclusive` (TV only); cn pack `cn_neighbor` Mrs. Chen, `cn_stranger_a` Mr. Lin (seated, chess), `cn_stranger_b` Jia, `cn_leader_int` Dr. Helen Zhou, `cn_leader_sep` Mr. Guo. Asset coverage is partial (see assets); reference the ids anyway and the manifest marks placeholders.

`dialogue/<npcId>.csv` columns, exactly:
`id,met,rapport,lastValence,nationalLeader,playerLean,dayPhase,priority,emotion,line,choice1,effect1,next1,choice2,effect2,next2,choice3,effect3,next3`
Condition values: met `yes|no`; rapport `0|1|2|3` or a range `1-3` or `2+`; lastValence `none|positive|negative`; nationalLeader `enforcement|inclusive`; playerLean `us-leaning|balanced|home-leaning`; dayPhase `early|mid|late`. Blank = any. `emotion` is `neutral|warm|guarded|worried`. Every sheet has a fallback row with all six condition cells blank and `priority` 0. Each NPC needs at least 8 rows: first meeting, a generic revisit, something that depends on rapport 2+, something that depends on `nationalLeader`, something that depends on `playerLean`, one negative-lastValence row, one multi-turn follow-up via `next`, and the fallback. Leaders' rapport-2 rows under matching `playerLean` should `invite` an event. Write in plain, specific, unsentimental English; no stereotypes; culture content for the cn pack should be concrete and ordinary (a seniors' class, a festival planning meeting, a grandson's school), reviewed in the plan as "quiet cues".

`events.csv` columns, exactly:
`id,source,target,valence,proximity,trigger,scene,npc,minRapport,playerLean,nationalLeader,chance,cost,emotion,text,choice1,effect1,choice2,effect2`
`source`/`target` ∈ `us|home|other|bicultural`; valence `positive|negative`; proximity `proximal|distal`; trigger `day_start|enter|invite`. About 16 events covering at least 6 of the 64 parameter combinations, including 2 overheard (no choices) in the park, 2 invitations (one from `cn_leader_sep` for home-leaning players, one from `us_leader_int` for us-leaning or balanced players), and 4 news-driven ones that depend on `nationalLeader`.

`news.csv` columns: `id,channel,nationalLeader,dayMin,valence,headline,body` where channel is `tv|print`. 6 TV stories (3 per leader condition) and 4 print stories.

`questionnaire/eod.json`: `{ "id":"eod-v0", "title":"Evening check-in", "intro":"...", "pages":[ { "items":[ { "id":"bii_1", "type":"likert", "text":"[Bicultural Identity Integration item 1]", "scale":{"min":1,"max":5,"minLabel":"Strongly disagree","maxLabel":"Strongly agree"} } ] }, { "items":[ { "id":"mood", "type":"choice", "text":"...", "options":["..."] }, { "id":"note", "type":"text", "text":"..." } ] } ] }`. Use 8 placeholder likert items labelled as placeholders (the real instrument is dropped in later), 2 choice items, 1 text item.

`strings.en.json`: UI strings the engine needs (`{ "ui.phone": "Phone", ... }`); the engine agent defines the keys it uses in `src/strings.ts` with English defaults, so this file may be minimal.

## Asset manifest (assets agent)

`public/assets/manifest.json`:
```json
{
  "backgrounds": { "bg_home_day": { "file": "bg/bg_home_day.jpg", "w": 1536, "h": 1024, "lighting": "warm_indoor" } },
  "portraits":   { "ch_us_neighbor": { "neutral": "portrait/ch_us_neighbor_neutral.png", "warm": "...", "guarded": null, "worried": null, "placeholder": false } },
  "figures":     { "ch_us_neighbor_fig_stand": { "file": "figure/ch_us_neighbor_fig_stand.png", "w": 466, "h": 700, "seated": false, "placeholder": false } },
  "props":       { "prop_tv": { "file": "prop/prop_tv.png", "w": 600, "h": 600 } },
  "tv":          { "nat_enforcement": ["tv/nat_enforcement_1.jpg"], "nat_inclusive": ["tv/nat_enforcement_1.jpg"] },
  "candidates":  { "cn_leader_sep": ["ch_cn_leader_sep_ref_A_1", "ch_cn_leader_sep_ref_A_2", "ch_cn_leader_sep_ref_A_3"] }
}
```
Processing: backgrounds → JPEG quality 85 at 1536 wide; busts → PNG 640 x 640 keeping alpha; figures → PNG 700 tall keeping alpha, trimmed of transparent margins; where a bust is missing but a reference sheet exists, crop the top square of the reference (grey background, no alpha) as `neutral` and mark `"fromReference": true`; where nothing exists, generate a neutral silhouette placeholder (SVG rendered to PNG, or a PNG drawn with a tiny script) and mark `placeholder: true`. Use macOS `sips` (available) or any dependency-free approach; the build script must be re-runnable: `node tools/assets/build.mjs` regenerates everything from `image_generation/out/`.

## Checker (checker agent)

`node tools/checker/check.mjs [--content public/content] [--report tools/checker/report]` → exit 1 on errors. Loads scenes, npcs, dialogue, events with js-yaml and papaparse. Reports:
1. Schema errors (unknown columns, bad condition values, unknown effect tokens, `next` pointing nowhere, missing fallback row, unknown scene/slot/asset references between files).
2. Completeness per NPC: enumerate the cell space (met 2 × rapport 4 × lastValence 3 × nationalLeader 2 × playerLean 3 × dayPhase 3 = 432) and run the exact selection rule; list ties (error), cells served only by the fallback (coverage %), rows that never win (warning).
3. Reachability per NPC: build the transition model from the data: start state per NPC from `initial`, world variables free to move (over-approximation), edges = dialogue choices' effects and events' effects involving that NPC, each costing its action cost; BFS for minimum action cost per cell; flag rows whose every matching cell costs more than 40 actions (5 days × 8) or is unreachable; emit one witness path per reachable row (sequence of row ids / choices).
4. HTML report: `report/index.html` with a per-NPC coverage grid (rows = rapport × met, columns = lastValence × nationalLeader × playerLean × dayPhase, cells coloured by specificity of the winning row, hover shows the row id) and the lists above. Dependency-free HTML.
Also `tools/checker/README.md`. Include 3 small fixture sheets under `tools/checker/fixtures/` that exercise a tie, a shadowed row and an unreachable row, and a `node tools/checker/check.mjs --content tools/checker/fixtures/bad` run that shows them. The checker must pass cleanly on the real content once the content agent is done; until then, test on fixtures.

## Definition of done (orchestrator checks)

`npm run dev` serves `index.html`; `?dev=1` drops into day 1 at home with generated art; talking to Dana in the library shows her warm bust and matched rule; the park shows Walt and Mr. Lin seated with the chessboard; Mr. Guo offers the invitation at rapport 2 for a home-leaning player; the TV shows the president still with a condition-dependent headline; bed runs the survey and advances the day; after day 5 the export downloads a `.jsonl`; `node tools/checker/check.mjs` passes with coverage reported; `npm run build` produces `dist/`.
