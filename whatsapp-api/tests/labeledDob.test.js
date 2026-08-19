import test from "node:test";
import assert from "node:assert/strict";

import {
  extractLabeledDob,
  parseOrderDetails,
  normalizeOrderDob,
} from "../lib/dynamicOrderDelivery.js";

// A certificate carries several dates. Before labelled fields took priority the
// parser returned whichever came first in the text, which on a Bangladeshi
// birth certificate is the registration date — a confidently wrong date of
// birth rather than a missing one.
test("prefers the labelled date of birth over other dates on the page", () => {
  const certificate = [
    "Date of Registration : 15/03/2019",
    "Date of Birth : 22/09/2001",
    "Date of Issuance : 01/04/2019",
  ].join("\n");

  assert.equal(normalizeOrderDob(certificate), "15/03/2019", "generic scan still takes the first date");
  assert.equal(extractLabeledDob(certificate), "22/09/2001");
});

test("reads the labelled value in either script and either date form", () => {
  const expected = "22/09/2001";

  assert.equal(extractLabeledDob("Date of Birth : 22/09/2001"), expected);
  assert.equal(extractLabeledDob("DOB : 22.09.2001"), expected);
  assert.equal(extractLabeledDob("Date of Birth: 2001-09-22"), expected);
  assert.equal(extractLabeledDob("Date of Birth\n22/09/2001"), expected, "value on the next line");
  assert.equal(extractLabeledDob("জন্ম তারিখ: ২২/০৯/২০০১"), expected);
  assert.equal(extractLabeledDob("জন্ম তারিখ: ২২ সেপ্টেম্বর ২০০১"), expected);
  assert.equal(extractLabeledDob("Date of Birth : 19 June 1998"), "19/06/1998");
});

test("does not reach past the label for an unrelated date", () => {
  assert.equal(extractLabeledDob("Date of Birth\n\n\nName: Rahim\n22/09/2001"), "");
});

test("rejects impossible dates and incidental label matches", () => {
  assert.equal(extractLabeledDob("Date of Birth: 32/13/2001"), "");
  assert.equal(extractLabeledDob("Date of Birth: 30/02/2001"), "", "calendar-aware");
  assert.equal(extractLabeledDob("Dobell Street 12/04/2023"), "", "'dob' inside a word");
});

test("falls back to the generic scan when no label survived OCR", () => {
  assert.equal(extractLabeledDob("Name: Eva Akter\n03/11/1994"), "");
  assert.equal(parseOrderDetails("Name: Eva Akter\nFather: Karim\n03/11/1994")?.dob, "03/11/1994");
});

test("stores the labelled date of birth on the parsed order", () => {
  const order = parseOrderDetails([
    "Birth Registration Number : 20016919421000123",
    "Date of Registration : 15/03/2019",
    "Name : Mehedi Rahman",
    "Date of Birth : 22/09/2001",
    "Date of Issuance : 01/04/2019",
    "Sex : Male",
  ].join("\n"));

  assert.equal(order.dob, "22/09/2001");
  assert.equal(order.gender, "male");
  assert.equal(order.birthRegistrationNumber, "20016919421000123");
});
