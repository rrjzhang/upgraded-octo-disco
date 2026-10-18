# Great Vote content checker

Validates the content pack against `demo/SPEC.md`, checks every dialogue sheet
for completeness over the 432-cell parameter space, and checks that every row
can actually be reached in play.

```
node tools/checker/check.mjs [--content public/content] [--report tools/checker/report] [--json]
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
   sound. Edges: talking to the NPC (shows the row that wins the cell; a choice costs 1 plus any
   `actions -N`), `next` follow-ups (free apart from `actions -N`), and choices of events whose
   `npc` is this NPC (cost = event `cost` + `actions -N`; `minRapport` respected; `invite`
   events only after an `invite` effect, or freely if another NPC's content invites them).
   Error: row unreachable. Warning: cheapest path > 40 actions. A witness path is reported for
   each reachable row, e.g. `A01/choice2 → A04/choice1 → A07  [at met=yes, ...]`.

## Codes

Errors: `MISSING_FILE`, `YAML_PARSE`, `CSV_PARSE`, `UNKNOWN_COLUMN`, `MISSING_COLUMN`,
`COLUMN_ORDER`, `FIELD_COUNT`, `SCHEMA`, `BAD_VALUE`, `BAD_CONDITION`, `UNKNOWN_EFFECT`,
`BAD_EFFECT`, `DANGLING_NEXT`, `DUPLICATE_ID`, `UNKNOWN_SCENE`, `UNKNOWN_SLOT`, `UNKNOWN_NPC`,
`MISSING_SHEET`, `MISSING_FALLBACK`, `TIE`, `NO_MATCH`, `UNREACHABLE`.
Warnings: `NEVER_WINS`, `OVER_BUDGET`, `FALLBACK_PRIORITY`, `NEVER_INVITED`, `INVITE_TRIGGER`,
`UNKNOWN_ASSET`. Info: `NO_APPEARANCES` (TV-only NPC; reachability not enforced).

## Fixtures

- `fixtures/good/`: 1 scene, 2 NPCs, an invite event and an overheard event. Passes clean.
- `fixtures/bad/`: `carol.csv` has a tie (C2/C3), a shadowed row (C4 under C5), an unreachable
  row (C6, rapport 3), a dangling `next` (C1 → C99) and an unknown effect (`trust +1` on C3);
  `dave.csv` has no fallback.

## Modelling choices

- Talking costs 1 action at the start of a conversation; follow-ups via `next` add nothing;
  `actions -N` adds N on top.
- Tied cells use the first tied row in sheet order (what the runtime does) for reachability.
- An NPC with no `appearances` (TV-only) needs no sheet; if it has one, rows are not flagged
  unreachable.
- `met no` is not a valid effect (SPEC lists only `met yes`).
