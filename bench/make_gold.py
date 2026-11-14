"""Gold set for fineprint: real passages, each edited the way a proofreader would, with exactly one
meaning change planted (positive) or none (negative).

Every pair gets 2-4 meaning-preserving "proofreading" edits (typo fixes, punctuation, synonyms,
contractions, number format, British/US spelling, article fixes). Positive pairs then get ONE
meaning-changing edit of a known kind. Mutation rules are written here independently of
fineprint's vocabularies.
  python bench/make_gold.py  -> data/gold.jsonl {id, domain, original, edited, label, kind}
"""
import json
import os
import random
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
rng = random.Random(int(os.environ.get("SEED", 7)))  # 7 = dev set, 11 = held-out test set

# ---------- meaning-preserving edits (applied original -> edited) ----------
SYN = [("utilize", "use"), ("purchase", "buy"), ("commence", "begin"), ("in order to", "to"), ("approximately", "about"),
       ("assist", "help"), ("obtain", "get"), ("additional", "extra"), ("regarding", "about"), ("sufficient", "enough"),
       ("prior to", "before"), ("in the event that", "if"), ("terminate", "end"), ("numerous", "many"),
       ("demonstrate", "show"), ("individuals", "people"), ("request", "ask for"), ("however", "but"), ("big", "large"),
       ("start", "begin"), ("quickly", "fast"), ("help", "assist"), ("show", "display"), ("get", "receive")]
# note: "prior to"->"before" and "in the event that"->"if" keep meaning; they are style edits
SPELL = [("organise", "organize"), ("colour", "color"), ("behaviour", "behavior"), ("licence", "license"),
         ("centre", "center"), ("favour", "favor"), ("analyse", "analyze"), ("judgement", "judgment")]
CONTR = [("do not", "don't"), ("does not", "doesn't"), ("is not", "isn't"), ("will not", "won't"), ("cannot", "can't"),
         ("are not", "aren't"), ("should not", "shouldn't"), ("it is", "it's")]
NUMW = {"1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten"}


def typo(word):
    if len(word) < 6:
        return word
    i = rng.randrange(1, len(word) - 2)
    return word[:i] + word[i + 1] + word[i] + word[i + 2:]


def benign_edit(orig, edit):
    """Return (orig', edit') after one style edit. Some edits change the ORIGINAL (introduce an error the
    proofreader then fixes), so the pair looks like real proofreading."""
    kind = rng.choice(["typo", "typo", "syn", "punct", "contr", "numw", "spell", "article", "space"])
    if kind == "typo":
        words = [w for w in re.findall(r"\b[a-z]{6,}\b", orig) if w in edit]
        if words:
            w = rng.choice(words)
            return re.sub(rf"\b{w}\b", typo(w), orig, count=1), edit
    if kind == "syn":
        cands = [(a, b) for a, b in SYN if re.search(rf"\b{a}\b", edit, re.I)]
        if cands:
            a, b = rng.choice(cands)
            return orig, re.sub(rf"\b{a}\b", b, edit, count=1, flags=re.I)
    if kind == "punct":
        m = list(re.finditer(r", (?=[a-z])", edit))
        if m:
            x = rng.choice(m)
            return orig, edit[:x.start()] + " " + edit[x.end():]
        m = list(re.finditer(r"\b(and|but|which)\b", edit))
        if m:
            x = rng.choice(m)
            return orig, edit[:x.start()] + ", " + edit[x.start():] if edit[x.start() - 2] != "," else edit
    if kind == "contr":
        cands = [(a, b) for a, b in CONTR if a in edit]
        if cands:
            a, b = rng.choice(cands)
            return orig, edit.replace(a, b, 1)
    if kind == "numw":
        m = list(re.finditer(r"(?<![\d.,/])\b([1-9]|10)\b(?![\d.,/%:])", edit))
        if m:
            x = rng.choice(m)
            return orig, edit[:x.start()] + NUMW[x.group(1)] + edit[x.end():]
    if kind == "spell":
        cands = [(a, b) for a, b in SPELL if a in edit]
        if cands:
            a, b = rng.choice(cands)
            return orig, edit.replace(a, b, 1)
    if kind == "article":
        m = list(re.finditer(r"\ban (?=[bcdfgjklmnpqrstvwxyz])|\ba (?=[aeio])", orig))
        if m:
            return orig, edit
        m = list(re.finditer(r"\ba (?=[bcdfgklmnpqrstvwz]\w+)", orig))
        if m:
            x = rng.choice(m)
            return orig[:x.start()] + "an " + orig[x.end():], edit
    if kind == "space":
        return orig.replace(". ", ".  ", 1), edit
    return orig, edit


# ---------- meaning-changing edits ----------
MODAL_SWAP = [("shall", "may"), ("must", "may"), ("must", "should"), ("will", "may"), ("may", "must"), ("should", "must"),
              ("may not", "must not"), ("can", "cannot")]
QUANT_SWAP = [("all", "some"), ("any", "certain"), ("each", "some"), ("every", "some"), ("only", "also"), ("always", "usually"),
              ("never", "rarely"), ("at least", "at most"), ("none", "some"), ("most", "all"), ("both", "either")]
DIR_SWAP = [("before", "after"), ("after", "before"), ("prior to", "after"), ("more", "less"), ("less", "more"),
            ("increase", "decrease"), ("decrease", "increase"), ("higher", "lower"), ("lower", "higher"), ("above", "below"),
            ("below", "above"), ("within", "after"), ("exceed", "reach"), ("including", "excluding")]
