// Score fineprint on the gold pairs. A pair is flagged when any change has severity >= 2
// (number, unit, negation, modal, date = 3; quantifier, condition, direction, actor, name, dropped = 2).
//   node bench/eval_gold.mjs data/gold.jsonl [--out results/gold_metrics.json]
import fs from "node:fs";
import { compare } from "../fineprint/fineprint.js";
const [, , path, flag, out] = process.argv;
const rows = fs.readFileSync(path, "utf8").trim().split("\n").map(JSON.parse);
const per = {}, byDomain = {}, fps = [], fns = [];
let tp = 0, fp = 0, fn = 0, tn = 0, kindRight = 0;
const t0 = performance.now();
for (const r of rows) {
  const res = compare(r.original, r.edited);
  const flagged = res.changes.filter(c => c.severity >= 2);
  const hit = flagged.length > 0;
  const d = (byDomain[r.domain] ??= { tp: 0, fp: 0, fn: 0, tn: 0 });
  if (r.label) {
    const k = (per[r.kind] ??= { n: 0, caught: 0, kind_right: 0 });
    k.n++;
    if (hit) { tp++; d.tp++; k.caught++; const kinds = new Set(flagged.flatMap(c => c.kinds)); const want = { name: ["name", "name_spelling"] }[r.kind] || [r.kind]; if (want.some(w => kinds.has(w))) { k.kind_right++; kindRight++; } }
    else { fn++; d.fn++; fns.push({ id: r.id, kind: r.kind, orig: r.original.slice(0, 160), edit: r.edited.slice(0, 160) }); }
  } else {
    if (hit) { fp++; d.fp++; fps.push({ id: r.id, flags: flagged.map(c => `${c.kinds.join("+")}: "${c.before}" -> "${c.after}"`) }); }
    else { tn++; d.tn++; }
  }
}
const ms = (performance.now() - t0) / rows.length;
const P = tp / (tp + fp), R = tp / (tp + fn);
const res = { n: rows.length, tp, fp, fn, tn, precision: P, recall: R, f1: 2 * P * R / (P + R), false_alarm_rate: fp / (fp + tn), kind_correct_given_caught: kindRight / tp,
  per_kind: per, by_domain: byDomain, ms_per_pair: ms,
  // examples from user-written passages stay local; contract and drug-label text is public
  false_alarms: fps.filter(x => !x.id.startsWith("everyday")).slice(0, 40), misses: fns.filter(x => !x.id.startsWith("everyday")).slice(0, 40) };
if (flag === "--out") { fs.mkdirSync("results", { recursive: true }); fs.writeFileSync(out, JSON.stringify(res, null, 1)); }
console.log(JSON.stringify({ n: res.n, P: P.toFixed(3), R: R.toFixed(3), FAR: res.false_alarm_rate.toFixed(3), kindOK: res.kind_correct_given_caught.toFixed(3), ms: ms.toFixed(2) }));
for (const [k, v] of Object.entries(per)) console.log(k.padEnd(11), `${v.caught}/${v.n}`, "kind ok", v.kind_right);
console.log("FALSE ALARMS"); fps.slice(0, 14).forEach(x => console.log(" ", x.id, x.flags.join(" | ").slice(0, 200)));
console.log("MISSES"); fns.slice(0, 10).forEach(x => console.log(" ", x.id, x.kind, "|", x.edit.slice(0, 150)));
