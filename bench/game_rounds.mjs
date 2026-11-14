// Build the "Red Pen" game rounds (docs/data/rounds.json) from the held-out gold pairs (legal + medical
// only, short passages) and, when available, judge-confirmed real AI edits (data/judge_labels.jsonl).
import fs from "node:fs";
import { compare, LABELS } from "../fineprint/fineprint.js";

const gold = fs.readFileSync("data/gold_test.jsonl", "utf8").trim().split("\n").map(JSON.parse)
  .filter(r => r.domain !== "everyday" && r.original.length <= 380);
const rounds = [];
for (const r of gold) {
  const res = compare(r.original, r.edited);
  const crit = res.changes.filter(c => c.severity >= 2);
  if (r.label === 0) { if (!crit.length) rounds.push({ src: "synthetic", domain: r.domain, orig: r.original, edited: r.edited, answer: { type: "clean" } }); continue; }
  if (!crit.length) continue;
  const c = crit[0];
  const cut = !c.b || c.kinds.includes("dropped");
  rounds.push({ src: "synthetic", domain: r.domain, orig: r.original, edited: r.edited,
    answer: { type: cut ? "cut" : "word", spans: crit.filter(x => x.b).map(x => x.b), kind: r.kind, label: LABELS[r.kind] || c.label, before: c.before, after: c.after } });
}
// real AI edits the judge confirmed (one confirmed flagged change, legal/medical, short)
const real = [];
if (fs.existsSync("data/judge_labels.jsonl")) {
  const flags = Object.fromEntries(fs.readFileSync("data/proofread_flags_v01.jsonl", "utf8").trim().split("\n").map(JSON.parse).map(r => [`${r.model}|${r.task}|${r.id}`, r]));
  for (const l of fs.readFileSync("data/judge_labels.jsonl", "utf8").trim().split("\n").map(JSON.parse)) {
    const r = flags[`${l.model}|${l.task}|${l.id}`];
    if (!r || l.group !== "flagged" || r.domain === "everyday" || r.original.length > 420 || r.edited.length > 520) continue;
    const ok = r.changes.map((c, i) => [c, l.flags[i]]).filter(([, v]) => v === true).map(([c]) => c);
    if (!ok.length) continue;
    const res = compare(r.original, r.edited);
    // keep only edits the current detector still flags the same way (labels come from the current version)
    const c = res.changes.find(x => x.severity >= 2 && ok.some(o => x.before === o.before && x.after === o.after));
    if (!c) continue;
    const cut = !c.after || (c.kinds || []).includes("dropped");
    real.push({ src: "ai", model: r.model, task: r.task, domain: r.domain, orig: r.original, edited: r.edited,
      answer: { type: cut ? "cut" : "word", spans: res.changes.filter(x => x.severity >= 2 && x.b).map(x => x.b), kind: c.kinds[0], label: c.kinds.map(k => LABELS[k]).join(" · "), before: c.before, after: c.after } });
  }
}
const out = { synthetic: rounds, ai: real };
fs.writeFileSync("docs/data/rounds.json", JSON.stringify(out));
const by = t => rounds.filter(r => r.answer.type === t).length;
console.log("synthetic rounds", rounds.length, { word: by("word"), cut: by("cut"), clean: by("clean") }, "ai rounds", real.length);
