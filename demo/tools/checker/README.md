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
   shown, its turn in the conversation). World variables (nationalLeader, playerLean, dayPhase) are free, so "unreachable" is
   sound. Edges: talking to the NPC (free: shows the row that wins the cell as turn 1), dialogue choices
   (pay when you stay, see below: the choice into turn 4 costs 1, a `cost N` option costs N, plus any
   `actions -N`), and choices of events whose
   `npc` is this NPC (cost = event `cost` + `actions -N`; `minRapport` respected; `invite`
   events only after an `invite` effect, or freely if another NPC's content invites them).
   Error: row unreachable. Warning: cheapest path > 40 actions. A witness path is reported for
   each reachable row with the cost of every step, e.g.
   `B3/choice1 (+0) → B4/choice1 (+0) → B5/choice2 (+1) → B6  [via next]`, and each row carries its
   `depth` (the most turns a conversation can run from it, capped at 4 = "can reach the paid turn";
   shown in the HTML report, report only).

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
   Stances and packs (SPEC "Culture packs"): `stance` must be `none|integration|assimilation|separation` and a scene's
   optional `pack` `cn|mx|in` (`BAD_VALUE`). `PACK_INCOMPLETE` (warning): an mx/in pack with NPCs but no scene, or a
   pack with scenes but no NPCs (its players fall back to cn). `PACK_MISMATCH` (warning): an NPC appearing in another
   pack's scene. `results.json` `packs` (and the CLI summary) list, per home culture, the pack played and the scenes
   open to that player, using the engine's rule (`packView` in core.mjs).
   Pack-gated content (`packs.mjs`): events/news `pack` must be `cn|mx|in` or blank (`BAD_VALUE`); a pack that contradicts
   the row's npc/scene pack is `PACK_MISMATCH`. `PACK_GAP` (warning): an id group (id minus `_cn|_mx|_in`) with a gated
   row but no variant or blank fallback for some pack, or a `pack.<pack>.<name>` string missing for a pack.
   `UNKNOWN_VAR` (warning): a `{name}` the engine cannot fill. `PACK_LEAK` (warning): player-facing text that uses the
   keyword list of a pack that does not see it (`public/content/pack_terms.yaml`; shared text may use none; an `allow:`
   entry with a `why` marks one deliberate use).
5. **Conversation limit.** A second search tracks the day (1..5, dayPhase follows it) and conversations with the
   NPC that day (at most `--talks`); a new day is free, follow-ups and events do not count. Witnesses come from it
   (`B1/choice1 (+0) → day 4 → B2/choice1 (+1) → …`). A row reachable without the limit but not with it is
   `LIMIT_UNREACHABLE` (error, with the unlimited witness); a row unreachable even without it is `UNREACHABLE`.

## Codes

Errors: `MISSING_FILE`, `YAML_PARSE`, `CSV_PARSE`, `UNKNOWN_COLUMN`, `MISSING_COLUMN`,
`COLUMN_ORDER`, `FIELD_COUNT`, `SCHEMA`, `BAD_VALUE`, `BAD_CONDITION`, `UNKNOWN_EFFECT`,
`BAD_EFFECT`, `DANGLING_NEXT`, `DUPLICATE_ID`, `UNKNOWN_SCENE`, `UNKNOWN_SLOT`, `UNKNOWN_NPC`,
`MISSING_SHEET`, `MISSING_FALLBACK`, `TIE`, `NO_MATCH`, `UNREACHABLE`, `LIMIT_UNREACHABLE`, `SCENE_NOT_APPEARED`, `SEATED_SLOT`,
`LEAD_MISSING`, `LEAD_DUP` (SPEC "Leads": once any NPC carries `lead`, every side in play has exactly one `pro` and one `anti`), `EMOTION_FORBIDDEN` (a row, beat tag, event or town hall line uses a bust the NPC's `emotions` list rules out), `TOWNHALL_SHEET`, `TOWNHALL_GAP` (SPEC "Town hall": a lead without `townhall/<id>.csv`; a sheet without speech block 1 under a president, blocks out of order, or no fallback reaction; the stance-specific reaction gaps are info).
Warnings: `NEVER_WINS`, `OVER_BUDGET`, `FALLBACK_PRIORITY`, `NEVER_INVITED`, `INVITE_TRIGGER`,
`UNKNOWN_ASSET`, `PACK_INCOMPLETE`, `PACK_MISMATCH`, `PACK_GAP`, `PACK_LEAK`, `UNKNOWN_VAR`, `BEATS` (a line split by `$` into more than three beats; `profile.yaml` and the `pack.<pack>|<dim>=<value>.<name>` variant-word keys are validated too, see SPEC "Profile questions and variant words"; an empty beat or an unknown `[tag]` at the start of a beat is a `BAD_VALUE` error on the `line`/`text` cell, see SPEC "Writing dialogue: beats and stage directions"). `TOPIC_STANCES` (a town hall topic without one of the four stance codes). Info: `NO_APPEARANCES` (TV-only NPC; reachability not enforced), `EVENT_SCENE_ONLY`, `LEAD_LITERAL` (a row names a lead by `called`/name without a condition on that side; use `{usLead}`/`{homeLead}` or condition the row). Dialogue completeness and ties are checked under all four `usLead` x `homeLead` combinations; reachability runs once per distinct winner table and a row counts as reachable when some room reaches it. Warning `COLUMN_ORDER` also flags a `scene` column not right after `dayPhase`.

## Fixtures

- `fixtures/good/`: 1 scene, 2 NPCs, an invite event and an overheard event. Passes clean.
  `alice` A1 → A2 is two free turns (A2 costs 0). `bob`: B3 costs 1 (B2's `actions -1`), B3 → B4 → B5
  are turns 1-3 (free, B4 and B5 cost 1), B5 → B6 is the edge into turn 4 (+1: B6 costs 2), B6 → B7 is
  free (paid already, B7 costs 2); B4 → B11 is an explicit `cost 1` (B11 costs 2); B5 → B9 is a
  `cost 2` ask into turn 4, charged max(2, 1) = 2 (B9 costs 3) and B9 → B10 is then free (B10 costs 3).
- `fixtures/place/`: the scene column and the limit: `erin` E2 (park) wins only in the park, E4 names an unknown
  scene, E5 a scene Erin never appears in, E8/E9 tie only in the park, E6 (rapport 3 while early) is
  `LIMIT_UNREACHABLE` at 1 talk/day and reachable with `--talks 2`; `frank` has a seated default figure on a standing
  slot (`SEATED_SLOT`) and a standing per-appearance figure that passes, and is met at home through an event.
- `fixtures/bad/`: `carol.csv` has a tie (C2/C3), a shadowed row (C4 under C5), an unreachable
  row (C6, rapport 3), a dangling `next` (C1 → C99), an unknown effect (`trust +1` on C3) and a malformed
  `cost -1` (C2, `BAD_VALUE`);
  `dave.csv` has no fallback.

## Modelling choices

- Pay when you stay, as in the engine (`FREE_TURNS` / `optionCharge` in `src/rules.ts`, mirrored as
  `FREE_TURNS` / `optionCharge` in `core.mjs`): starting a conversation is free and so are turns 1-3; the
  choice whose `next` row is turn 4 costs `DIALOGUE_COST` (1), once per conversation. An option's
  `cost N` token costs N; when both apply the choice costs max(N, 1) and the stay counts as paid. The
  search keeps the turn (1..4, 4 = "turn 4 or later, paid") in its key, so this is exact. `actions -N`
  adds N on top; event choices cost the event's `cost` (`cost N` in an event effect is an error).
  `cost N` with N not a non-negative integer is `BAD_VALUE`. (Until 2026-10-18 evening a conversation
  was charged 1 at its start when its opening row had depth >= 3.) The engine refuses to start a talk in
  a scene where tired() holds (0 actions away from home); the checker's costs are totals and ignore that.
- Tied cells use the first tied row in sheet order (what the runtime does) for reachability.
- An NPC with no `appearances` (TV-only) needs no sheet; if it has one, rows are not flagged
  unreachable.
- `met no` is not a valid effect (SPEC lists only `met yes`).
