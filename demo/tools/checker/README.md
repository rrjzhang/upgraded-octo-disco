# Great Vote content checker

Validates the content pack against `demo/SPEC.md`, checks every dialogue sheet
for completeness over the 432-cell parameter space, and checks that every row
can actually be reached in play.

```
node tools/checker/check.mjs [--content public/content] [--report tools/checker/report] [--talks N] [--json]
node tools/checker/test.mjs        # runs both fixtures and asserts the findings
```

`core.mjs` holds every check as pure functions over file texts (no Node built-ins), so the browser editor
(`src/editor`) imports it directly: `checkContent({ files: { 'scenes.yaml': text, 'npcs.yaml': text, 'events.csv': text,
'news.csv': text, 'cast.yaml'?: text, 'dialogue/<npc>.csv': text, ... }, manifest, analyse? })` returns the same result
object the CLI writes to `results.json`. `check.mjs` reads the files, calls it, and renders the text summary and HTML report.
Optional cast columns (`events.csv` `portrait`, `news.csv` `figure`) are accepted; with a manifest present, an id that is in
neither `cast.yaml` nor `manifest.cast` is an `UNKNOWN_ASSET` warning.

Exit code 0 = no errors (warnings allowed), 1 = errors, 2 = bad CLI usage.
Writes `<report>/index.html` (dependency-free) and `<report>/results.json`.
`--json` prints the results (without the per-cell grid) on stdout instead of the text summary.