COND_SWAP = [("unless", "if"), ("if", "unless"), ("only if", "if"), ("until", "after"), ("provided that", "even if"), ("except", "including")]
UNIT_SWAP = [("mg", "g"), ("mL", "L"), ("hours", "days"), ("days", "weeks"), ("days", "months"), ("weeks", "months"),
             ("months", "years"), ("daily", "weekly"), ("%", " times"), ("tablets", "capsules"), ("minutes", "hours")]
MONTHS = ["January", "February", "March", "April", "June", "July", "August", "September", "October", "November", "December"]
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
NAMES = ["Smith", "Kumar", "Patel", "Johnson", "Garcia", "Chen", "Delaware", "New York", "California", "Texas", "London", "Mumbai"]


def word_swap(text, pairs):
    cands = [(a, b) for a, b in pairs if re.search(rf"(?<![\w-]){re.escape(a)}(?![\w-])", text)]
    if not cands:
        return None
    a, b = rng.choice(cands)
    return re.sub(rf"(?<![\w-]){re.escape(a)}(?![\w-])", b, text, count=1)


def mutate(text, kind):
    if kind == "number":
        m = list(re.finditer(r"(?<![\w.])(\d+(?:[.,]\d+)?)(?![\w])", text)) or []
        words = list(re.finditer(r"\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve|thirty|sixty|ninety)\b", text))
        if m:
            x = rng.choice(m)
            v = x.group(1).replace(",", "")
            try:
                n = float(v)
            except ValueError:
                return None
            new = rng.choice([n * 10, n / 10 if n >= 10 else n + 1, n + 1, n * 2, max(0, n - 1)]) if n else 1
            s = str(int(new)) if float(new).is_integer() else f"{new:.1f}"
            if s == v:
                s = str(int(n) + 5)
            return text[:x.start()] + s + text[x.end():]
        if words:
            x = rng.choice(words)
            alt = {"one": "two", "two": "three", "three": "five", "four": "six", "five": "ten", "six": "four", "seven": "five",
                   "eight": "six", "nine": "seven", "ten": "five", "twelve": "twenty", "thirty": "sixty", "sixty": "ninety", "ninety": "thirty"}
            return text[:x.start()] + alt[x.group(1)] + text[x.end():]
        return None
    if kind == "negation":
        for pat, rep in [(r"\b(is|are|was|were|will|shall|may|must|should|can|could|would|does|do|did) not\b", r"\1"),
                         (r"\bnot\b ", ""), (r"\bno\b", "any"), (r"\bnever\b", "always"), (r"\bwithout\b", "with")]:
            if re.search(pat, text):
                return re.sub(pat, rep, text, count=1)
        m = re.search(r"\b(is|are|shall|will|may|must|should|can)\b (?!not)", text)
        if m:
            return text[:m.end(1)] + " not" + text[m.end(1):]
        return None
    if kind == "modal":
        return word_swap(text, MODAL_SWAP)
    if kind == "quantifier":
        return word_swap(text, QUANT_SWAP)
    if kind == "direction":
        return word_swap(text, DIR_SWAP)
    if kind == "condition":
        return word_swap(text, COND_SWAP)
    if kind == "unit":
        return word_swap(text, UNIT_SWAP)
    if kind == "date":
        for pool in (MONTHS, DAYS):
            cands = [w for w in pool if re.search(rf"\b{w}\b", text)]
            if cands:
                w = rng.choice(cands)
                return re.sub(rf"\b{w}\b", rng.choice([x for x in pool if x != w]), text, count=1)
        m = re.search(r"\b(19|20)\d\d\b", text)
        if m:
            return text[:m.start()] + str(int(m.group()) + 1) + text[m.end():]
        return None
    if kind == "name":
        caps = [x for x in re.finditer(r"(?<=[a-z,] )[A-Z][a-z]{3,}(?: [A-Z][a-z]+)?", text)
                if x.group() not in MONTHS + DAYS and x.group().lower() not in {"agreement", "company", "party", "section"}]
        if caps:
            x = rng.choice(caps)
            new = rng.choice([n for n in NAMES if n != x.group()])
            return text[:x.start()] + new + text[x.end():]
        return None
    if kind == "dropped":
        # drop a clause: a comma/semicolon-delimited segment or a whole sentence (not the first)
        sents = re.split(r"(?<=[.;])\s+", text)
        if len(sents) >= 2:
            i = rng.randrange(1, len(sents))
            if len(sents[i].split()) >= 5:
                return " ".join(s for j, s in enumerate(sents) if j != i)
        segs = list(re.finditer(r", (?:and |or |but |including |provided |except |unless |which )[^,.;]{15,}", text))
        if segs:
            x = rng.choice(segs)
            return text[:x.start()] + text[x.end():]
        return None
    raise ValueError(kind)


KINDS = ["number", "negation", "modal", "quantifier", "direction", "condition", "unit", "date", "name", "dropped"]


def main():
    passages = [json.loads(l) for l in open(ROOT / "data" / "passages.jsonl")]
    rows = []
    for p in passages:
        for variant in range(2):
            orig = edit = p["text"]
            for _ in range(rng.randint(2, 4)):
                orig, edit = benign_edit(orig, edit)
            if variant == 0:
                rows.append({"id": f"{p['id']}_neg", "domain": p["domain"], "original": orig, "edited": edit,
                             "label": 0, "kind": None})
            else:
                kinds = KINDS[:]
                rng.shuffle(kinds)
                for k in kinds:
                    new = mutate(edit, k)
                    if new and new != edit:
                        rows.append({"id": f"{p['id']}_{k}", "domain": p["domain"], "original": orig, "edited": new,
                                     "label": 1, "kind": k})
                        break
    with open(ROOT / "data" / os.environ.get("OUT", "gold.jsonl"), "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    from collections import Counter
    print(len(rows), Counter(r["kind"] for r in rows))


if __name__ == "__main__":
    main()
