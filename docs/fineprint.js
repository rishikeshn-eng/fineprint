// fineprint: you asked an AI to "just fix the grammar". Did it also change what the text says?
// Diffs the original against the edited text and flags the edits that can change meaning:
// numbers, units, dates, negations, modal verbs (shall -> may), quantifiers, conditions,
// comparisons, names, who-does-what, and dropped clauses. Style edits are left alone.
// One ES module, used unchanged by the browser game and the Node benchmark.

// ---------- vocabularies ----------

const NUM_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100, thousand: 1000, lakh: 1e5, lakhs: 1e5, crore: 1e7, crores: 1e7, million: 1e6, billion: 1e9,
  half: 0.5, quarter: 0.25, twice: 2, thrice: 3, double: 2, triple: 3, dozen: 12, third: 3, fourth: 4, fifth: 5,
  tenth: 10, none: 0, a: null, an: null };
// "first", "second" and "once" are left out: they usually mean order or "as soon as", not a quantity
// "a"/"an" only count as 1 when directly followed by a unit-ish noun handled via phrase rules; ignore here.
delete NUM_WORDS.a; delete NUM_WORDS.an;

const NEGATION = new Set(["not", "no", "never", "none", "nobody", "nothing", "neither", "nor", "without", "cannot",
  "nowhere", "n't", "neglect", "fail", "fails", "failed", "lack", "lacks", "absent", "except", "excluding", "unless"]);
const MODAL_STRENGTH = { must: 3, shall: 3, "will": 2, required: 3, mandatory: 3, obligated: 3, obliged: 3, need: 2,
  should: 2, ought: 2, recommended: 1, may: 1, might: 1, can: 1, could: 1, optional: 0, permitted: 1, allowed: 1,
  prohibited: -3, forbidden: -3, would: 1, entitled: 1, encouraged: 1 };
const QUANT = new Set(["all", "every", "each", "any", "some", "most", "many", "few", "several", "always", "sometimes",
  "often", "usually", "rarely", "only", "least", "most", "maximum", "minimum", "max", "min", "up", "entire", "whole",
  "partial", "partially", "fully", "completely", "exactly", "both", "either", "majority", "minority", "lots", "plenty"]);
const DIRECTION = new Set(["before", "after", "prior", "subsequent", "following", "preceding", "above", "below",
  "more", "less", "fewer", "greater", "higher", "lower", "larger", "smaller", "increase", "increased", "decrease",
  "decreased", "earlier", "later", "within", "beyond", "exceed", "exceeds", "exceeding", "under", "over", "longer",
  "shorter", "faster", "slower", "maximum", "minimum", "early", "late", "start", "end", "begin", "terminate",
  "include", "includes", "including", "exclude", "excludes", "add", "remove", "raise", "reduce", "gain", "loss"]);
const DIR_CLASS = { before: "before", prior: "before", preceding: "before", earlier: "before", early: "before",
  after: "after", subsequent: "after", following: "after", later: "after", late: "after",
  above: "up", more: "up", greater: "up", higher: "up", larger: "up", exceed: "up", exceeds: "up", exceeding: "up",
  over: "up", longer: "up", faster: "up", maximum: "max", below: "down", less: "down", fewer: "down", lower: "down",
  smaller: "down", under: "down", shorter: "down", slower: "down", minimum: "min", increase: "inc", increased: "inc",
  raise: "inc", gain: "inc", add: "inc", decrease: "dec", decreased: "dec", reduce: "dec", loss: "dec", remove: "dec",
  start: "start", begin: "start", commence: "start", end: "end", terminate: "end", finish: "end", expire: "end",
  within: "within", beyond: "beyond", include: "incl", includes: "incl", including: "incl", exclude: "excl",
  excludes: "excl", excluding: "excl" };
const CONDITION = new Set(["if", "unless", "provided", "providing", "when", "whenever", "until", "only", "except",
  "subject", "conditional", "whether", "otherwise", "upon", "once"]);
