# Fuzz walker

A seeded random player. It drives the running game in headless Chrome over the DevTools protocol (no Playwright, no
new dependency), clicks what a player could click, checks invariants at every step, and writes one readable
transcript per seed plus a compact summary. It costs no model tokens to run; reading `summary.md` costs a few
hundred.

```
npm run dev                                  # in another terminal; the walker needs the dev server
npm run fuzz -- --seeds 20 --steps 500       # 20 playthroughs (seeds 1..20), 500 clicks each
node tools/fuzz/walk.mjs --seed 7 --steps 500   # one seed again: a repro
```

Options: `--start N` (first seed), `--base http://localhost:5173`, `--out <dir>` (default `tools/fuzz/out/<stamp>`,
git-ignored), `--chrome <path>` (default: Playwright's cached Chromium, else Google Chrome).

## What a seed does

- Starts a fresh dev room (`?dev=1&reset=1`). 30% of seeds answer the opening phone questions at random; the rest
  arrive with `&culture=` (and, for `in`, a random `&region=` / `&faith=` or none).
- Each step lists what is clickable: dialogue choices (choices that lead on weigh more than leaving, so conversations
  reach the material), figures, hotspots, exits, the phone (heavily when it rings), the phone's tabs and buttons,
  and inside a module window (survey, work, TV) its buttons and one click that answers every open radio group.
  Dev-only buttons (Back, edit, Show interactables) are never clicked. Weighted pick with a seeded RNG, so the same
  seed replays the same walk against the same content.
- Stops at the end of the demo week or when the step budget is spent.

## Invariants (a failure names seed and step)

- a JavaScript exception or `console.error`
- an unfilled `{placeholder}` in any text on screen
- actions below zero
- a dialogue on screen with no enabled choice
- stuck: nothing clickable for three steps in a row

Engine warnings tagged `[dialogue] [talk] [move] [pack] [survey]` are collected as notes (ties, refused moves).
Art `[content]` warnings about missing images are ignored.

## Output

`summary.md`: one row per seed (start condition, steps, day reached, finished, conversations, actions charged,
failures), dialogue-row and event coverage over the whole run, failures grouped by message with the seeds and
steps where they happened, and the most frequent engine notes. `summary.json` has the same with the row ids seen.
`seed-<n>.md`: the playthrough as the log recorded it (who said what, each choice, each event, each window),
then the raw click trace, then the failures and notes for that seed.

Exit code 1 when any seed failed, so it can gate a CI job once there is one.
