"""Collect source passages people actually ask an AI to polish.

  legal    : LEDGAR contract provisions (LexGLUE test split)
  medical  : FDA drug-label "dosage and administration" and "warnings" paragraphs (openFDA)
  everyday : text real users pasted into ChatGPT asking for a grammar fix (WildChat-1M, English)

Writes data/passages.jsonl: {id, domain, text}. 200 per domain, 120-700 characters.
"""
import glob
import json
import random
import re
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
WILDCHAT = sorted(glob.glob(str(Path.home() / "Downloads/claude/parda/data/raw/wildchat1m_*.parquet")))
rng = random.Random(0)
N = int(sys.argv[1]) if len(sys.argv) > 1 else 200


def clean(t):
    return re.sub(r"[ \t]+", " ", t).strip()


def ok_len(t):
    return 120 <= len(t) <= 700


rows = []

# legal
led = pd.read_parquet(RAW / "ledgar_test.parquet")
cands = [clean(t) for t in led.text if ok_len(clean(t)) and t.count(".") >= 1]
for i, t in enumerate(rng.sample(cands, N)):
    rows.append({"id": f"legal{i}", "domain": "legal", "text": t})

# medical
paras = []
for f in sorted(RAW.glob("fda_*.json")):
    for r in json.load(open(f))["results"]:
        for field in ("dosage_and_administration", "warnings", "do_not_use", "stop_use", "when_using"):
            for block in r.get(field, []):
                block = re.sub(r"^\s*[\d.]*\s*[A-Z &]{4,}\s+", "", block)  # drop section headings
                for p in re.split(r"(?<=[.])\s+(?=[A-Z])", block):
                    pass
                # keep paragraphs of a few sentences
                sents = re.split(r"(?<=[.!?])\s+", clean(block))
                cur = ""
                for s in sents:
                    if len(cur) + len(s) > 600:
                        if ok_len(cur):
                            paras.append(cur.strip())
                        cur = ""
                    cur += " " + s
                if ok_len(cur.strip()):
                    paras.append(cur.strip())
paras = list(dict.fromkeys(p for p in paras if not re.search(r"\[see|\(\d+\.\d+\)|Table \d", p)))
for i, t in enumerate(rng.sample(paras, N)):
    rows.append({"id": f"medical{i}", "domain": "medical", "text": t})

# everyday: user text after a proofreading request (WildChat-1M and ShareGPT first turns)
KW = (r"(?:proof ?read|grammar|grammatical|spelling|rephrase|paraphrase|polish|improve (?:this|the|my) "
      r"(?:text|paragraph|writing|email|sentence)|correct (?:this|the|my|it)|make (?:it|this) (?:sound )?(?:better|more professional))")
HEAD = re.compile(r"^[^\n]{0,160}?" + KW + r"[^:\n]{0,80}[:\n]+\s*", re.I)
TAIL = re.compile(r"\s*(?:\n|[.?!])\s*[^\n.?!]{0,100}" + KW + r"[^\n]{0,100}$", re.I)
every = []
for f in WILDCHAT:
    df = pd.read_parquet(f, columns=["conversation", "language", "toxic"])
    df = df[(df.language == "English") & (~df.toxic)]
    for conv in df.conversation:
        t = conv[0]["content"].strip()
        m = HEAD.match(t)
        if m:
            body = t[m.end():]
        else:
            m = TAIL.search(t[-260:])
            if not m:
                continue
            body = t[: len(t) - 260 + m.start()] if len(t) > 260 else t[: m.start()]
        body = clean(body).strip('"“” ')
        if ok_len(body) and body.count(" ") > 15 and "```" not in body and not re.search(KW, body[:60], re.I):
            every.append(body)
SHAREGPT = Path.home() / "Downloads/claude/parda/data/raw/sharegpt.json"
if SHAREGPT.exists():
    for conv in json.load(open(SHAREGPT)):
        turns = conv.get("conversations") or []
        if not turns or turns[0].get("from") != "human":
            continue
        t = (turns[0].get("value") or "").strip()
        m = HEAD.match(t)
        if m:
            body = t[m.end():]
        else:
            m = TAIL.search(t[-260:])
            if not m:
                continue
            body = t[: len(t) - 260 + m.start()] if len(t) > 260 else t[: m.start()]
        body = clean(body).strip('"“” ')
        if ok_len(body) and body.count(" ") > 15 and "```" not in body and not re.search(KW, body[:60], re.I):
            every.append(body)
CODE = re.compile(r"<-|[{};]\s*$|\bdef |\breturn\b|=>|\bfunction\b|\bimport \w|^\s*[#/]{1,2}", re.M)
every = [e for e in every if not CODE.search(e) and sum(c.isalpha() for c in e) / len(e) > 0.7]
every = list(dict.fromkeys(every))
print("everyday candidates", len(every), file=sys.stderr)
for i, t in enumerate(rng.sample(every, min(N, len(every)))):
    rows.append({"id": f"everyday{i}", "domain": "everyday", "text": t})

with open(ROOT / "data" / "passages.jsonl", "w") as f:
    for r in rows:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")
print(pd.Series([r["domain"] for r in rows]).value_counts().to_dict(), file=sys.stderr)
