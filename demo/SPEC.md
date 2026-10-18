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
- Bed (or the phone Call tab at 0 actions) runs the end-of-day survey module, then advances the day. With actions left the bed first asks in the right panel ("You still have N actions. If you'd rather not see anyone today, Work pays $40 a shift.": Go to work / Go to bed anyway / Stay up), logged as a `hotspot` line with `choice` 1/2/3; at 0 actions it goes straight to the call. Demo length: 5 days, then an end screen with an export button.
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

## Researcher editing, overrides and casting (added 2026-10-18)

- **Content overrides.** The engine loads bundled content, then applies an override set if one exists, so researchers can edit without a rebuild. Text lives in `localStorage['gv:override:v1']` as JSON: `{ "v":1, "updated":"<ISO>", "dialogue": { "<npcId>": "<csv text>" }, "news": "<csv>", "events": "<csv>", "npcs": "<yaml>", "scenes": "<yaml>" }` (each key optional; a present key replaces that whole file). Images live in IndexedDB database `gv`, object store `images`, keyed `"<section>/<id>/<variant>"`: `portraits/us_neighbor/neutral|warm|guarded|worried`, `figures/ch_us_neighbor_fig_stand`, `backgrounds/bg_home_day`, `tv/nat_inclusive/0`, `cast/<castId>/bust|tv`; value `{ blob, type, w, h, updated }`. The engine resolves an image through the override store first (object URLs created at load) and the manifest second. A room may pin an override snapshot: `roomConfig.override = { text: <the JSON above>, imageKeys: [...] }` so participants on another machine see the researcher's edits once a server exists; for the demo, overrides are per browser. The game shows a small "edited content" chip in the top bar when an override is active; `?dev=1&nooverride=1` ignores it.
- **Editor** at `/editor.html` (Vite entry, `src/editor/**`): pick an NPC, see its sheet as a table (conditions, priority, emotion, line, three choices with effect and next), edit cells inline, add a row, add a follow-up (creates a row with priority -1 and met yes and links it from a choice), duplicate a row, delete a row (refused if something `next`s to it). Live validation uses the checker's core (`tools/checker/core.mjs`, pure functions shared with `check.mjs`): schema errors, missing fallback, dangling next, ties, coverage, and per-row reachability summary. Also edits `events.csv` and `news.csv` as tables, and swaps images (portrait per expression, figure, background, TV still, cast) by file upload with a preview at game size. Save writes the override; Export downloads the changed files as CSV/YAML/PNG so they can be committed into `public/content` and `image_generation/out`. Revert per file.
- **Cast (authority figures).** `news.csv` gains an optional `figure` column and `events.csv` an optional `portrait` column, both naming a cast id. Cast assets come from `image_generation/out/cast_<id>_ref_A.png`, `cast_<id>_bust_A.png` (1:1, transparent) and `cast_<id>_tv_A.png` (16:9 news framing); the asset build writes `manifest.cast[<id>] = { name, role, bust, tv, ref }`. The TV module shows the story's `figure` still when set (else the national leader's); print news shows the bust beside the headline; an event with `portrait` shows that bust on the right panel. The national leaders remain `nat_enforcement` / `nat_inclusive` with their own stills.
- **Choice order.** Choices are shown in a deterministic shuffled order per (room seed, row id, day) so the exit or the low-valence option is not always last. Log lines keep `choice` = authored index (1..3) and add `shown` = displayed position. The checker and editor use authored order.
- **Short conversations are free.** `depth(row)` = 1 + max depth of its choices' `next` rows (follow a DAG; a cycle counts as depth 3). If the row that would be selected has depth < 3, talking costs 0 actions and no cost dot is shown; otherwise the dialogue cost is 1 as before. The checker mirrors this in its cost model.
- **Debug toggle.** `localStorage['gv:settings']` JSON `{ "debug": true|false }`, set from a single switch on the researcher page ("Show debugging aids"). Off hides: the Show interactables button and the H reveal, the footer rule/lean/phase line in the right panel, valence and rapport in Contacts, the dev guides, and the `rule …` chip in text panels. `?dev=1` forces it on for that tab. Rooms created from the researcher page default to off; `DEV1` defaults to on.

