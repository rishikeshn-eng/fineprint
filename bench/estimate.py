"""Judge-corrected estimate of how often a 'keep the meaning' proofread really changed the meaning.

For Llama-3.2-3B and Gemma-3-4B (the judged models), per task:
  P(changed) = P(flagged) * P(real | flagged) + P(not flagged) * P(real | not flagged)
P(flagged) comes from all their proofreads; the two conditionals from the judged sample (a pair is
'real' when the judge confirmed any flagged change or reported a missed one). 95% CIs by bootstrap
over proofreads and judged pairs.   python bench/estimate.py -> results/estimate.json
"""
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
rng = random.Random(0)
# flag rates from v0.1, the version whose flags the judge labelled
rows = [json.loads(l) for l in open(ROOT / "data" / "proofread_flags_v01.jsonl")]
labels = [json.loads(l) for l in open(ROOT / "data" / "judge_labels.jsonl")]
JUDGED = ("llama-3.2-3b-instruct", "gemma-3-4b-it")

out = {}
for task in ("grammar", "professional"):
    pool = [bool(r["flagged"]) for r in rows if r["model"] in JUDGED and r["task"] == task and not r.get("empty")]
    fl = [any(l["flags"]) or l["missed"] for l in labels if l["task"] == task and l["group"] == "flagged"]
    # unflagged-but-edited pairs: few exist for "professional", so pool tasks for P(real | not flagged)
    cl = [l["missed"] for l in labels if l["group"] == "clean"]

    def est(p, f, c):
        pf = sum(p) / len(p)
        return pf * (sum(f) / len(f)) + (1 - pf) * (sum(c) / len(c))

    point = est(pool, fl, cl)
    boots = sorted(est([rng.choice(pool) for _ in pool], [rng.choice(fl) for _ in fl], [rng.choice(cl) for _ in cl]) for _ in range(4000))
    out[task] = {"estimate": point, "ci95": [boots[100], boots[3899]], "p_flagged": sum(pool) / len(pool), "n_proofreads": len(pool),
                 "real_given_flagged": [sum(fl), len(fl)], "real_given_unflagged": [sum(cl), len(cl)]}
    print(task, f"{100 * point:.1f}% [{100 * boots[100]:.1f}, {100 * boots[3899]:.1f}]", out[task])
json.dump(out, open(ROOT / "results" / "estimate.json", "w"), indent=1)