const ACTORS = new Set(["i", "we", "you", "he", "she", "they", "it", "me", "us", "him", "her", "them", "my", "our",
  "your", "his", "their", "its", "tenant", "landlord", "buyer", "seller", "company", "employee", "employer",
  "customer", "client", "supplier", "vendor", "licensee", "licensor", "patient", "doctor", "party", "parties",
  "contractor", "lender", "borrower", "user", "provider"]);
const UNITS = new Set(["percentage", "mg", "g", "kg", "mcg", "µg", "ml", "l", "litre", "litres", "liter", "liters", "km", "m", "cm",
  "mm", "mi", "miles", "%", "percent", "per", "cent", "hours", "hour", "hrs", "hr", "minutes", "minute", "mins",
  "seconds", "days", "day", "weeks", "week", "months", "month", "years", "year", "$", "₹", "rs", "inr", "usd", "€",
  "£", "eur", "gbp", "tablet", "tablets", "capsule", "capsules", "dose", "doses", "units", "iu", "times", "daily",
  "weekly", "monthly", "annually", "yearly", "hourly"]);
const MONTHS = new Set(["january", "february", "march", "april", "may_", "june", "july", "august", "september",
  "october", "november", "december", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov",
  "dec", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "today", "tomorrow",
  "yesterday", "tonight", "morning", "evening", "night", "noon", "midnight", "am", "pm"]);
// homophones that grammar fixes swap all the time: treat as the same token in the diff
const HOMOPHONE = { their: "there~", there: "there~", your: "your~", whose: "whose~" };
// function words: a change confined to these is style, not substance
const STOP = new Set(["the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "but", "so", "that", "this",
  "these", "those", "is", "are", "was", "were", "be", "been", "being", "am", "has", "have", "had", "do", "does",
  "did", "with", "as", "at", "by", "from", "which", "who", "whom", "whose", "there", "here", "then", "than",
  "also", "very", "really", "just", "quite", "rather", "such", "into", "onto", "its", "it's", "s", "'s", "etc",
  "however", "therefore", "thus", "hence", "moreover", "furthermore", "additionally", "please", "kindly"]);

const SEVERITY = { number: 3, unit: 3, negation: 3, modal: 3, date: 3, quantifier: 2, condition: 2, direction: 2,
  actor: 1, name: 2, dropped: 2, added: 1, name_spelling: 1 };
export const LABELS = {
  number: "Number changed", unit: "Unit or currency changed", negation: "Negation added or removed",
  modal: "Obligation changed (must / may / should)", date: "Date or time changed", quantifier: "Scope changed (all / some / only)",
  condition: "Condition changed (if / unless / until)", direction: "Direction changed (before / after, more / less)",
  actor: "Who does it changed", name: "Name changed", dropped: "Content dropped", added: "Content added",
  name_spelling: "Name spelling changed",
};

// units that mean the same thing ("per day" vs "daily"); "per" / "times" are glue words
const UMAP = { daily: "day", hourly: "hour", weekly: "week", monthly: "month", yearly: "year", annually: "year", percent: "%", hrs: "hour", hr: "hour", hours: "hour", days: "day", weeks: "week", months: "month", years: "year", mins: "minute", minutes: "minute", tablets: "tablet", capsules: "capsule", doses: "dose", rs: "₹", inr: "₹", usd: "$", percentage: "%", liters: "l", litres: "l", liter: "l", litre: "l", per: "", times: "" };

// ---------- tokenising ----------