## Presence, place and conversation limits (added 2026-10-18)

- **Where people stand.** Every slot in `scenes.yaml` must be a spot where a person can plausibly stand or sit in that background: open floor, not on furniture, not intersecting a table, with a short comment naming the spot. Seated slots sit on actual seating. Slots are reviewed against gridded renders of each background (`tools/scenes/grid.mjs` draws a 10% grid and the horizon over each background into `tools/scenes/grid/`), and each scene records its `horizon` and `cameraHeight` as before.
- **Nobody is at home at wake-up.** NPCs have no appearances in `home`. Visits are events (`trigger: enter`, `scene: home`, with `npc`) that show the bust on the right panel and read as someone at the door or on the phone.
- **Per-appearance figure.** An appearance may name a `figure` asset to use in that scene (`{ scene: library, slot: by_shelves, chance: 0.3, figure: ch_us_stranger_a_fig_stand }`); blank = the NPC's default. A seated figure (which includes its stool) is only valid on a slot marked `seated: true`; the checker enforces this.
- **Dialogue location.** The dialogue CSV gains an optional column `scene` after `dayPhase`: blank = anywhere; otherwise one scene id or several separated by `|`. Selection first keeps rows whose `scene` is blank or contains the current scene, then applies the existing priority and specificity rule (a non-blank `scene` adds 1 to specificity). Completeness is checked per scene the NPC can appear in (from `appearances`, plus any event `scene` naming the NPC): for every such scene, every one of the 432 cells must be served, with the fallback row (all conditions blank, `scene` blank) still mandatory. Rows whose `scene` names a scene the NPC never appears in are an error.
- **Conversation limit.** `roomConfig.maxTalksPerNpcPerDay` (integer, default 1; the researcher page exposes it; `?dev=1` keeps 1 unless `&talks=N`). Once an NPC has had that many conversations today, their figure and talk zone stay visible but show "Talked already today" (muted label, disabled) and do nothing. Follow-ups via `next` inside one conversation do not count. The checker's cost model assumes at most `maxTalksPerNpcPerDay` conversations per NPC per day over the 5-day demo (default 1, so at most five conversations per NPC in a run) when searching for witnesses.
- **Figures appear with the scene.** The engine preloads the figure images for the present NPCs (and the background) before swapping the scene in, so people do not pop in a few frames late; a 150 ms fade covers the swap.
- **TV screens show the news.** A scene may list `screens: [{ id: tv, quad: [[x,y],[x,y],[x,y],[x,y]] }]` with the four corners of the TV glass in fractions of the background (top-left, top-right, bottom-right, bottom-left, measured on the gridded render). The engine draws the current TV story's still (the cast still or the leader still that `tvContent()` would show) onto that quad using a CSS `matrix3d` homography from the unit square, dimmed to ~55% brightness, slightly blurred (1.5 px at 900 px wide), with a faint vertical gradient so it reads as a lit screen seen from the room. It sits under the hotspot so the click still opens the TV. When the TV has been watched this phase the screen can show the second story; when there is no story, it stays dark.

## Character profiles, TV once a day, conversation limit semantics, conversation graph (added 2026-10-18, later)

