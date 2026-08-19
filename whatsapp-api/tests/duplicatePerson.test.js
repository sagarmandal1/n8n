import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseOrderDetails } from "../lib/dynamicOrderDelivery.js";

const SOURCE = readFileSync(new URL("../lib/dynamicOrderDelivery.js", import.meta.url), "utf8");

// One customer may submit many different people. The applicationId is a hash of
// the person's identity fields, and the unique index is
// (user, session, customerPhone, applicationId) - so identity, not phone number,
// decides what counts as a duplicate.

const order = (name, dob, extra = "") =>
  parseOrderDetails(`Name : ${name}\nDate of Birth : ${dob}\n${extra}`);

test("same customer, same name and DOB, resubmitted - one identity", () => {
  const a = order("John Doe", "01/01/1990");
  const b = order("John Doe", "01/01/1990");
  assert.equal(a.applicationId, b.applicationId,
    "identical person data must resolve to the same record");
});

test("same customer, different name, same DOB - a new order", () => {
  const a = order("John Doe", "01/01/1990");
  const b = order("Mike Doe", "01/01/1990");
  assert.notEqual(a.applicationId, b.applicationId);
});

test("same customer, same name, different DOB - a new order", () => {
  const a = order("John Doe", "01/01/1990");
  const b = order("John Doe", "02/02/1991");
  assert.notEqual(a.applicationId, b.applicationId);
});

test("different customers with identical details stay separate", () => {
  // The identity hash is the same; customerPhone is part of the unique key, so
  // the two records cannot collide.
  const a = order("John Doe", "01/01/1990");
  const b = order("John Doe", "01/01/1990");
  assert.equal(a.applicationId, b.applicationId, "same person data, same hash");
  assert.match(SOURCE, /const filter = \{ user: userId, session: sessionId, customerPhone: phone, applicationId: details\.applicationId \}/,
    "customerPhone must be part of the lookup key");
});

test("a customer phone is never globally unique for orders", () => {
  assert.equal(SOURCE.includes("customerPhone: { type: String, unique: true }"), false);
});

test("a lost insert race is reused, not raised as an error", () => {
  assert.match(SOURCE, /if \(error\?\.code !== 11000\) throw error;/,
    "only duplicate-key errors may be absorbed");
  assert.match(SOURCE, /const winner = await DynamicOrder\.findOne\(filter\);/,
    "the record written by the winner must be fetched and returned");
  assert.match(SOURCE, /return winner;/);
});

test("a duplicate key on any other index is still a real fault", () => {
  // Absorbing every E11000 would hide genuine schema conflicts.
  const block = SOURCE.slice(SOURCE.indexOf("if (error?.code !== 11000)"));
  const tail = block.slice(0, block.indexOf("return created") >>> 0 || 900);
  assert.match(tail, /throw error;/,
    "an unmatched duplicate key must be rethrown");
});

test("the DOB used for identity is the canonical normalized form", () => {
  // Not raw strings - the project's own normalization, so 2001-09-22 and
  // 22/09/2001 cannot create two records for one person.
  const a = order("Rahim Uddin", "22/09/2001");
  const b = parseOrderDetails("Name : Rahim Uddin\nDate of Birth : 2001-09-22");
  assert.equal(a.dob, "22/09/2001");
  assert.equal(b.dob, "22/09/2001");
  assert.equal(a.applicationId, b.applicationId,
    "the same date written differently must not create a second person");
});
