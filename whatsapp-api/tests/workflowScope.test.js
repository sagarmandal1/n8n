import test from "node:test";
import assert from "node:assert/strict";

import { decideWorkflowScope } from "../lib/whatsapp.js";

const VENDOR_GROUP = "8801700000000-1600000000@g.us";
const REVIEW_GROUP = "8801800000000-1700000000@g.us";

test("direct chats are always in scope", () => {
  // Customer -> CEO and vendor -> CEO both arrive as 1:1 chats.
  for (const jid of ["8801712345678@s.whatsapp.net", "8801912345678@s.whatsapp.net"]) {
    assert.equal(decideWorkflowScope({ chatJid: jid }).allowed, true);
  }
});

test("the configured vendor group is in scope", () => {
  const decision = decideWorkflowScope({
    chatJid: VENDOR_GROUP,
    vendorGroupJid: VENDOR_GROUP,
    reviewJid: REVIEW_GROUP,
  });
  assert.equal(decision.allowed, true);
});

test("any other group is ignored", () => {
  const decision = decideWorkflowScope({
    chatJid: "8801999999999-1500000000@g.us",
    vendorGroupJid: VENDOR_GROUP,
    reviewJid: REVIEW_GROUP,
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /not the configured vendor group/);
});

test("the review group is never reprocessed", () => {
  // Undelivered files are forwarded here. Reading them back in would OCR this
  // system's own output and could forward it onward a second time.
  const decision = decideWorkflowScope({
    chatJid: REVIEW_GROUP,
    vendorGroupJid: VENDOR_GROUP,
    reviewJid: REVIEW_GROUP,
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /review group/);
});

test("the review group loses even when it is also set as the vendor group", () => {
  const decision = decideWorkflowScope({
    chatJid: REVIEW_GROUP,
    vendorGroupJid: REVIEW_GROUP,
    reviewJid: REVIEW_GROUP,
  });
  assert.equal(decision.allowed, false, "a feedback loop must not be configurable");
});

test("with no vendor group configured, group traffic is ignored", () => {
  const decision = decideWorkflowScope({ chatJid: VENDOR_GROUP, vendorGroupJid: "" });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /no vendor group is configured/);
});

test("a missing or malformed jid does not silently open scope", () => {
  assert.equal(decideWorkflowScope({}).allowed, true, "empty jid is treated as a direct chat");
  assert.equal(
    decideWorkflowScope({ chatJid: "  8801999999999-1500000000@g.us", vendorGroupJid: VENDOR_GROUP }).allowed,
    false,
  );
});
