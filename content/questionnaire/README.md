# End-of-day questionnaire (`eod.json`)

Going to bed (or the phone Call tab at 0 actions) opens `public/modules/survey.html`, which renders `eod.json`. Players see it as a short "check-in call" before bed. They never see any scores.

Current version: `eod-biis2-v2` (2026-10-19), shortened from the full 17-item BIIS-2 (`eod-biis2-v1`). The id is logged as the survey line's `target`, so analysis can tell the two apart.

## Items, in order

| page | id | type | text | values |
|---|---|---|---|---|
| 1 | `biis2_10` | likert | I feel caught between {H} and {M} cultures. | 1-5 agreement; harmony, **reverse-coded** |
| 1 | `biis2_03` | likert | I find it easy to balance both {H} and {M} cultures. | 1-5 agreement; harmony |
| 1 | `biis2_14` | likert | I feel {H}-{M}. | 1-5 agreement; blendedness |
| 1 | `biis2_17` | likert | I keep {H} and {M} cultures separate. | 1-5 agreement; blendedness, **reverse-coded** |
| 2 | `fit_community` | scale | How much do you feel like you fit in with your local community? | 1-5; 1 Not at all, 3 Somewhat, 5 Very much |
| 2 | `feel_today` | scale | How do you feel today? | 0-9; 0 Very bad, 5 Neutral, 9 Very good |
| 2 | `mood` | choice | Which word comes closest to how today felt? | Calm, Busy, Torn, Lonely, Good |
| 2 | `belong_today` | choice | Where did you feel most like yourself today? | six places |
| 2 | `note` | text | Anything from today you want to remember? (optional) | free text, optional |

Notes for comparing with v1 logs:

- The four BII items keep their v1 ids (the published BIIS-2 item numbers), so they line up with v1 logs. `biis2_10` was "I feel caught between **the** {H} and {M} cultures." in v1; v2 drops "the" (same item, the researcher's wording).
- `mood` option "Settled" was renamed "Calm" in v2; the other options are unchanged.
- `fit_community` and `feel_today` are new in v2.

## Instrument (page 1)

Page 1 is a 4-item short form of the **Bicultural Identity Integration Scale, Version 2 (BIIS-2)** (published items 3, 10, 14, 17), each answered on a 5-point scale (1 Strongly disagree, 2 Disagree, 3 Neutral, 4 Agree, 5 Strongly agree).

> Huynh, Q.-L., Benet-Martínez, V., & Nguyen, A.-M. D. (2018). Measuring variations in bicultural identity across U.S. ethnic and generational groups: Development and validation of the BIIS-2. *Psychological Assessment*. doi:10.1037/pas0000606

Page 2 holds the game's own check-in items. These are not part of BIIS-2.

Item text uses two placeholders, which the module fills in (also in `anchors` and `options`):

- `{H}` is the heritage culture, taken from the player's home culture: `cn` Chinese, `mx` Mexican, `in` Indian (`instrument.placeholders.H.byHomeCulture`). If the host does not pass the culture, the module uses `heritage`, and the log records `labels.homeCulture: null`.
- `{M}` is the mainstream culture: American (`instrument.placeholders.M.value`).

## Item types

Every item has `id`, `type` and `text`. Types:

| type | extra fields | answer logged as |
|---|---|---|
| `likert` | `scale: {min, max, labels[], minLabel, maxLabel}` | number. Consecutive likert items with the same `scale` render as one matrix. |
| `scale` | `min`, `max` (integers, at most 11 points), `anchors: {"<value>": "word"}` (optional; values without a word show only the number) | number. Rendered as one row of numbered radio buttons, anchor words under their numbers. |
| `choice` | `options: []` | the chosen option string |
| `text` | none | string; optional |

Every `likert`, `scale` and `choice` item must be answered before Next/Submit; `text` items are optional. Arrow keys move within a row (each item is one radio group).

Example `scale` item:

```json
{ "id": "feel_today", "type": "scale", "text": "How do you feel today?", "min": 0, "max": 9,
  "anchors": { "0": "Very bad", "5": "Neutral", "9": "Very good" } }
```

## BIIS-2 item metadata

Each BIIS-2 item has these fields on top of the base schema:

| field | values | meaning |
|---|---|---|
| `id` | `biis2_NN` | stable id (NN = published item number); used as the answer key in the log |
| `n` | 1-17 | published item number |
| `instrument` | `biis2` | which instrument the item belongs to |
| `subscale` | `harmony` \| `blendedness` | which dimension the item counts toward |
| `reverse` | true/false | reverse-scored (min + max − x, i.e. 6 − x) for the subscale mean |
| `facet` | `harmony` \| `conflict` \| `blend` \| `comp` | raw half (not reversed) |

## Scoring (done in the module, at submit)

- **harmony** is the mean of `biis2_03` and reversed `biis2_10`.
- **blendedness** is the mean of `biis2_14` and reversed `biis2_17`.
- Raw halves (not reversed), one item each in v2: **harmonyRaw** `biis2_03`, **conflictRaw** `biis2_10`, **blendRaw** `biis2_14`, **compRaw** `biis2_17`.

All scores fall between 1 and 5 and are rounded to 3 decimals. Higher harmony means less felt conflict between the two cultures. Higher blendedness means the two identities feel more fused and less kept apart. With two items per subscale these are rough indicators; they are **not comparable** to the 17-item scores in v1 logs or to the published reference means (Huynh et al., 2018, whole sample, Harmony / Blendedness 3.63 / 4.00, from the full scale). The `scale` items are not scored.

The submitted `answers` object (logged unchanged as a `survey` line) holds every item id with its value, plus:

```json
"instrument": "biis2-4",
"labels": { "H": "Chinese", "M": "American", "homeCulture": "cn" },
"scores": { "harmony": 3.5, "blendedness": 4, "harmonyRaw": 4, "conflictRaw": 2, "blendRaw": 4, "compRaw": 2 }
```

So do not give any item the id `instrument`, `labels`, `scores` or `filledRandomly` (the validator rejects these and duplicate ids).

## Swapping or editing items

- To change wording, edit `text` and keep `{H}` and `{M}` where the culture names go. Keep each `id` stable so logs stay comparable across versions. If the instrument itself changes, bump the top-level `id` (currently `eod-biis2-v2`).
- To use a different instrument, replace the page-1 items. Scoring is driven entirely by `subscale`, `reverse` and `facet` on `likert` items. The module reports `harmony` and `blendedness` means and the four `facet` raw halves. A new instrument with other subscale or facet names needs a small change to `scoreInstrument()` in `survey.html`. Set `instrument.id` to the new instrument's id. Remove the `instrument` block to submit answers with no scores.
- `questionnaireProblems()` in `src/content.ts` checks each item's `id` and `type` (`likert` | `choice` | `text` | `scale`), a `scale` item's range and anchors, duplicate and reserved ids. Unknown fields are passed through to the module.
