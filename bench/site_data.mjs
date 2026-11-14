// Collect published numbers into docs/data/results.json (aggregates; clippings use contract and
// drug-label text only, never the user-written passages).
import fs from "node:fs";
const J = p => fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
const strip = m => m && { n: m.n, tp: m.tp, fp: m.fp, fn: m.fn, tn: m.tn, kind_correct_given_caught: m.kind_correct_given_caught, per_kind: m.per_kind, by_domain: m.by_domain };
const rounds = J("docs/data/rounds.json") || { ai: [] };
// clippings: one per kind first, then fill
// clippings: readable judge-confirmed changes, critical kinds first
const KEEP = ["negation", "number", "modal", "dropped", "condition", "unit", "date", "quantifier", "direction"];
const readable = r => (r.answer.before || "").length <= 90 && (r.answer.after || "").length <= 90 && ((r.answer.before || "").length > 2 || (r.answer.after || "").length > 2);
const clips = rounds.ai.filter(r => KEEP.includes(r.answer.kind) && readable(r))
  .sort((a, b) => KEEP.indexOf(a.answer.kind) - KEEP.indexOf(b.answer.kind)).slice(0, 8);
const out = {
  n_passages: fs.readFileSync("data/passages.jsonl", "utf8").trim().split("\n").length,
  study: J("results/proofread_study.json"), gold_dev: strip(J("results/gold_dev_metrics.json")), gold_test: strip(J("results/gold_test_metrics.json")),
  judge: J("results/judge.json"), estimate: J("results/estimate.json"), judged_by_version: J("results/judged_by_version.json"),
  clips: clips.map(r => ({ domain: r.domain, model: r.model, task: r.task, label: r.answer.label, before: r.answer.before, after: r.answer.after, orig: r.orig })),
};
fs.writeFileSync("docs/data/results.json", JSON.stringify(out));
console.log("results.json", (fs.statSync("docs/data/results.json").size / 1024).toFixed(1), "KB; clips", clips.length);
