import test from "node:test";
import assert from "node:assert/strict";

import {
  parseOrderDetails,
  extractLabeledDob,
  isRevisionDone,
} from "../lib/dynamicOrderDelivery.js";

// The delivery path builds identity evidence from the document's OCR text ONLY;
// the caption and quoted text are kept for workflow markers. These tests assert
// the property that makes that split safe.

const CERTIFICATE = [
  "Date of Registration : 15/03/2019",
  "Name : Mehedi Rahman",
  "Date of Birth : 22/09/2001",
  "Sex : Male",
].join("\n");

// A vendor pasting a different customer's details beside the file. This is not
// hypothetical: vendors routinely copy order text between chats.
const MISLEADING_CAPTION = [
  "Name : Rahim Uddin",
  "Date of Birth : 12/04/1995",
  "done, please deliver",
].join("\n");

test("the document alone identifies the customer", () => {
  const parsed = parseOrderDetails(CERTIFICATE);
  assert.equal(parsed.name || parsed.englishName, "Mehedi Rahman");
  assert.equal(parsed.dob, "22/09/2001");
});

test("the caption parses as a COMPLETE second identity - the reason it is excluded", () => {
  const fromCaption = parseOrderDetails(MISLEADING_CAPTION);
  assert.ok(fromCaption, "a pasted caption is a full, matchable identity");
  assert.equal(fromCaption.name || fromCaption.englishName, "Rahim Uddin");
  assert.equal(fromCaption.dob, "12/04/1995");
});

test("joining caption to document produces two contradictory identities", () => {
  // What the old evidence string looked like. Both people are present, and the
  // matcher had no way to tell which one the file actually belonged to.
  const joined = `${CERTIFICATE} ${MISLEADING_CAPTION}`;
  assert.ok(joined.includes("Mehedi Rahman"));
  assert.ok(joined.includes("Rahim Uddin"));

  // Evidence restricted to the document names exactly one person.
  assert.ok(CERTIFICATE.includes("Mehedi Rahman"));
  assert.equal(CERTIFICATE.includes("Rahim Uddin"), false);
  assert.equal(extractLabeledDob(CERTIFICATE), "22/09/2001");
});

test("an unreadable document yields no identity, however much the vendor typed", () => {
  // Restricting evidence to OCR text means a file that produced no text has
  // nothing to match on. That becomes NO_MATCH and goes to review - the
  // intended failure direction.
  assert.equal(parseOrderDetails("") , null);
  assert.equal(extractLabeledDob(""), "");
});

test("workflow markers still come from the vendor's note, not the document", () => {
  assert.equal(isRevisionDone("Revision Done"), true);
  assert.equal(isRevisionDone("revision done, please deliver"), true);
  assert.equal(isRevisionDone(CERTIFICATE), false, "a certificate is not a marker");
});
