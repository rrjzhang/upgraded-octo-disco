# Indian pack: region and faith review

Sweep of 2026-10-18 for the profile follow-ups (region: north | south | skip; faith: hindu | muslim | skip). It covers the six `in_*` dialogue sheets, the Indian rows in `events.csv` and `news.csv`, and the `in:` text of the home bookshelf in `scenes.yaml`.

Rule applied: only text that assumes the **player's** background was templated. The NPCs keep their own identities: Mrs. Nair is Malayali, Harjit is a Sikh Punjabi, Karthik is Tamil, Anil is Gujarati, Meena is from Bengaluru and Mr. Deshpande is Marathi.

Severity:
- **blocks**: a Muslim or south-Indian player would be misaddressed.
- **soft**: mildly off for some players.
- **fine as is**: the NPC's own identity, or a hall event the NPC is describing.

## Changes made (word swaps)

| File | Row | Before | After | Placeholders |
|---|---|---|---|---|
| events.csv | ev_library_dana_hold_in | "a cookbook from the Kerala place on Fifth ... You said you missed their fish curry." | "a cookbook from {homeRestaurant} on Fifth ... You said you missed {homeSpecialty}." | {homeRestaurant}, {homeSpecialty} |
| events.csv | ev_daystart_mom_message_in | "making samosas ... how many to save you"; choice "Text: 'Ten. Will call Sunday.'" | "making {homeDish} ... how much to save you"; choice "Text: 'Save me plenty. Will call Sunday.'" (biryani is uncountable, so "how many" and "Ten" were changed) | {homeDish} |
| events.csv | ev_news_inc_interpreters_in | "phone interpreter line: Hindi, Punjabi, Malayalam, or about two hundred other languages ... an in-person Hindi and Punjabi interpreter" | "phone interpreter line: {homeLanguage}, or about two hundred other languages ... an in-person {homeLanguage} interpreter" (the choice is "Forward it to your mom", so the language must be hers) | {homeLanguage} |
| scenes.yaml | home bookshelf `textByPack.in` | "a small brass diya that only gets lit at Diwali" | "a small brass oil lamp your mother packed for you, still unlit" (no festival named; the room art still shows the diya, see below) | none |

Grammar was checked against every value: samosas / idlis / biryani; the Punjabi / Kerala / Hyderabadi place; their butter chicken / fish curry / haleem; Hindi / Tamil / Urdu.

**No placeholders were added.** The existing set covered every swap. The six dialogue sheets needed **no** cell changes.

## Dialogue sheets

### in_neighbor.csv (Mrs. Nair)

| Row | Line (shortened) | Assumption | Severity | Suggestion |
|---|---|---|---|---|
| LN24, LN25, LN34, LN47, LN48 | Malayalam class, Onam lunch, Anjali counting in Malayalam | NPC's own | fine as is | leave |
| LN26 | "Twenty dishes on a banana leaf ... You should come next year." | invites the player to her Onam lunch; assumes nothing about the player's own festival | fine as is | leave (Onam lunches at associations are often open to everyone) |
| LN51 | "Then Anjali started Sunday school here" | the hall's own program | fine as is | leave |

### in_stranger_a.csv (Harjit)

| Row | Line (shortened) | Assumption | Severity | Suggestion |
|---|---|---|---|---|
| HG01, HG40 | "Sat sri akal." | NPC's own greeting, said to anyone | fine as is | leave |
| HG24 to HG28 | langar invitation, "Anybody. Cover your head ..." | open invitation to anyone | fine as is | leave |
| HG51 | "This hall is everybody, Gujaratis, Tamils, Punjabis" | describes the hall | fine as is | leave. Optionally, a later pass could add "Hyderabadis" or similar so a Muslim player sees themselves in the hall too |

### in_stranger_b.csv (Karthik)

