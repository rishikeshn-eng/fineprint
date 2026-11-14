import { test } from "node:test";
import assert from "node:assert/strict";
import { compare } from "../fineprint/fineprint.js";

const v = (a, b) => compare(a, b).stats.verdict;
const kinds = (a, b) => [...new Set(compare(a, b).changes.filter(c => c.severity >= 2).flatMap(c => c.kinds))].sort();

test("style-only edits pass", () => {
  for (const [a, b] of [["i has went to the market and buyed three apple.", "I went to the market and bought three apples."],
    ["Do not take more than 4 tablets.", "Don't take more than four tablets."],
    ["i dont know", "I do not know."], ["Their is a error.", "There is an error."],
    ["The dose is 2 mg/m2 daily.", "The dose is 2 mg/m² daily."], ["Pay no later than June 5.", "Pay by June 5."],
    ["Steps: do this then that", "Steps:\n1. Do this.\n2. Then do that."], ["the terms are subjcet to change", "The terms are subject to change."]])
    assert.equal(v(a, b), "style only", b);
});

test("meaning changes are caught and named", () => {
  assert.deepEqual(kinds("The tenant shall pay rent.", "The tenant may pay rent."), ["modal"]);
  assert.deepEqual(kinds("Take 2 mg daily.", "Take 2 g daily."), ["unit"]);
  assert.deepEqual(kinds("Take 2 tablets.", "Take 3 tablets."), ["number"]);
  assert.ok(kinds("Do not exceed the dose.", "Exceed the dose.").includes("negation"));
  assert.deepEqual(kinds("Refund all orders.", "Refund some orders."), ["quantifier"]);
  assert.deepEqual(kinds("Meet on Monday.", "Meet on Tuesday."), ["date"]);
  assert.ok(kinds("Pay before June.", "Pay after June.").includes("direction"));
  assert.ok(kinds("Valid unless signed.", "Valid if signed.").includes("condition"));
});

test("a moved negation is not a change", () => {
  assert.equal(v("Do not take more than 4 tablets in 24 hours.", "Take no more than 4 tablets in 24 hours."), "style only");
});
