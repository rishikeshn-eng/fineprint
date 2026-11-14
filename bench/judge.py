"""Validate fineprint on real LLM proofreads it was not tuned on (Llama-3.2-3B and Gemma-3-4B outputs).

Sample: 120 proofreads fineprint flagged (stratified by model, task, kind) + 80 it did not flag but
that contain edits. A Gemini judge sees the original, the edit, and fineprint's flagged changes, and says
  - for each flagged change: does it really change the meaning?          -> flag precision
  - is there any meaning change fineprint did NOT list?                  -> misses
Batched 12 pairs per request (free tier: ~20 requests/day for gemini-3.5-flash); responses cached.
  python bench/judge.py  -> results/judge.json, data/judge_labels.jsonl
"""
import hashlib
import json
import os
import random
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODEL = os.environ.get("JUDGE", "gemini-3.5-flash")
# when the primary judge's free daily quota runs out mid-run, remaining batches go to this sibling model
FALLBACK = os.environ.get("JUDGE_FALLBACK", "gemini-3.6-flash")
USED = {}
CACHE = ROOT / "data" / "judge_cache.jsonl"
rng = random.Random(3)

PROMPT = """You are checking an automatic tool that flags meaning changes in AI-proofread text.
The user asked an AI to fix grammar or make the text more professional WITHOUT changing its meaning.
For each item you get the ORIGINAL, the EDITED version, and the CHANGES the tool flagged (numbered).

For each item answer:
- "flags": for every flagged change, true if it really changes what the text says (a fact, number, unit,
  date, name, obligation like must/may, negation, scope like all/some, condition, direction, who does
  what, or drops/adds a substantive claim); false if it is only wording, grammar, formatting or a typo fix.
- "missed": true if the edit changes the meaning in a way NOT covered by any flagged change.
- "missed_what": a few words describing the missed change, or "".

{items}

Return JSON only: {{"items": [{{"id": "...", "flags": [true, false, ...], "missed": false, "missed_what": ""}}, ...]}}"""


def load_cache():
    if not CACHE.exists():
        return {}
    return {r["k"]: r["v"] for r in map(json.loads, open(CACHE))}


def call(prompt, cache):
    for model in (MODEL, FALLBACK):
        k = hashlib.sha1((model + prompt).encode()).hexdigest()
        if k in cache:
            USED[model] = USED.get(model, 0) + 1
            return cache[k]
    try:
        return _call(MODEL, prompt, cache)
    except QuotaOut:
        return _call(FALLBACK, prompt, cache)


class QuotaOut(Exception):
    pass


def _call(model_name, prompt, cache):
    global MODEL
    k = hashlib.sha1((model_name + prompt).encode()).hexdigest()
    from google import genai
    from google.genai import types
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    for attempt in range(8):
        try:
            r = client.models.generate_content(model=model_name, contents=prompt, config=types.GenerateContentConfig(
                temperature=0, max_output_tokens=4000, response_mime_type="application/json",
                thinking_config=types.ThinkingConfig(thinking_level="low"),
                http_options=types.HttpOptions(timeout=180000)))
            text = r.text or ""
            with open(CACHE, "a") as f:
                f.write(json.dumps({"k": k, "v": text}) + "\n")
            cache[k] = text
            USED[model_name] = USED.get(model_name, 0) + 1
            return text
        except Exception as e:  # noqa: BLE001
            msg = str(e)
            print("retry", attempt, msg[:120], file=sys.stderr, flush=True)
            if "PerDay" in msg or ("429" in msg and attempt >= 3):
                if model_name == FALLBACK:
                    raise SystemExit("both judges out of daily quota; rerun tomorrow (cached batches are kept)")
                raise QuotaOut()
            m = re.search(r"retry in ([0-9.]+)s", msg)
            time.sleep(float(m.group(1)) + 2 if m else 15 * (attempt + 1))
    return ""