- **Profiles.** Each NPC in `npcs.yaml` may carry a `profile` block, writer-facing and never shown to participants: `integrationLean` (0 = keeps the heritage world separate, 10 = fully blended; the roster's `stance` stays the research manipulation), `warmth` (0–10), `talkative` (0–10), `backstory` (3–5 sentences), `motivation` (one sentence: what they want from the player), `voice` (how they talk: sentence length, habits, what they never say), `topics` (list), `avoid` (list). The engine ignores it; the editor shows it as a Character card beside the sheet and the checker validates ranges. Mrs. Chen carries the example.
- **TV once a day.** The TV can be opened once per day (`state.tvWatchedDay`). The projected screen shows the day's still until the TV window has been closed, then goes black for the rest of the day. The "Keep watching" second story is hidden behind `FEATURES.tvKeepWatching = false` (kept in code). After watching, the hotspot stays but is disabled with no notice; its aria-label says "TV (watched today)".
- **Conversation limit semantics.** The per-NPC daily count increments when a conversation ends (choice with no `next`, or leaving), never at its start and never mid-tree; a conversation in progress can always be finished, including after a reload. When the count has reached the limit the figure or talk zone is simply non-interactive: no hover outline, default cursor, no label; aria-label "<name> (talked today)" for assistive tech only.
- **Conversation graph.** The editor's dialogue tab offers a Graph view: nodes are rows (id, first words, emotion colour, scene tag, entry rows outlined), edges are choices (labelled with the choice number and short text) to their `next`; layered left-to-right by depth with entry rows in the first column; clicking a node selects the row in the table and highlights predecessors (upstream, amber) and successors (downstream, teal), so a writer can read a conversation backwards as well as forwards. Rows with no incoming edge and not winning any cell are flagged. Pan with drag, zoom with wheel, fit button. No external libraries.

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

Modules are static HTML under `public/modules/` loaded in an iframe. Host sends `postMessage({type:'init', payload:{day, actions, wallet, condition, homeCulture, content}})` after load, where `content` is module-specific (TV: the chosen news story; survey: the questionnaire JSON). Module sends `{type:'earn', amount}`, `{type:'spend', actions}`, `{type:'submit', answers}`, `{type:'close'}`. Host ignores anything else. Three modules: `work.html` (placeholder: a 20-second "sort the mail" click game; one shift costs 2 actions and pays $40), `tv.html` (shows the news still image and the story; the Keep watching second story is behind `FEATURES.tvKeepWatching`, off for now; the TV opens once per day), `survey.html` (renders the questionnaire JSON: likert matrix, single choice, short text; Next/Submit).

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
    horizon: 0.33              # eye-level line (fraction of image height), measured from the background
    cameraHeight: 1.6          # optional, metres (default 1.6)
    slots:                     # where NPC figures stand: feet anchor as fractions (y may go to 1.3: feet below the frame, legs cropped)
      - { id: by_door, x: 0.80, y: 0.90 }          # height from the horizon formula below
      - { id: odd_spot, x: 0.50, y: 0.70, scale: 0.40 }   # optional explicit figure height / image height, overrides the formula
```
Action types: `window` (module tv|work|survey), `news`, `end_day`, `move` (to scene), `look` (shows `text` in the right panel, free), `talk` (`npc: <id>`; a click zone standing for a person painted into the background, costs the dialogue cost, rendered only while that NPC is present through `painted`). A hotspot may carry `placeholder: true`: the engine then draws an always-visible dashed box with the word PLACEHOLDER over the zone, for art that is not in the background yet (the living-room TV until the Round 2 background lands).

Figure size is horizon-locked: height / image height = (slot.y − horizon) × personHeight / cameraHeight, with personHeight 1.70 m standing and 1.30 m seated (the seated assets include the stool or bench), clamped to 0.12..0.95. On an eye-level shot this puts a standing adult's head just above the horizon at every depth. In dev mode the H reveal also draws the horizon and each figure's head line.

Staging convention: every scene has a `near` slot (feet at or just below the bottom edge, no scale) for the person the player is clearly there to talk to; incidental or overheard people take the smaller slots further back, or are painted into the background. A scene may declare `painted: { background: <asset id>, npcs: [<id>, ...] }`: when that asset exists in the manifest and every listed NPC is in the roster, the engine shows that background instead, skips the scene's composited props, treats the listed NPCs as present without drawing a figure, and reaches them through the scene's `talk` hotspots. Otherwise the plain background and cut-out figures are used, so content never waits on art.

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

Optional extra column (added 2026-10-18): `scene`, placed after `dayPhase`; see "Presence, place and conversation limits".
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