| Row | Line (shortened) | Assumption | Severity | Suggestion |
|---|---|---|---|---|
| KS40, KS32 to KS35, KS44 | "doing sound for the Diwali program"; player choices "See you at the program", "I'll come and watch the kids" | the hall's Diwali program is Karthik's (and his mother's) event; the player attends as a guest | soft | leave. For a Muslim player, "See you at the program" is a choice the player makes, not an assumption. A row-level faith condition (below) could offer an alternative choice |
| KS25 | player choice "My family's the same." (grandmother calls in Tamil, he answers in English) | the player picks it, generic | fine as is | leave |
| KS36, KS39 | friend's Pongal | NPC's friend | fine as is | leave |
| KS51 | "Tamil in room two, Hindi in room three" (help with the language school) | he asks the player to help teach; an Urdu-speaking player is not represented | soft | could become "Tamil in room two, Hindi in room three, Urdu on alternate Sundays", or stay as is (the school's real offering) |

### in_leader_asm.csv (Anil)

| Row | Line (shortened) | Assumption | Severity | Suggestion |
|---|---|---|---|---|
| AB24, AB55 | Gujarati, Ahmedabad | NPC's own | fine as is | leave |
| AB45 | "an interpreter on the phone now, Gujarati or Hindi or whatever you ask for" | describes his clients | fine as is | leave ("whatever you ask for" covers everyone) |

### in_leader_int.csv (Meena)

| Row | Line (shortened) | Assumption | Severity | Suggestion |
|---|---|---|---|---|
| MK22, MK24, MK26, MK27 | Diwali lanterns at the library; she invites the player to help at the table (ev_invite_meena) | her program; asks for help, not for shared faith | soft | leave. A Muslim player helping at a Diwali craft night is plausible and in keeping with her integration stance. See ev_invite_meena below |
| MK46 | "Tamil, Gujarati, Punjabi, Dari" | district list | fine as is | leave (could add Urdu) |
| MK49 | "The young ones come for the festivals and the food." | neutral already | fine as is | leave |

### in_leader_sep.csv (Mr. Deshpande)

| Row | Line (shortened) | Assumption | Severity | Suggestion |
|---|---|---|---|---|
| VD15 | "They come for Diwali, and they look at the ceiling." | the hall's biggest event is Diwali | soft | leave. A swap would make Pongal or Eid the hall's main event, which contradicts Karthik's and Meena's lines |
| VD17 | "The young ones come for Diwali and the food. You come on a Tuesday." | the player is set against the Diwali crowd and not assumed to be part of it | soft | leave, or neutralise to "come for the festivals and the food" (as Meena says in MK49) if Muslim players find the hall reads as a Hindu space |
| VD25 | "the Sunday language school, the roof fund, the Diwali program" | the hall's own programs | fine as is | leave |
| VD27, ev_invite_vasant | "My wife is making puran poli." | NPC's own (vegetarian, no faith issue) | fine as is | leave |

## events.csv and news.csv (Indian rows)

| Row | Line (shortened) | Assumption | Severity | Suggestion |
|---|---|---|---|---|
| ev_library_dana_hold_in | Kerala place / fish curry | region (Dana recalls what the *player* said they missed) | blocks, **fixed** | templated |
| ev_daystart_mom_message_in | mom making samosas | region and faith (what the player's mother cooks) | blocks, **fixed** | templated; "how many" / "Ten" made uncountable-safe |
| ev_news_inc_interpreters_in | Hindi, Punjabi, Malayalam; in-person Hindi and Punjabi; "Forward it to your mom" | language of the player's mother | blocks, **fixed** | templated with {homeLanguage}. A north-Indian Hindu player still sees Hindi |
| ev_invite_meena | "explains diyas to a girl from Ruth's homework club" | faith (the player volunteers at a Diwali event) | soft | leave; the player chose to go |
| ev_center_in_tiffin | Mrs. Nair's Onam leftovers: rice, sambar, payasam | NPC's own | fine as is | leave |
| ev_invite_vasant | puran poli | NPC's own | fine as is | leave |
| ev_park_chess_banter_in, ev_park_harjit_cricket | Harjit's chai and cricket | NPC's own | fine as is | leave |
| ev_home_nair_door, ev_invite_anil | none | none | fine as is | leave |
| tv_local_1_in | joint health fair; "volunteers who speak more than one language" | none | fine as is | leave |
| pr_inc_1_in | a county caseworker "who speaks Hindi and Punjabi" at the hall | describes a real-world service | soft | leave, or use "{homeLanguage} and Punjabi". Leaving it is more realistic, and nothing in the row addresses the player |

## scenes.yaml

| Item | Line (shortened) | Assumption | Severity | Suggestion |
|---|---|---|---|---|
| home bookshelf `textByPack.in` | "a small brass diya that only gets lit at Diwali" | faith (the player's household keeps Diwali) | blocks, **fixed** in text | now "a small brass oil lamp your mother packed for you, still unlit". **The art is not fixed:** the planned in-pack room (requests 194-199) shows an unlit brass diya, a block-print cushion and a tulsi plant. The tulsi is Hindu-coded and the diya mostly so. The room art needs a faith variant, or more neutral objects (block-print cushion, a steel tiffin, a framed print) |

## Noticed in cn/mx text (not touched)

- `ev_library_dana_hold` (cn) says "the Sichuan place on Grand ... their fish", while `pack.cn.homeRestaurant` / `homeSpecialty` are "the Sichuan place" / "their dan dan noodles". The cn and mx rows do not use the placeholders. If cn gets region variants later, these rows should be templated the same way.
- `ev_daystart_mom_message` (cn) uses zongzi while `pack.cn.homeDish` is dumplings. That is harmless today but would diverge once cn uses `{homeDish}`.
- `ev_news_inc_interpreters` (cn) lists "Mandarin, Cantonese", which already covers a regional split by listing both. That is a reasonable model if templating is not wanted.

## What the engine would need next

Some cases are not word problems but scene problems. They need a row-level condition on the profile dimensions, such as a `profile` column on dialogue and events rows (`faith=muslim`, `region=south`, `!faith=muslim`), matched like the existing `nationalLeader` / `playerLean` columns: blank means any, and the most specific match wins. Where it would help:

1. **The hall's Diwali program for a Muslim player** (KS40/KS32 to KS35, VD15/VD17, MK22 to MK27, ev_invite_meena). Today the player is always a guest at a Hindu festival, which is realistic. A faith-conditioned line would let Karthik or Deshpande mention that the hall also hosts an Eid dinner, or let VD17 read "The young ones come for the festivals", without breaking the hall's shared calendar.
2. **Home room art and bookshelf** (`byPack` images). The engine picks room images by pack only. A Muslim player's room would need a variant without the diya and the tulsi plant: `byPack` keyed as `in|faith=muslim`, using the same most-specific-wins rule as the strings.
3. **"Where are you from" moments.** None exist yet in the in sheets (no NPC guesses the player's region from their name). If writers add one ("You're from the south too?"), it should be a region-conditioned row, not a swap.
4. **Language-school help** (KS51): a region- or faith-conditioned choice ("I could help in the Urdu room") would let the player offer what they actually have.
