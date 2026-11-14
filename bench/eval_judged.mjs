// Re-score fineprint against the judge's labels without new API calls. The judge labelled each change
// fineprint v0.1 flagged; a later version's flags are matched to those by (before, after) text.
// Split by model: Llama-3.2-3B pairs = development, Gemma-3-4B pairs = test.
//   node bench/eval_judged.mjs [--out results/judged_by_version.json]
import fs from "node:fs";
import { compare } from "../fineprint/fineprint.js";
// the judge labelled the change list produced by v0.1 (saved copy), index by index
import { compare as compareV1 } from "../data/fineprint_v01.js";
import { cleanOutput } from "./analyze_proofread.mjs";

const flags = Object.fromEntries(fs.readFileSync("data/proofread_flags.jsonl", "utf8").trim().split("\n").map(JSON.parse)
  .filter(r => !r.empty).map(r => [`${r.model}|${r.task}|${r.id}`, r]));
const labels = fs.readFileSync("data/judge_labels.jsonl", "utf8").trim().split("\n").map(JSON.parse);
const res = {};
for (const l of labels) {
  const r = flags[`${l.model}|${l.task}|${l.id}`];
  if (!r) continue;
  const split = l.model.startsWith("llama") ? "dev (Llama)" : "test (Gemma)";
  const a = (res[split] ??= { pairs: 0, v1_flags: 0, v1_true: 0, v2_flags: 0, v2_true: 0, true_dropped: 0, v1_pairs_flagged: 0, v2_pairs_flagged: 0,
    v1_pairs_real: 0, v2_pairs_real: 0, clean_pairs: 0, clean_missed: 0, v2_new_unjudged: 0 });
  a.pairs++;
  if (l.group === "clean") { a.clean_pairs++; a.clean_missed += l.missed; }
  const v1 = compareV1(r.original, r.edited).changes.filter(c => c.severity >= 2);
  if (l.group === "flagged" && v1.length !== l.kinds.length && Math.min(v1.length, 8) !== l.kinds.length) a.misaligned = (a.misaligned || 0) + 1;
  const old = v1.slice(0, 8).map((c, i) => ({ ...c, real: l.flags[i] === true }));
  const now = compare(r.original, r.edited).changes.filter(c => c.severity >= 2);
  const real = old.filter(c => c.real);
  a.v1_flags += old.length; a.v1_true += real.length;
  a.v1_pairs_flagged += old.length > 0; a.v1_pairs_real += old.length > 0 && real.length > 0;
  let t = 0, n = 0;
  for (const c of now) {
    const m = old.find(o => o.before === c.before && o.after === c.after);
    if (!m) { a.v2_new_unjudged++; continue; }
    n++; t += m.real;
  }
  a.v2_flags += n; a.v2_true += t;
  const bt = (a.v2_by_task ??= {}); const tt = (bt[l.task] ??= [0, 0]); tt[0] += t; tt[1] += n;
  a.true_dropped += real.filter(c => !now.some(x => x.before === c.before && x.after === c.after)).length;
  a.v2_pairs_flagged += n > 0; a.v2_pairs_real += n > 0 && t > 0;
}
for (const [k, a] of Object.entries(res)) {
  console.log(k.padEnd(14), `v1 flag precision ${a.v1_true}/${a.v1_flags}`, `-> v2 ${a.v2_true}/${a.v2_flags}`,
    `| real flags lost ${a.true_dropped}/${a.v1_true}`, `| flagged pairs ${a.v1_pairs_flagged} -> ${a.v2_pairs_flagged} (real ${a.v1_pairs_real} -> ${a.v2_pairs_real})`,
    `| unjudged new ${a.v2_new_unjudged}`, `| misaligned ${a.misaligned || 0}`);
}
if (process.argv[2] === "--out") fs.writeFileSync(process.argv[3], JSON.stringify(res, null, 1));
