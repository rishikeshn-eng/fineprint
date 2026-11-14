import { compare, LABELS, tokenize } from "./fineprint.js";

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (a, b) => b ? `${(100 * a / b).toFixed(1)}%` : "–";
const store = {
  get(k, d) { try { const v = localStorage.getItem("fineprint:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("fineprint:" + k, JSON.stringify(v)); } catch { /* storage off */ } },
};
$("#today").textContent = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

// ======================= RED PEN =======================
const RANKS = [[0, "Intern"], [600, "Copy editor"], [1500, "Sub-editor"], [3000, "Chief sub"], [5000, "Editor-in-chief"]];
const rankOf = s => RANKS.filter(([t]) => s >= t).pop()[1];
const G = { deck: [], i: 0, score: 0, streak: 0, lives: 3, picked: new Set(), timer: null, left: 0, cur: null, stats: { right: 0, wrong: 0 }, done: false };
let ROUNDS = null;
const best = store.get("best", 0);
const ROUND_TIME = 40; // seconds per page: these are real paragraphs

function words(text) {
  // render text as tappable words, remembering character offsets
  const out = [];
  const re = /\S+|\s+/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push({ t: m[0], s: m.index, e: m.index + m[0].length, ws: /^\s+$/.test(m[0]) });
  return out;
}

function hud() {
  $("#rank").textContent = rankOf(G.score);
  $("#score").textContent = `${G.score} pts`;
  $("#streak").textContent = `streak ${G.streak}`;
  $("#lives").textContent = "✒".repeat(Math.max(0, G.lives)) + "·".repeat(Math.max(0, 3 - G.lives));
  $("#round").textContent = `page ${Math.min(G.i + 1, G.deck.length || 12)}/${G.deck.length || 12}`;
}

function start() {
  const kind = $("#deck").value;
  const ai = ROUNDS.ai || [], syn = ROUNDS.synthetic;
  const shuffle = a => a.map(x => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(x => x[1]);
  let pool = kind === "ai" && ai.length ? ai : kind === "synthetic" || !ai.length ? syn : [...shuffle(ai).slice(0, 6), ...shuffle(syn).slice(0, 6)];
  // keep roughly 35% clean pages so "✓ Clean" is a real choice
  const clean = shuffle(pool.filter(r => r.answer.type === "clean")), dirty = shuffle(pool.filter(r => r.answer.type !== "clean"));
  const extraClean = kind === "ai" ? shuffle(syn.filter(r => r.answer.type === "clean")).slice(0, 4) : [];
  G.deck = shuffle([...dirty.slice(0, 8), ...clean.slice(0, 4), ...extraClean]).slice(0, 12);
  Object.assign(G, { i: 0, score: 0, streak: 0, lives: 3, stats: { right: 0, wrong: 0 } });
  $("#end").classList.add("hidden");
  ["#clean", "#cut", "#submit"].forEach(s => $(s).classList.remove("hidden"));
  ["#start", "#deck"].forEach(s => $(s).classList.add("hidden"));
  page();
}

function page() {
  const r = G.cur = G.deck[G.i];
  G.picked = new Set(); G.done = false;
  $("#orig").textContent = r.orig;
  $("#domain").textContent = r.domain === "legal" ? "contract" : r.domain === "medical" ? "drug label" : r.domain;
  $("#src").textContent = r.src === "ai" ? `real edit · ${r.model}` : "training desk";
  G.w = words(r.edited);
  $("#edit").innerHTML = G.w.map((w, k) => w.ws ? esc(w.t) : `<span class="w" data-k="${k}">${esc(w.t)}</span>`).join("");
  $("#edit").querySelectorAll(".w").forEach(el => el.onclick = () => { if (G.done) return; const k = +el.dataset.k; G.picked.has(k) ? G.picked.delete(k) : G.picked.add(k); el.classList.toggle("pick"); });
  $("#stampbox").innerHTML = ""; $("#explain").innerHTML = "";
  $("#hint").textContent = "Tap the word(s) that change the meaning, then Mark it. Or call it Clean, or say something was Cut.";
  ["#clean", "#cut", "#submit"].forEach(s => $(s).disabled = false);
  $("#next").classList.add("hidden");
  hud();
  clearInterval(G.timer);
  G.left = ROUND_TIME * 10;
  G.timer = setInterval(() => {
    G.left--;
    $("#ink i").style.width = `${100 * G.left / (ROUND_TIME * 10)}%`;
    $("#ink").classList.toggle("low", G.left < 80);
    if (G.left <= 0) { clearInterval(G.timer); judge("timeout"); }
  }, 100);
}

function judge(choice) {
  if (G.done) return;
  G.done = true;
  clearInterval(G.timer);
  const a = G.cur.answer;
  const inSpan = w => (a.spans || []).some(([s, e]) => w.s < e && s < w.e);
  let ok = false, label = "";
  if (choice === "clean") { ok = a.type === "clean"; label = ok ? "Clean" : "Missed"; }
  else if (choice === "cut") { ok = a.type === "cut"; label = ok ? "Caught" : a.type === "clean" ? "False alarm" : "Not a cut"; }
  else if (choice === "mark") {
    const picks = [...G.picked].map(k => G.w[k]);
    ok = a.type === "word" && picks.length > 0 && picks.some(inSpan);
    label = ok ? "Caught" : a.type === "clean" ? "False alarm" : picks.length ? "Wrong word" : "Missed";
  } else label = "Time's up";
  // red pen reveal
  G.w.forEach((w, k) => { if (w.ws) return; const el = $(`#edit .w[data-k="${k}"]`); if (inSpan(w)) el.classList.add("hit"); else if (G.picked.has(k)) el.classList.add("wrong"); });
  if (ok) { G.streak++; const pts = 100 + 25 * Math.min(G.streak - 1, 6) + Math.round(G.left / 8); G.score += pts; G.stats.right++; label += ` +${pts}`; }
  else { G.streak = 0; G.lives--; G.score = Math.max(0, G.score - 40); G.stats.wrong++; }
  $("#stampbox").innerHTML = `<div class="stamp ${ok ? "ok" : a.type === "clean" ? "meh" : "bad"}">${esc(label)}</div>`;
  const why = a.type === "clean" ? "Only style changed here: spelling, commas, synonyms, word order. The meaning held." :
    `<b>${esc(a.label || "")}.</b> You wrote <span class="strike">${esc(a.before || "(nothing)")}</span>; the AI wrote <b>${esc(a.after || "(nothing, it was cut)")}</b>.`;
  $("#explain").innerHTML = `<div class="verdict-card"><div class="margin-note">${ok ? "Good eye." : a.type === "clean" ? "This one was fine." : "Look again:"}</div>${why}</div>`;
  ["#clean", "#cut", "#submit"].forEach(s => $(s).disabled = true);
  $("#next").classList.remove("hidden");
  $("#next").textContent = G.lives <= 0 || G.i + 1 >= G.deck.length ? "Final edition →" : "Next page →";
  hud();
}

function next() {
  G.i++;
  if (G.lives <= 0 || G.i >= G.deck.length) return finish();
  page();
}

function finish() {
  const b = Math.max(best, G.score, store.get("best", 0));
  store.set("best", b);
  const r = rankOf(G.score);
  $("#end").innerHTML = `<div class="byline">Final edition</div><div class="big">${G.score}</div><h3>${G.lives <= 0 ? "Pulled from the press. " : ""}Rank: ${esc(r)}</h3>
    <p>${G.stats.right} right, ${G.stats.wrong} wrong. Personal best ${b}.</p><p class="note">${G.score >= 5000 ? "Editor-in-chief: nothing gets past you." : `Next rank at ${RANKS.find(([t]) => t > G.score)?.[0] ?? "–"} points.`}</p>
    <p><button class="btn red" id="again">New edition</button> <a class="btn" href="#check">Check your own text</a></p>`;
  $("#end").classList.remove("hidden");
  ["#clean", "#cut", "#submit", "#next"].forEach(s => $(s).classList.add("hidden"));
  $("#again").onclick = () => { $("#end").classList.add("hidden"); ["#start", "#deck"].forEach(s => $(s).classList.remove("hidden")); $("#hint").textContent = "Pick a deck and press Start."; };
}

$("#start").onclick = start;
$("#clean").onclick = () => judge("clean");
$("#cut").onclick = () => judge("cut");
$("#submit").onclick = () => judge("mark");
$("#next").onclick = next;
fetch("data/rounds.json").then(r => r.json()).then(R => {
  ROUNDS = R;
  if (!R.ai || !R.ai.length) { $("#deck").querySelector('option[value="ai"]').disabled = true; }
  $("#orig").innerHTML = '<span class="note">Your original text appears here.</span>';
  $("#edit").innerHTML = `<span class="note">Each page is a real contract clause or drug-label paragraph. ${R.ai?.length ? `${R.ai.length} pages are real edits by local LLMs that a judge confirmed changed the meaning.` : ""} About a third are clean. You get ${ROUND_TIME} seconds and three pens.</span>`;
  hud();
});

// ======================= CHECKER =======================
const EXAMPLES = [
  ["The Tenant shall pay the rent on or before the 5th of each month. The Landlord may not increase the rent during the first 12 months, unless both parties agree in writing.",
   "The tenant may pay rent by the 5th of every month. The landlord cannot raise the rent in the first 12 months if both parties agree in writing."],
  ["Adults: take 1 tablet every 6 hours. Do not take more than 4 tablets in 24 hours. Not for use in children under 12 years of age.",
   "Adults should take one tablet every 6 hours. Do not exceed 6 tablets in 24 hours. Not suitable for children under 12."],
  ["i has went to the market yesterday and buyed three apple, but they was not fresh so i returns them.",
   "I went to the market yesterday and bought three apples, but they were not fresh, so I returned them."],
];
document.querySelectorAll("[data-ex]").forEach(b => b.onclick = () => { const [x, y] = EXAMPLES[+b.dataset.ex]; $("#a").value = x; $("#b").value = y; check(); });

function check() {
  const a = $("#a").value, b = $("#b").value;
  if (!a.trim() || !b.trim()) { $("#verdict").textContent = ""; $("#marked").innerHTML = '<span class="note">Paste both versions.</span>'; $("#changes").innerHTML = ""; return; }
  const { changes, stats } = compare(a, b);
  $("#verdict").innerHTML = stats.verdict === "meaning changed" ? `<span style="color:var(--red)">✗ Meaning changed (${stats.critical} critical)</span>` :
    stats.verdict === "check these" ? `<span style="color:var(--orange)">⚠ ${stats.flagged} change(s) worth checking</span>` : `<span style="color:var(--green)">✓ Style only</span>`;
  // render edited text with deletions inline at their position
  let html = "", pos = 0;
  const marks = changes.filter(c => c.b || c.before).sort((x, y) => (x.b ? x.b[0] : x.at) - (y.b ? y.b[0] : y.at));
  for (const c of marks) {
    const at = c.b ? c.b[0] : pos;
    if (at < pos) continue;
    html += esc(b.slice(pos, at));
    if (c.before && c.severity >= 2) html += `<del title="${esc(c.label)}">${esc(c.before)}</del>${c.b ? " " : ""}`;
    if (c.b) { html += `<ins class="sev${c.severity}" title="${esc(c.label)}">${esc(b.slice(c.b[0], c.b[1]))}</ins>`; pos = c.b[1]; }
  }
  $("#marked").innerHTML = html + esc(b.slice(pos));
  const flagged = changes.filter(c => c.severity >= 1);
  $("#changes").innerHTML = flagged.length ? flagged.map(c => `<div class="chg s${c.severity}"><b>${esc(c.label)}</b><br><span class="strike">${esc(c.before || "∅")}</span> → <b>${esc(c.after || "∅ (removed)")}</b></div>`).join("") +
    `<p class="note">${changes.length - flagged.length} other edit(s) were wording or grammar only.</p>` : `<p class="note">${changes.length} edit(s), all wording or grammar.</p>`;
}
$("#a").addEventListener("input", check); $("#b").addEventListener("input", check);
$("#a").value = EXAMPLES[0][0]; $("#b").value = EXAMPLES[0][1]; check();

// ======================= STUDY =======================
const NICE = { "qwen3-1.7b": "Qwen3 1.7B", "llama-3.2-3b-instruct": "Llama 3.2 3B", "gemma-3-4b-it": "Gemma 3 4B", all: "All models" };
fetch("data/results.json").then(r => r.json()).then(R => {
  const S = R.study || [];
  const g = (model, task, domain) => S.find(r => r.model === model && r.task === task && r.domain === domain);
  const allG = g("all", "grammar", "all"), allP = g("all", "professional", "all");
  const models = [...new Set(S.map(r => r.model))].filter(m => m !== "all");
  if (allG) {
    const E = R.estimate || {}, ci = x => x ? ` [${(100 * x.ci95[0]).toFixed(0)}–${(100 * x.ci95[1]).toFixed(0)}%]` : "";
    const T = R.judged_by_version?.["test (Gemma)"]?.v2_by_task || {};
    $("#figures").innerHTML = `
      <div class="fig"><b>${E.professional ? pct(E.professional.estimate, 1) : "–"}</b><span>of "make it more professional, keep the meaning exactly" rewrites changed the meaning${ci(E.professional)}, judge-corrected, Llama 3.2 3B and Gemma 3 4B</span></div>
      <div class="fig"><b>${E.grammar ? pct(E.grammar.estimate, 1) : "–"}</b><span>of "just fix the grammar" edits did${ci(E.grammar)}</span></div>
      ${T.grammar ? `<div class="fig"><b>${T.grammar[0]} in ${T.grammar[1]}</b><span>of fineprint's flags on grammar fixes were real changes on a model it never saw. On full rewrites, ${T.professional[0]} in ${T.professional[1]}. Use it as a highlighter, not a verdict.</span></div>` : ""}
      <div class="fig"><b>${pct(R.gold_test.tp, R.gold_test.tp + R.gold_test.fn)}</b><span>of planted meaning changes caught on the held-out gold set, with ${pct(R.gold_test.fp, R.gold_test.fp + R.gold_test.tn)} false alarms</span></div>`;
    $("#studyintro").textContent = `${(allG.n + allP.n).toLocaleString()} proofreads of ${R.n_passages} passages by ${models.length} local models. The bars show raw flags: proofreads where fineprint flags at least one critical change (number, unit, negation, obligation or date). Raw flags overstate real changes, a lot for full rewrites; the judge-corrected rates are at the top of the page.`;
  }
  const bar = (label, v, color) => `<div class="hbar"><span>${esc(label)}</span><div class="t"><i style="width:${Math.min(100, v)}%;background:${color}"></i></div><b>${v.toFixed(1)}%</b></div>`;
  $("#bymodel").innerHTML = [...models, "all"].map(m => {
    const a = g(m, "grammar", "all"), b = g(m, "professional", "all");
    return (a ? bar(`${NICE[m] || m} · grammar (n=${a.n})`, 100 * a.critical / a.n, "var(--red)") : "") + (b ? bar(`${NICE[m] || m} · professional`, 100 * b.critical / b.n, "var(--blue)") : "");
  }).join("");
  $("#bydomain").innerHTML = ["legal", "medical", "everyday"].map(d => {
    const a = g("all", "grammar", d), b = g("all", "professional", d);
    return (a ? bar(`${d === "legal" ? "Contracts" : d === "medical" ? "Drug labels" : "Everyday writing"} · grammar`, 100 * a.critical / a.n, "var(--red)") : "") +
      (b ? bar(`${d === "legal" ? "Contracts" : d === "medical" ? "Drug labels" : "Everyday writing"} · professional`, 100 * b.critical / b.n, "var(--blue)") : "");
  }).join("");
  if (allG) $("#bykind").innerHTML = Object.entries(allG.kinds).filter(([, v]) => v).sort((a, b) => b[1] - a[1]).map(([k, v]) => bar(LABELS[k] || k, 100 * v / allG.n, "var(--ink)")).join("");
  const J = R.judge;
  const V = R.judged_by_version || {};
  $("#judge").innerHTML = J ? `<table><tr><th>Check (Gemini judge)</th><th class="n">Result</th></tr>
      ${Object.entries(V).map(([k, x]) => `<tr><td>Flag precision, ${esc(k)}: v0.1 → <b>v0.2</b></td><td class="n">${x.v1_true}/${x.v1_flags} → <b>${x.v2_true}/${x.v2_flags}</b></td></tr>`).join("")}
      ${V["test (Gemma)"] ? `<tr><td>&nbsp;&nbsp;v0.2 on held-out grammar fixes / rewrites</td><td class="n">${V["test (Gemma)"].v2_by_task.grammar.join("/")} · ${V["test (Gemma)"].v2_by_task.professional.join("/")}</td></tr>` : ""}
      <tr><td>v0.1, all judged flags: real meaning changes</td><td class="n">${J.flag_precision[0]}/${J.flag_precision[1]} (${pct(J.flag_precision[0], J.flag_precision[1])})</td></tr>
      <tr><td>Flagged proofreads with at least one real change</td><td class="n">${J.pair_precision[0]}/${J.pair_precision[1]} (${pct(J.pair_precision[0], J.pair_precision[1])})</td></tr>
      <tr><td>Unflagged proofreads where the judge found a meaning change</td><td class="n">${J.missed_in_clean[0]}/${J.missed_in_clean[1]} (${pct(J.missed_in_clean[0], J.missed_in_clean[1])})</td></tr>
      ${Object.entries(J.per_kind_precision).sort((a, b) => b[1][1] - a[1][1]).slice(0, 8).map(([k, v]) => `<tr><td>&nbsp;&nbsp;${esc(LABELS[k] || k)}</td><td class="n">${v[0]}/${v[1]}</td></tr>`).join("")}</table>
      <p class="note">Judge: ${esc(J.judge)}, on ${J.flagged_pairs} flagged and ${J.clean_pairs} unflagged proofreads from Llama and Gemma. Per-kind rows are v0.1. What it missed: ${J.missed_examples.slice(0, 4).map(esc).join("; ") || "–"}.</p>` : '<p class="note">Judge validation pending.</p>';
  const clips = (ROUNDS_FOR_CLIPS(R) || []).slice(0, 8);
  $("#clips").innerHTML = clips.length ? clips.map(c => `<div class="clip"><div class="tag">${esc(c.domain === "legal" ? "Contract" : "Drug label")} · ${esc(NICE[c.model] || c.model)} · "${esc(c.task === "grammar" ? "fix the grammar" : "make it professional")}"</div>
      <p><b>${esc(c.label)}</b></p><p><span class="strike">${esc(c.before || "∅")}</span> → <b>${esc(c.after || "(cut)")}</b></p><p class="note">${esc(c.orig.slice(0, 220))}${c.orig.length > 220 ? "…" : ""}</p></div>`).join("") : '<p class="note">Clippings appear once the judge has confirmed real edits.</p>';
  const gt = R.gold_test, gd = R.gold_dev;
  $("#gold").innerHTML = `<table><tr><th>Set</th><th class="n">Pairs</th><th class="n">Precision</th><th class="n">Recall</th><th class="n">False-alarm rate</th><th class="n">Kind named right</th></tr>
    ${[["Development (seed 7)", gd], ["Held out (seed 11)", gt]].map(([n, x]) => x ? `<tr><td>${n}</td><td class="n">${x.n}</td><td class="n">${pct(x.tp, x.tp + x.fp)}</td><td class="n">${pct(x.tp, x.tp + x.fn)}</td><td class="n">${pct(x.fp, x.fp + x.tn)}</td><td class="n">${pct(x.kind_correct_given_caught, 1)}</td></tr>` : "").join("")}</table>
    <table style="margin-top:10px"><tr><th>Planted change (held out)</th><th class="n">Caught</th></tr>${Object.entries(gt.per_kind).map(([k, v]) => `<tr><td>${esc(LABELS[k] || k)}</td><td class="n">${v.caught}/${v.n}</td></tr>`).join("")}</table>`;
});
function ROUNDS_FOR_CLIPS(R) { return R.clips; }