const TOKEN_RE = /\s+|[₹$€£]|\d+(?:[.,]\d+)*(?:st|nd|rd|th)?%?|[A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’][A-Za-z]+)*|n['’]t|[^\sA-Za-z\d]/gu;

const NO_APOS = { dont: "do", cant: "can", wont: "will", didnt: "did", doesnt: "does", isnt: "is", arent: "are",
  wasnt: "was", werent: "were", shouldnt: "should", couldnt: "could", wouldnt: "would", hasnt: "has", havent: "have",
  hadnt: "had", mustnt: "must", neednt: "need", aint: "is" };

function tokenize(text) {
  text = text.replace(/[²³¹⁰⁴⁵⁶⁷⁸⁹]/g, c => "²³¹⁰⁴⁵⁶⁷⁸⁹".indexOf(c) >= 0 ? String("2310456789"["²³¹⁰⁴⁵⁶⁷⁸⁹".indexOf(c)]) : c);
  const toks = [];
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const raw = m[0];
    if (/^\s+$/.test(raw)) continue;
    // markdown list numbers ("1." / "2)" at the start of a line) are layout, not quantities
    if (/^\d{1,2}$/.test(raw) && /^[.)]/.test(text.slice(m.index + raw.length, m.index + raw.length + 1)) &&
        /(^|\n)[ \t>*-]*$/.test(text.slice(Math.max(0, m.index - 12), m.index))) {
      toks.push({ raw, start: m.index, end: m.index + raw.length, key: "§list" });
      continue;
    }
    const na = raw.toLowerCase();
    if (na in NO_APOS) {
      toks.push({ raw: raw.slice(0, -2), start: m.index, end: m.index + raw.length - 2, key: NO_APOS[na] });
      toks.push({ raw: "nt", start: m.index + raw.length - 2, end: m.index + raw.length, key: "not" });
      continue;
    }
    // split contractions: "don't" -> "do" + "n't", "can't" -> "can" + "n't", "won't" -> "will" + "n't"
    const c = raw.match(/^([A-Za-z]+?)(n['’]t)$/i);
    if (c) {
      let head = c[1];
      const lower = raw.toLowerCase().replace("’", "'");
      if (lower === "can't") head = "can"; else if (lower === "won't") head = "will"; else if (lower === "shan't") head = "shall";
      toks.push({ raw: head, start: m.index, end: m.index + c[1].length, key: head.toLowerCase() });
      toks.push({ raw: "n't", start: m.index + c[1].length, end: m.index + raw.length, key: "not" });
      continue;
    }
    let key = raw.toLowerCase().replace(/’/g, "'");
    const pc = key.match(/^(i|you|we|they|he|she|it|that|there|who|what)'(s|re|ve|ll|d|m)$/);
    if (pc) {
      const full = { s: "is", re: "are", ve: "have", ll: "will", d: "would", m: "am" }[pc[2]];
      const head = pc[1] === "there" ? "there~" : pc[1];
      toks.push({ raw: raw.slice(0, pc[1].length), start: m.index, end: m.index + pc[1].length, key: head });
      toks.push({ raw: raw.slice(pc[1].length), start: m.index + pc[1].length, end: m.index + raw.length, key: full });
      continue;
    }
    if (key === "cannot") { toks.push({ raw: "can", start: m.index, end: m.index + 3, key: "can" }); toks.push({ raw: "not", start: m.index + 3, end: m.index + 6, key: "not" }); continue; }
    if (/^\d/.test(key)) key = key.replace(/,(?=\d{2,3}\b)/g, "").replace(/(st|nd|rd|th)$/, "");
    if (key in HOMOPHONE) key = HOMOPHONE[key];
    toks.push({ raw, start: m.index, end: m.index + raw.length, key });
  }
  return toks;
}

// ---------- diff (Myers O(ND)) ----------

function diff(a, b) {
  const n = a.length, m = b.length, max = n + m;
  const v = new Int32Array(2 * max + 2), trace = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && v[max + k - 1] < v[max + k + 1])) ? v[max + k + 1] : v[max + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[max + k] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b, max, d);
    }
  }
  return [];
}

function backtrack(trace, a, b, max, dEnd) {
  const ops = [];
  let x = a.length, y = b.length;
  for (let d = dEnd; d > 0; d--) {
    const v = trace[d], k = x - y;
    const prevK = (k === -d || (k !== d && v[max + k - 1] < v[max + k + 1])) ? k + 1 : k - 1;
    const prevX = v[max + prevK], prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push(["=", x - 1, y - 1]); x--; y--; }
    if (x === prevX) ops.push(["+", -1, y - 1]); else ops.push(["-", x - 1, -1]);
    x = prevX; y = prevY;
  }
  while (x > 0 && y > 0) { ops.push(["=", x - 1, y - 1]); x--; y--; }
  return ops.reverse();
}

