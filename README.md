# fineprint: did the AI change what you meant?

You ask a chatbot to "fix the grammar, don't change the meaning." **fineprint** diffs your text against what came back and flags only the edits that can change what it *says*:

- numbers and units
- dates
- negations
- obligations (must → may)
- scope (all → some)
- conditions (unless → if)
- direction (before → after)
- who does what
- clauses that quietly disappear

Spelling, commas and synonyms are left alone. It comes with **Red Pen**, a proofreading game, and a study of how often small models break the "keep the meaning" instruction.

**Live: https://rishikeshn-eng.github.io/fineprint/** · runs in your browser.

## Headline

Three local models (Qwen3-1.7B, Llama-3.2-3B, Gemma-3-4B) proofread 587 real passages: contract clauses, FDA drug-label dosing and warnings, and messages real users asked ChatGPT to fix. They got two instructions, both saying to keep the meaning. A Gemini 3.5 Flash judge then checked a sample.

| Instruction | Proofreads that changed the meaning (judge-corrected, Llama + Gemma, 95% CI) |
|---|---|
| "Fix the grammar and spelling … do not change its meaning" | **8.4%** [4.0, 13.2] |
| "Rewrite … more professional. Keep the meaning exactly the same" | **50.9%** [38.8, 63.5] |

Judge-confirmed examples:
- A children's antihistamine label lost "do not use … to make a child sleepy".
- A contract's "could not" became "would".
- "unless you have consulted a doctor" became "without prior medical consultation. Should…".
- "pending or threatened in writing" vanished from a litigation clause.

## Why this matters

Rewriting is one of the most common chatbot uses, and the instruction "keep the meaning" is taken on trust. A diff tool shows every changed comma, so nobody reads it. A silent change of "shall" to "may" in a lease, or a dropped warning on a drug label, is exactly the failure that slips through. This is an AI safety problem at the most ordinary scale: unfaithful edits that look like helpful ones. I found no free tool that separates meaning changes from style edits.

## How it works

1. **Diff.** Tokenise and run a Myers diff. Contractions are split ("don't" → do + not, and "dont" too), list numbers are ignored, and typo fixes ("subjcet" → "subject") are paired off.
2. **Classify each changed span** by what it touches:
   - number *values*: 3 = three, 1,000 = 1000, 2 lakh = 200000
   - units, counted with synonyms ("per day" = "daily")
   - negation count, and modal *strength* (shall = must > should > may)
   - quantifiers, conditions, and direction classes ("terminate" = "end", "on or before" = "by")
   - actors, capitalised names, and dropped or added clauses
3. **Confirm at sentence and passage level.** A category only counts if it also differs across the whole sentence and the whole passage, so a "not" that merely moved isn't reported.
4. **Severity.** Number, unit, negation, obligation and date changes are critical. Scope, condition, direction, names and dropped content are "check this". Who-does-what is minor.

One dependency-free ES module (`fineprint/fineprint.js`) is used by the site, the game and the benchmarks.

## Results

### Synthetic gold sets

Real passages get 2 to 4 harmless proofreading edits each, and half get one planted meaning change of a known kind. Seed 7 was used for development; seed 11 was held out.

| Set | Pairs | Precision | Recall | False alarms on harmless edits | Kind named right |
|---|---|---|---|---|---|
| Development | 1,165 | 99.8% | 99.1% | 0.2% | 97.2% |
| Held out | 1,166 | 99.8% | 98.8% | 0.2% | 98.3% |

### On real model edits: the honest number

The gold sets overstate real-world precision by a lot. A Gemini 3.5 Flash judge labelled 180 Llama and Gemma proofreads, models fineprint was not tuned on (v0.1 was tuned on Qwen's outputs only):
- 105 that fineprint flagged, checking each flag
- 75 it didn't flag, looking for misses

| | v0.1 | v0.2 |
|---|---|---|
| Flags that are real meaning changes, Llama (dev for v0.2) | 32/171 | 29/133 |
| Flags that are real meaning changes, Gemma (held out) | 21/148 | **20/122** |
| … on "fix the grammar" edits (held out) | | **8/21 (38%)** |
| … on full "professional" rewrites (held out) | | 12/101 (12%) |
| Unflagged edits where the judge found a change | 4/75 (5%) | |

So fineprint **rarely misses**, but most of its flags on real rewrites are noise. A rewrite changes so many words that a word-level checker can't tell paraphrase from a change of meaning. Use it as a highlighter that says *where to look*. It's most useful on light edits.

v0.2 changed two things, developed on the Llama labels and measured on Gemma: passage-level confirmation, and "who does it" demoted to minor. It cut false flags by about a fifth and lost 1 of 21 real ones on the held-out model.

### Raw flag rates by model (all 587 passages for Qwen, 300 per model for Llama and Gemma)

| Model | Grammar: critical flag | Professional: critical flag |
|---|---|---|
| Qwen3-1.7B | 5.8% | 51.3% |
| Llama-3.2-3B | 11.7% | 71.3% |
| Gemma-3-4B | 10.0% | 74.0% |

These are flags, not confirmed changes; the judge-corrected table at the top is the one to quote. By text type, drug labels were rewritten most aggressively: 72.5% of professional rewrites carried a critical flag, against 49.8% for contracts.

## Reproduce

```bash
npm test
python bench/make_passages.py                 # needs data/raw: LEDGAR test parquet, openFDA label pages, WildChat-1M/ShareGPT
python bench/make_gold.py && SEED=11 OUT=gold_test.jsonl python bench/make_gold.py
node bench/eval_gold.mjs data/gold_test.jsonl
python bench/proofread.py mlx-community/Qwen3-1.7B-4bit          # Apple silicon, mlx-lm
PER_DOMAIN=100 python bench/proofread.py mlx-community/Llama-3.2-3B-Instruct-4bit mlx-community/gemma-3-4b-it-4bit
node bench/analyze_proofread.mjs
DETECTOR=../data/fineprint_v01.js OUT=proofread_flags_v01 node bench/analyze_proofread.mjs
python bench/judge.py && python bench/estimate.py && node bench/eval_judged.mjs   # GEMINI_API_KEY
node bench/game_rounds.mjs && node bench/site_data.mjs
```

## Limitations

- **Word-level, English only.** A paraphrase that changes meaning without touching a number, a negation or one of its keyword lists can slip by ("the tenant pays" → "the landlord covers it"). The judge found 4 such misses in 75 unflagged edits.
- **Low precision on full rewrites** (about 1 real flag in 8); see above.
- **Small judge sample.** The judge is itself a model. Its daily free-tier quota ran out after 15 of 17 batches, so 180 of the planned 200 pairs were labelled. CIs are wide.
- **Small proofreaders.** The models are 1.7B to 4B, 4-bit, run locally. Frontier models probably change meaning less often; this study doesn't measure them.
- **"Day" is ambiguous.** "The 5th day of each month" → "the 5th of every month" is read as a dropped unit.
- **The synthetic gold mutations** were written by the same person who wrote the detector.

MIT licensed. Built by [Rishikesh](https://rishikeshn-eng.github.io/). Passages: LEDGAR (via LexGLUE), openFDA drug labels (public domain), WildChat-1M (ODC-BY) and ShareGPT. The site's clippings and game use only the contract and drug-label passages.