def main():
    rows = [json.loads(l) for l in open(ROOT / "data" / "proofread_flags.jsonl")]
    pool = [r for r in rows if not r.get("empty") and r["model"] != "qwen3-1.7b" and not r["refused"]]
    flagged = [r for r in pool if r["flagged"]]
    clean = [r for r in pool if not r["flagged"] and r["edits"] > 0]
    # stratify flagged by (model, task), then shuffle kinds in
    rng.shuffle(flagged)
    strata = {}
    for r in flagged:
        strata.setdefault((r["model"], r["task"]), []).append(r)
    pick = []
    while len(pick) < 120 and any(strata.values()):
        for k in list(strata):
            if strata[k] and len(pick) < 120:
                pick.append(strata[k].pop())
    rng.shuffle(clean)
    sample = [dict(r, group="flagged") for r in pick] + [dict(r, group="clean") for r in clean[:80]]
    rng.shuffle(sample)
    cache = load_cache()
    labels = []
    for i in range(0, len(sample), 12):
        chunk = sample[i:i + 12]
        items = []
        for j, r in enumerate(chunk):
            ch = "\n".join(f"  {n + 1}. \"{c['before']}\" -> \"{c['after']}\"" for n, c in enumerate(r["changes"][:8])) or "  (none)"
            items.append(f"<item id=\"i{j}\">\nORIGINAL:\n{r['original']}\nEDITED:\n{r['edited'][:1500]}\nFLAGGED CHANGES:\n{ch}\n</item>")
        try:
            text = call(PROMPT.format(items="\n\n".join(items)), cache)
        except SystemExit as e:  # out of quota: report on the batches labelled so far
            print(e, file=sys.stderr)
            break
        try:
            got = {it["id"]: it for it in json.loads(text)["items"]}
        except Exception:  # noqa: BLE001
            got = {}
        for j, r in enumerate(chunk):
            g = got.get(f"i{j}")
            if not g:
                continue
            labels.append({"id": r["id"], "model": r["model"], "task": r["task"], "domain": r["domain"], "group": r["group"],
                           "kinds": [c["kinds"] for c in r["changes"][:8]], "flags": g.get("flags", []),
                           "missed": bool(g.get("missed")), "missed_what": g.get("missed_what", "")})
        print(f"batch {i // 12 + 1}/{(len(sample) + 11) // 12}", len(labels), flush=True)
    with open(ROOT / "data" / "judge_labels.jsonl", "w") as f:
        for l in labels:
            f.write(json.dumps(l, ensure_ascii=False) + "\n")
    # summarise
    fl = [l for l in labels if l["group"] == "flagged"]
    n_flags = sum(min(len(l["flags"]), len(l["kinds"])) for l in fl)
    true_flags = sum(sum(1 for x in l["flags"][:len(l["kinds"])] if x) for l in fl)
    pair_prec = sum(any(l["flags"]) for l in fl)
    per_kind = {}
    for l in fl:
        for ks, ok in zip(l["kinds"], l["flags"]):
            for k in ks:
                a = per_kind.setdefault(k, [0, 0])
                a[0] += bool(ok)
                a[1] += 1
    cl = [l for l in labels if l["group"] == "clean"]
    res = {"judge": " + ".join(f"{m} ({n} batches)" for m, n in USED.items()), "n_labelled": len(labels), "flagged_pairs": len(fl), "clean_pairs": len(cl),
           "flag_precision": [true_flags, n_flags], "pair_precision": [pair_prec, len(fl)],
           "per_kind_precision": per_kind, "missed_in_clean": [sum(l["missed"] for l in cl), len(cl)],
           "missed_in_flagged": [sum(l["missed"] for l in fl), len(fl)],
           "missed_examples": [l["missed_what"] for l in labels if l["missed"]][:30]}
    json.dump(res, open(ROOT / "results" / "judge.json", "w"), indent=1)
    print(json.dumps({k: v for k, v in res.items() if k != "missed_examples"}, indent=1))


if __name__ == "__main__":
    main()