// ---------- classification ----------

function numValue(key) {
  if (/^\d/.test(key)) { const v = parseFloat(key.replace(/,/g, "").replace(/%$/, "")); return Number.isFinite(v) ? v : null; }
  return key in NUM_WORDS ? NUM_WORDS[key] : null;
}

function multiset(keys, pred, map = k => k) {
  const out = {};
  for (const k of keys) if (pred(k)) { const v = String(map(k)); out[v] = (out[v] || 0) + 1; }
  return out;
}
const sameBag = (x, y) => { const ks = new Set([...Object.keys(x), ...Object.keys(y)]); for (const k of ks) if ((x[k] || 0) !== (y[k] || 0)) return false; return true; };

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

// numbers written as "3" vs "three" are the same value: combine each side into a bag of values
function numberBag(toks) {
  const out = {};
  let i = 0;
  while (i < toks.length) {
    const v = numValue(toks[i].key);
    if (v === null) { i++; continue; }
    // "2 lakh", "three hundred", "1.5 million": fold multiplier words into the preceding number
    let val = v, j = i + 1;
    while (j < toks.length) { const w = toks[j].key; if (["hundred", "thousand", "lakh", "lakhs", "crore", "crores", "million", "billion"].includes(w)) { val *= NUM_WORDS[w]; j++; } else break; }
    out[String(+val.toPrecision(12))] = (out[String(+val.toPrecision(12))] || 0) + 1;
    i = j;
  }
  return out;
}

