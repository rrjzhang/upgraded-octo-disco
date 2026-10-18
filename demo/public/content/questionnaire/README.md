# End-of-day questionnaire (`eod.json`)

Going to bed (or the phone Call tab at 0 actions) opens `public/modules/survey.html`, which renders `eod.json`. Players see it as a short "check-in call" before bed. They never see any scores.

## Instrument

Page 1 is the **Bicultural Identity Integration Scale, Version 2 (BIIS-2)**: 17 items, in published order, each answered on a 5-point scale (1 Strongly disagree, 2 Disagree, 3 Neutral, 4 Agree, 5 Strongly agree).

> Huynh, Q.-L., Benet-Martínez, V., & Nguyen, A.-M. D. (2018). Measuring variations in bicultural identity across U.S. ethnic and generational groups: Development and validation of the BIIS-2. *Psychological Assessment*. doi:10.1037/pas0000606

Page 2 keeps the game's own check-in items (`mood`, `belong_today` and an optional `note`). These are not part of BIIS-2.

Item text uses two placeholders, which the module fills in:

- `{H}` is the heritage culture, taken from the player's home culture: `cn` Chinese, `mx` Mexican, `in` Indian (`instrument.placeholders.H.byHomeCulture`). If the host does not pass the culture, the module uses `heritage`, and the log records `labels.homeCulture: null`.
- `{M}` is the mainstream culture: American (`instrument.placeholders.M.value`). This is the original wording.

## Item metadata

Each BIIS-2 item has these fields on top of the base schema (`id`, `type`, `text`, `scale`):

| field | values | meaning |
|---|---|---|
| `id` | `biis2_01` … `biis2_17` | stable id; used as the answer key in the log |
| `n` | 1–17 | published item number |
| `instrument` | `biis2` | which instrument the item belongs to |
| `subscale` | `harmony` \| `blendedness` | which dimension the item counts toward |
| `reverse` | true/false | reverse-scored (6 − x) for the subscale mean |
| `facet` | `harmony` \| `conflict` \| `blend` \| `comp` | raw half (not reversed) |

`scale.labels` names all five points. The matrix header uses those names, and older `minLabel` and `maxLabel` stay in place for other consumers.

## Scoring (done in the module, at submit)

- **harmony** is the mean of items 1–10, with items 5–10 reversed (6 − x).
- **blendedness** is the mean of items 11–17, with items 16–17 reversed.
- Raw halves (not reversed): **harmonyRaw** is items 1–4, **conflictRaw** items 5–10, **blendRaw** items 11–15, **compRaw** (compartmentalization) items 16–17.

All scores fall between 1 and 5 and are rounded to 3 decimals. Higher harmony means less felt conflict between the two cultures. Higher blendedness means the two identities feel more fused and less kept apart. The two dimensions correlate at about r = .30. There are no published cutoffs or SDs. If you need a "high" or "low" BII label, define it in analysis, for example relative to the reference means.

Reference means from Huynh et al., 2018 (Harmony / Blendedness): whole sample 3.63 / 4.00; first generation 3.57 / 3.85; second generation 3.67 / 4.10; Asian American 3.66 / 4.00; Latino/a 3.69 / 4.11; multiracial 3.65 / 3.94; Middle Eastern 3.18 / 3.80; African American 3.51 / 3.81; European American 3.63 / 3.49.

The submitted `answers` object (it is logged unchanged as a `survey` line) holds every item id with its value, plus:

```json
"instrument": "biis2",
"labels": { "H": "Chinese", "M": "American", "homeCulture": "cn" },
"scores": { "harmony": 3.8, "blendedness": 4.143, "harmonyRaw": 4, "conflictRaw": 2.333, "blendRaw": 4, "compRaw": 1.5 }
```

So do not give any item the id `instrument`, `labels` or `scores`.

## Swapping or editing items

- To change wording, edit `text` and keep `{H}` and `{M}` where the culture names go. Keep each `id` stable so logs stay comparable across versions. If the instrument itself changes, bump the top-level `id` (currently `eod-biis2-v1`); it is logged as the survey line's `target`.
- To use a different instrument, replace the page-1 items. Scoring is driven entirely by `subscale`, `reverse` and `facet`. The module reports `harmony` and `blendedness` means and the four `facet` raw halves. A new instrument with other subscale or facet names needs a small change to `scoreInstrument()` in `survey.html`. Set `instrument.id` to the new instrument's id. Remove the `instrument` block to submit answers with no scores.
- Likert items in a row that share a `scale` render as one matrix. Every `likert` and `choice` item must be answered before Next/Submit; `text` items are optional.
- The engine checks only that each item has an `id` and a `type` (`likert` | `choice` | `text`). Unknown fields are passed through to the module.
