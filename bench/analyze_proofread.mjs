// Run fineprint over every LLM proofread and summarise how often "keep the meaning" edits did not.
//   node bench/analyze_proofread.mjs   -> results/proofread_study.json, data/proofread_flags.jsonl
import fs from "node:fs";
// DETECTOR=../data/fineprint_v01.js OUT=proofread_flags_v01 reproduces the change lists the judge labelled
const { compare } = await import(process.env.DETECTOR || "../fineprint/fineprint.js");
const OUTNAME = process.env.OUT || "proofread_flags";

const passages = Object.fromEntries(fs.readFileSync("data/passages.jsonl", "utf8").trim().split("\n").map(JSON.parse).map(p => [p.id, p]));

/** Strip wrappers the model adds around its answer, so they don't count as "added content". */
export function cleanOutput(t) {
  let s = (t || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  // leading preamble line: "Here is the corrected text:" / "Sure! Here's a more professional version:"
  s = s.replace(/^(?:\*\*)?(?:sure[!,.]?\s*)?(?:here(?:'s| is| are)|below is|the (?:corrected|revised|rewritten)|corrected (?:text|version)|revised (?:text|version)|rewritten (?:text|version))[^\n]{0,120}:\s*(?:\*\*)?\s*\n+/i, "");
  // trailing commentary block
  s = s.replace(/\n\s*\n\s*(?:\*\*)?(?:note|notes|changes(?: made)?|explanation|i (?:made|changed|corrected|have)|key changes|summary of changes|let me know|corrections)\b[\s\S]*$/i, "");
  s = s.replace(/^["“'`]{1,3}|["”'`]{1,3}$/g, "").replace(/^```\w*\n?|\n?```$/g, "").trim();
  return s;
}

if (import.meta.url === `file://${process.argv[1]}`) main();

function main() {
const files = fs.readdirSync("data/proofread").filter(f => f.endsWith(".jsonl"));
const rows = [];
for (const f of files) {
  for (const line of fs.readFileSync(`data/proofread/${f}`, "utf8").trim().split("\n")) {
    const r = JSON.parse(line);
    const p = passages[r.id];
    const edited = cleanOutput(r.output);
    if (!edited) { rows.push({ ...r, domain: p.domain, empty: true }); continue; }
    const res = compare(p.text, edited);
    const flagged = res.changes.filter(c => c.severity >= 2);
    rows.push({ id: r.id, task: r.task, model: r.model, domain: p.domain, edits: res.stats.edits,
      critical: res.stats.critical, flagged: flagged.length, verdict: res.stats.verdict,
      kinds: [...new Set(flagged.flatMap(c => c.kinds))], changes: flagged.map(c => ({ kinds: c.kinds, before: c.before, after: c.after, severity: c.severity })),
      original: p.text, edited, refused: /^(i'?m sorry|i can(?:not|'t)|as an ai)/i.test(edited) });
  }
}
fs.writeFileSync(`data/${OUTNAME}.jsonl`, rows.map(r => JSON.stringify(r)).join("\n") + "\n");

// summary: share of proofreads with >=1 critical / >=1 flagged change, by model x task x domain
const key = r => `${r.model}|${r.task}|${r.domain}`;
const agg = {};
const KINDS = ["number", "unit", "negation", "modal", "date", "quantifier", "condition", "direction", "actor", "name", "dropped", "added"];
for (const r of rows) {
  if (r.empty) continue;
  for (const k of [key(r), `${r.model}|${r.task}|all`, `all|${r.task}|${r.domain}`, `all|${r.task}|all`]) {
    const a = (agg[k] ??= { n: 0, critical: 0, flagged: 0, refused: 0, kinds: Object.fromEntries(KINDS.map(x => [x, 0])) });
    a.n++; a.critical += r.critical > 0; a.flagged += r.flagged > 0; a.refused += r.refused;
    for (const x of r.kinds) if (x in a.kinds) a.kinds[x]++;
  }
}
const out = Object.entries(agg).map(([k, v]) => { const [model, task, domain] = k.split("|"); return { model, task, domain, ...v }; });
fs.mkdirSync("results", { recursive: true });
if (!process.env.OUT) fs.writeFileSync("results/proofread_study.json", JSON.stringify(out, null, 1));
for (const r of out.filter(r => r.domain === "all").sort((a, b) => a.model.localeCompare(b.model) || a.task.localeCompare(b.task)))
  console.log(r.model.padEnd(24), r.task.padEnd(13), `n=${r.n}`, `critical ${(100 * r.critical / r.n).toFixed(1)}%`, `any ${(100 * r.flagged / r.n).toFixed(1)}%`,
    Object.entries(r.kinds).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(" "));
}
