"""Ask local LLMs to proofread every passage, the way people actually use them.

  python bench/proofread.py MODEL [MODEL ...]

PER_DOMAIN=100 restricts to the first 100 passages of each domain (passage ids are random draws).
Two instructions per passage ("grammar": fix grammar/spelling, keep meaning; "professional": make it
sound more professional, keep meaning). Greedy decoding, thinking disabled, resumable: rows already
in data/proofread/<model>.jsonl are skipped. One model in memory at a time.
"""
import gc
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "proofread"
OUT.mkdir(parents=True, exist_ok=True)

PROMPTS = {
    "grammar": "Fix the grammar and spelling in the text below. Do not change its meaning. "
               "Reply with the corrected text only.\n\n{text}",
    "professional": "Rewrite the text below so it sounds more professional. Keep the meaning exactly the same. "
                    "Reply with the rewritten text only.\n\n{text}",
}


def slug(m):
    return m.split("/")[-1].replace("-4bit", "").lower()


def main():
    passages = [json.loads(l) for l in open(ROOT / "data" / "passages.jsonl")]
    per_domain = int(os.environ.get("PER_DOMAIN", 0))  # 0 = all; larger models run on a fixed subset
    if per_domain:
        passages = [p for p in passages if int(p["id"].lstrip("abcdefghijklmnopqrstuvwxyz")) < per_domain]
    for model_id in sys.argv[1:]:
        out = OUT / f"{slug(model_id)}.jsonl"
        done = set()
        if out.exists():
            done = {(r["id"], r["task"]) for r in map(json.loads, open(out))}
        todo = [(p, t) for p in passages for t in PROMPTS if (p["id"], t) not in done]
        if not todo:
            continue
        from mlx_lm import batch_generate, load
        model, tok = load(model_id)

        def chat(p, t):
            msg = [{"role": "user", "content": PROMPTS[t].format(text=p["text"])}]
            try:
                return tok.apply_chat_template(msg, add_generation_prompt=True, enable_thinking=False)
            except TypeError:
                return tok.apply_chat_template(msg, add_generation_prompt=True)

        todo.sort(key=lambda pt: len(pt[0]["text"]))
        bs = 16
        with open(out, "a") as f:
            for i in range(0, len(todo), bs):
                chunk = todo[i:i + bs]
                longest = max(len(p["text"]) for p, _ in chunk)
                r = batch_generate(model, tok, [chat(p, t) for p, t in chunk],
                                   max_tokens=min(900, int(longest / 2.5) + 120))
                for (p, t), text in zip(chunk, r.texts):
                    f.write(json.dumps({"id": p["id"], "task": t, "model": slug(model_id), "output": text},
                                       ensure_ascii=False) + "\n")
                f.flush()
                if (i // bs) % 10 == 0:
                    print(f"{slug(model_id)} {i + len(chunk)}/{len(todo)}", flush=True)
        del model, tok
        gc.collect()
        try:
            import mlx.core as mx
            mx.clear_cache()
        except Exception:
            pass


if __name__ == "__main__":
    main()