function isCap(t, prevTok) {
  return /^[A-Z][a-z]+/.test(t.raw) && prevTok && !/^[.!?:"“\n]$/.test(prevTok.raw) && !MONTHS.has(t.key) &&
    !(t.key in MODAL_STRENGTH) && !STOP.has(t.key);
}

// a word from one of the meaning vocabularies; two such words differing by a letter or two
// ("including" / "excluding", "shall" / "small") are a real swap, not a typo fix
const known = k => NEGATION.has(k) || k in MODAL_STRENGTH || QUANT.has(k) || k in DIR_CLASS || CONDITION.has(k) ||
  ACTORS.has(k) || UNITS.has(k) || MONTHS.has(k) || numValue(k) !== null;

function classify(del, ins, ctxA, ctxB) {
  const ik = ins.map(t => t.key);
  const used = new Set();
  const dk = del.map(t => {
    if (t.key.length < 4 || !/^[a-z]+$/.test(t.key)) return t.key;
    const j = ik.findIndex((k, i) => !used.has(i) && k !== t.key && k.length >= 4 && /^[a-z]+$/.test(k) && lev(t.key, k) <= 2 &&
      !(known(k) && known(t.key)));
    if (j < 0) return t.key;
    used.add(j);
    return ik[j];
  });
  del = del.map((t, i) => (dk[i] === t.key ? t : { ...t, key: dk[i], raw: ins[ik.indexOf(dk[i])]?.raw ?? t.raw }));
  const kinds = [];
  if (!sameBag(numberBag(del), numberBag(ins))) kinds.push("number");
  if (!sameBag(multiset(dk, k => UNITS.has(k)), multiset(ik, k => UNITS.has(k)))) {
    // "per day" -> "daily" is the same thing; only flag when a real unit appears/disappears
    // a unit occurrence from the original that is gone (removed or replaced) is a change; adding a unit word is not
    const counts = keys => { const c = {}; for (const k of keys) if (UNITS.has(k)) { const u = UMAP[k] ?? k; if (u) c[u] = (c[u] || 0) + 1; } return c; };
    const cd = counts(dk), ci = counts(ik);
    if (Object.entries(cd).some(([u, n]) => (ci[u] || 0) < n)) kinds.push("unit");
  }
  const negCount = ks => ks.filter((k, i) => NEGATION.has(k) && !((k === "no" || k === "not") && ks[i + 1] === "later" && ks[i + 2] === "than")).length;
  if (negCount(dk) !== negCount(ik)) kinds.push("negation");
  // "May" is the month only next to a number ("May 5", "5 May 2024"); otherwise it is the modal verb
  const isMonth = (arr, i) => arr[i].key === "may" && arr[i].raw === "May" && [arr[i - 1], arr[i + 1]].some(t => t && /^\d/.test(t.key));
  const modals = arr => arr.filter((t, i) => (t.key in MODAL_STRENGTH) && !isMonth(arr, i)).map(t => MODAL_STRENGTH[t.key]).sort().join(",");
  if (modals(del) !== modals(ins)) kinds.push("modal");
  const monthKeys = arr => arr.map((t, i) => isMonth(arr, i) ? "may_" : t.key === "may" ? "~may" : t.key);
  if (!sameBag(multiset(monthKeys(del), k => MONTHS.has(k)), multiset(monthKeys(ins), k => MONTHS.has(k)))) kinds.push("date");
  const qk = k => ({ numerous: "many", lots: "many", plenty: "many", entire: "whole", every: "each", fully: "completely" }[k] || k);
  if (!sameBag(multiset(dk.map(qk), k => QUANT.has(k)), multiset(ik.map(qk), k => QUANT.has(k)))) kinds.push("quantifier");
  if (!sameBag(multiset(dk, k => CONDITION.has(k)), multiset(ik, k => CONDITION.has(k)))) kinds.push("condition");
  // deadline phrasing: "on or before" / "no later than" / "not later than" all mean "by"
  const deadline = ks => { const o = [...ks]; for (let i = 0; i < o.length; i++) {
    if (o[i] === "before" && o[i - 1] === "or" && o[i - 2] === "on") o[i] = "by~";
    if (o[i] === "later" && (o[i - 1] === "no" || o[i - 1] === "not") && o[i + 1] === "than") { o[i] = "by~"; o[i - 1] = "~"; }
    if (o[i] === "by") o[i] = "by~"; } return o; };
  const dd = deadline(dk), di = deadline(ik);
  if (!sameBag(multiset(dd, k => k in DIR_CLASS, k => DIR_CLASS[k]), multiset(di, k => k in DIR_CLASS, k => DIR_CLASS[k]))) kinds.push("direction");
  const actorKey = k => ({ me: "i", my: "i", us: "we", our: "we", your: "you", him: "he", his: "he", her: "she", them: "they", their: "they", its: "it", parties: "party" }[k] || k);
  if (!sameBag(multiset(dk, k => ACTORS.has(k), actorKey), multiset(ik, k => ACTORS.has(k), actorKey))) kinds.push("actor");
  // names: capitalised words mid-sentence that are not in the other side
  const capsA = del.filter((t, i) => isCap(t, i ? del[i - 1] : ctxA)).map(t => t.raw);
  const capsB = ins.filter((t, i) => isCap(t, i ? ins[i - 1] : ctxB)).map(t => t.raw);
  const goneNames = capsA.filter(c => !ins.some(t => t.raw === c)), newNames = capsB.filter(c => !del.some(t => t.raw === c));
  if (goneNames.length && newNames.length) {
    const close = goneNames.every(g => newNames.some(n => lev(g.toLowerCase(), n.toLowerCase()) <= 2));
    kinds.push(close ? "name_spelling" : "name");
  } else if (goneNames.length && !kinds.length && del.length <= 3 && !ins.length) kinds.push("name");
  // big deletions/additions of content words with no counterpart
  const content = ks => ks.filter(k => /[a-z\d]/.test(k) && !STOP.has(k));
  const cd = content(dk), ci = content(ik);
  const shared = cd.filter(k => ci.includes(k)).length;
  if ((cd.length - shared >= 5 && ci.length <= 2) || (cd.length - shared >= 3 && ci.length === 0)) kinds.push("dropped");
  else if (ci.length - shared >= 6 && cd.length <= 2) kinds.push("added");
  return [...new Set(kinds)];
}

// ---------- public API ----------

/**
 * Compare original and edited text. Returns {changes, stats}.
 * Each change: {kinds, severity (0 style ... 3 critical), label, before, after,
 *               a: [start, end] in original, b: [start, end] in edited}.
 */
export function compare(original, edited) {
  const A = tokenize(original), B = tokenize(edited);
  const ops = diff(A.map(t => t.key), B.map(t => t.key));
  // collect hunks of consecutive non-equal ops; merge hunks separated by a single function word
  const hunks = [];
  let cur = null, gap = [];
  const flush = () => { if (cur) hunks.push(cur); cur = null; gap = []; };
  for (const [op, i, j] of ops) {
    if (op === "=") {
      if (cur) { gap.push([i, j]); if (gap.length > 1 || !STOP.has(A[i].key)) flush(); }
      continue;
    }
    if (!cur) cur = { del: [], ins: [] };
    else if (gap.length) { for (const [gi, gj] of gap) { cur.del.push(A[gi]); cur.ins.push(B[gj]); } gap = []; }
    if (op === "-") cur.del.push(A[i]); else cur.ins.push(B[j]);
  }
  flush();
  // sentence ids per token, so a word that only moved within its sentence is not reported
  const sentIds = T => { let s = 0; return T.map(t => { const id = s; if (/^[.!?;\n]$/.test(t.raw)) s++; return id; }); };
  const sa = sentIds(A), sb = sentIds(B);
  const posA = new Map(A.map((t, i) => [t, i])), posB = new Map(B.map((t, i) => [t, i]));
  // for a pure insertion/deletion, the counterpart sentence is the one holding the nearest aligned token
  const alignedB = new Map(), alignedA = new Map();
  for (const [op, i, j] of ops) if (op === "=") { alignedB.set(i, j); alignedA.set(j, i); }
  const near = (map, idx, dir) => { for (let k = idx; k >= 0 && k < 1e6; k += dir) if (map.has(k)) return map.get(k); return 0; };
  const SENT_KINDS = new Set(["number", "unit", "negation", "modal", "date", "quantifier", "condition", "direction", "actor"]);
  const PASSAGE = new Set(classify(A, B, null, null));
  const changes = [];
  for (const h of hunks) {
    const first = h.del[0] || h.ins[0];
    const ctxA = A[posA.get(h.del[0]) - 1], ctxB = B[posB.get(h.ins[0]) - 1];
    let kinds = classify(h.del, h.ins, ctxA, ctxB);
    if (kinds.some(k => SENT_KINDS.has(k))) {
      const idsA = new Set(h.del.map(t => sa[posA.get(t)])), idsB = new Set(h.ins.map(t => sb[posB.get(t)]));
      if (!idsA.size) { const j = h.ins.length ? posB.get(h.ins[0]) : 0; idsA.add(sa[near(alignedA, j - 1, -1)] ?? 0); }
      if (!idsB.size) { const i = posA.get(h.del[0]); idsB.add(sb[near(alignedB, i - 1, -1)] ?? 0); }
      const SA = A.filter((t, i) => idsA.has(sa[i])), SB = B.filter((t, i) => idsB.has(sb[i]));
      const whole = new Set(classify(SA, SB, null, null));
      kinds = kinds.filter(k => !SENT_KINDS.has(k) || (whole.has(k) && PASSAGE.has(k)));
    }
    const sev = kinds.length ? Math.max(...kinds.map(k => SEVERITY[k])) : 0;
    const aSpan = h.del.length ? [h.del[0].start, h.del[h.del.length - 1].end] : null;
    const bSpan = h.ins.length ? [h.ins[0].start, h.ins[h.ins.length - 1].end] : null;
    changes.push({
      kinds, severity: sev, label: kinds.length ? kinds.map(k => LABELS[k]).join(" · ") : "Wording / grammar",
      before: aSpan ? original.slice(...aSpan) : "", after: bSpan ? edited.slice(...bSpan) : "",
      a: aSpan, b: bSpan, at: first.start,
    });
  }
  const flagged = changes.filter(c => c.severity > 0);
  return {
    changes,
    stats: { edits: changes.length, flagged: flagged.length, critical: flagged.filter(c => c.severity === 3).length,
      verdict: flagged.some(c => c.severity === 3) ? "meaning changed" : flagged.length ? "check these" : "style only" },
  };
}

export { tokenize };
