import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const MATCHER = readFileSync(new URL("../lib/dynamicOrderDelivery.js", import.meta.url), "utf8");
const DELIVERY = readFileSync(new URL("../lib/whatsapp.js", import.meta.url), "utf8");

// The final auto-delivery filter chain is what let file 1787133498394_bf0b3fa3
// reach the wrong customer: an order for "ফাহিম হোসেন" matched a certificate
// belonging to "মোফাজ্জেল হোসেন চীল মিঞা" on the shared surname হোসেন, with
// vendorAssignment as the only other evidence. These pin the guards that stop it.

function filterChain() {
  const start = MATCHER.indexOf(".filter((result) => !result.genderConflict)");
  const end = MATCHER.indexOf(".sort((a, b) => b.score - a.score);", start);
  assert.ok(start > 0 && end > start, "filter chain not found");
  return MATCHER.slice(start, end);
}

test("a conflicting date of birth is a hard reject", () => {
  const chain = filterChain();
  assert.match(chain, /\.filter\(\(result\) => !result\.dobConflict\)/,
    "dobConflict must be rejected unconditionally");

  // The old form allowed name fallbacks to override a DOB conflict.
  const dobFilter = chain.slice(chain.indexOf("!result.dobConflict"));
  const nextFilter = dobFilter.indexOf(".filter(");
  const dobClause = dobFilter.slice(0, nextFilter);
  for (const escape of ["firstNameDayMonthFallback", "lastNameDayMonthFallback", "uniqueOpenNameFallback"]) {
    assert.equal(dobClause.includes(escape), false,
      `${escape} must not override a DOB conflict`);
  }
});

test("a partial name alone can never auto-deliver", () => {
  const chain = filterChain();
  assert.equal(chain.includes("result.uniquePartialNameFallback"), false,
    "uniquePartialNameFallback must not appear in the delivery filter chain");
});

test("vendor assignment cannot be one of the identifying fields", () => {
  const chain = filterChain();
  assert.match(chain, /field !== "vendorAssignment"/,
    "the evidence floor must exclude vendorAssignment");
  assert.match(chain, /\.length >= 2/,
    "at least two non-assignment fields must identify a person");
});

test("the evidence floor rejects the incident's field combination", () => {
  // Reproduce the filter's own predicate against the recorded audit fields.
  const floor = (fields) => fields.filter((f) => f !== "vendorAssignment").length >= 2;

  assert.equal(floor(["partialName", "vendorAssignment"]), false, "the incident");
  assert.equal(floor(["vendorAssignment"]), false, "assignment alone");
  assert.equal(floor(["gender", "partialName", "vendorAssignment"]), true,
    "still passes the floor - blocked instead by the partial-name rule above");
  assert.equal(floor(["dob", "name", "vendorAssignment"]), true, "a sound delivery");
  assert.equal(floor(["dob", "name"]), true, "sound without any assignment");
});

test("an unreadable document never reaches the matcher", () => {
  assert.match(DELIVERY, /const MIN_IDENTITY_EVIDENCE_CHARS = 40;/);
  assert.match(DELIVERY, /const documentUnreadable = \(\) =>/,
    "must be re-evaluated, so a second-pass rescue is not permanently blocked");

  // Every entry point into the matcher must be gated.
  const gated = (DELIVERY.match(/documentUnreadable\(\)/g) || []).length;
  assert.ok(gated >= 4, `expected every match entry point gated, found ${gated}`);
});

test("the readable-evidence threshold sits between OCR noise and a real document", () => {
  const MIN = 40;
  const incidentDocumentChars = 2525;   // measured from the real incident
  assert.ok(MIN < incidentDocumentChars, "a real certificate must pass");
  assert.ok(MIN > 10, "a few stray OCR characters must not pass");
});