`--talks N` (default 1; `checkContent({ maxTalks })` in the core, the editor's Talks/day setting) is the
`maxTalksPerNpcPerDay` the reachability search assumes.

## What it checks

1. **Schema.** `scenes.yaml`, `npcs.yaml`, `dialogue/<npcId>.csv`, `events.csv`, `news.csv`:
   exact column lists, enum vocabularies, rapport conditions (`2`, `1-3`, `2+`),
   the effects grammar (`met yes`, `rapport +N|-N|N`, `lastValence ...`, `money +N`,
   `invite <eventId>`, `actions -N`), `next` targets in the same sheet, and cross-file
   references (exit/move scenes, appearance scene + slot, event scene/npc, invited event ids).
   If `<content>/../assets/manifest.json` exists, asset ids are checked against it (warnings,
   because placeholders are expected while assets are in progress).
2. **Completeness.** Runs the SPEC selection rule (match non-blank conditions → highest
   `priority` → most non-blank conditions) for all 432 cells. Errors: ties, missing fallback,
   cells no row matches. Warning: rows that never win (shadowed). Rows that are only `next`
   targets are exempt from the never-win warning. Coverage = cells won by a non-fallback row.
3. **Reachability.** Per NPC, Dijkstra over (met, rapport, lastValence, invited-flags, row being
   shown). World variables (nationalLeader, playerLean, dayPhase) are free, so "unreachable" is
   sound. Edges: talking to the NPC (shows the row that wins the cell; its choice costs 1, or 0 when
   that row is a short conversation, see below, plus any `actions -N`), `next` follow-ups (free apart from `actions -N`), and choices of events whose
   `npc` is this NPC (cost = event `cost` + `actions -N`; `minRapport` respected; `invite`
   events only after an `invite` effect, or freely if another NPC's content invites them).
   Error: row unreachable. Warning: cheapest path > 40 actions. A witness path is reported for
   each reachable row with the cost of every step, e.g.
   `B1/choice1 (+0) → B2/choice1 (+1) → B3/choice1 (+1) → B4  [via next]` (2 actions), and each row
   carries its `depth` (shown in the HTML report, "free to open" when < 3).

4. **Place (2026-10-18).** The optional dialogue `scene` column (after `dayPhase`; blank or ids joined by `|`):
   unknown ids are `UNKNOWN_SCENE`, a scene the NPC is never met in is `SCENE_NOT_APPEARED`. The NPC's scenes are
   its appearances, painted variants and talk zones (where a conversation can start) plus the scenes of events naming
   it (completeness only). Completeness runs the selection rule per scene (a row matches when its scene is blank or
   lists that scene; a non-blank scene adds 1 to specificity); ties name their scenes; the printed and HTML reports
   list coverage per scene (`*` = met there through events only). Headline coverage is the weakest talk scene.
   A row that only wins in events-only scenes is `EVENT_SCENE_ONLY` (info). Appearances: an optional `figure`
   (asset warning if unknown); once any slot in scenes.yaml carries `seated`, a seated figure (the appearance's
   `figure`, else the NPC's; manifest `seated: true` or `_fig_sit` in the id) on a slot without `seated: true` is
   `SEATED_SLOT`. `screens` quads must be four corners, clockwise and convex; `byBackground` maps a background id to a quad.
5. **Conversation limit.** A second search tracks the day (1..5, dayPhase follows it) and conversations with the
   NPC that day (at most `--talks`); a new day is free, follow-ups and events do not count. Witnesses come from it
   (`B1/choice1 (+0) → day 4 → B2/choice1 (+1) → …`). A row reachable without the limit but not with it is
   `LIMIT_UNREACHABLE` (error, with the unlimited witness); a row unreachable even without it is `UNREACHABLE`.

## Codes

Errors: `MISSING_FILE`, `YAML_PARSE`, `CSV_PARSE`, `UNKNOWN_COLUMN`, `MISSING_COLUMN`,
`COLUMN_ORDER`, `FIELD_COUNT`, `SCHEMA`, `BAD_VALUE`, `BAD_CONDITION`, `UNKNOWN_EFFECT`,
`BAD_EFFECT`, `DANGLING_NEXT`, `DUPLICATE_ID`, `UNKNOWN_SCENE`, `UNKNOWN_SLOT`, `UNKNOWN_NPC`,
`MISSING_SHEET`, `MISSING_FALLBACK`, `TIE`, `NO_MATCH`, `UNREACHABLE`, `LIMIT_UNREACHABLE`, `SCENE_NOT_APPEARED`, `SEATED_SLOT`.
Warnings: `NEVER_WINS`, `OVER_BUDGET`, `FALLBACK_PRIORITY`, `NEVER_INVITED`, `INVITE_TRIGGER`,
`UNKNOWN_ASSET`. Info: `NO_APPEARANCES` (TV-only NPC; reachability not enforced), `EVENT_SCENE_ONLY`. Warning `COLUMN_ORDER` also flags a `scene` column not right after `dayPhase`.

## Fixtures

- `fixtures/good/`: 1 scene, 2 NPCs, an invite event and an overheard event. Passes clean.
  `alice` A1 → A2 is a free short conversation (depth 2, A2 costs 0); `bob` B3 → B4 → B5 has depth 3,
  so opening B3 costs 1 (B3 costs 1: B2's `actions -1`; B4 and B5 cost 2).
- `fixtures/place/`: the scene column and the limit: `erin` E2 (park) wins only in the park, E4 names an unknown
  scene, E5 a scene Erin never appears in, E8/E9 tie only in the park, E6 (rapport 3 while early) is
  `LIMIT_UNREACHABLE` at 1 talk/day and reachable with `--talks 2`; `frank` has a seated default figure on a standing
  slot (`SEATED_SLOT`) and a standing per-appearance figure that passes, and is met at home through an event.
- `fixtures/bad/`: `carol.csv` has a tie (C2/C3), a shadowed row (C4 under C5), an unreachable
  row (C6, rapport 3), a dangling `next` (C1 → C99) and an unknown effect (`trust +1` on C3);
  `dave.csv` has no fallback.

## Modelling choices

- Short conversations are free, as in the engine (`rowDepth` in `src/rules.ts`, mirrored as `rowDepth` /
  `talkCost` in `core.mjs`): depth(row) = 1 + max depth of its choices' `next` rows (a cycle counts as 3,
  capped at 3). Opening a conversation on a row with depth < 3 costs 0 actions, otherwise 1. Follow-ups
  via `next` add nothing; `actions -N` adds N on top; event choices cost the event's `cost`. (Before
  2026-10-18 every opening cost 1, e.g. `us_neighbor` DN09 was 2 actions, now 1.) The engine also
  refuses to start any talk with 0 actions left; the checker's costs are totals and ignore that.
- Tied cells use the first tied row in sheet order (what the runtime does) for reachability.
- An NPC with no `appearances` (TV-only) needs no sheet; if it has one, rows are not flagged
  unreachable.
- `met no` is not a valid effect (SPEC lists only `met yes`).
