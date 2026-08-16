import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSafeWebhookUrl,
  isPublicWebhookIp,
  redactWebhookUrl,
} from "../lib/webhookSecurity.js";

test("classifies public and private IP addresses", () => {
  assert.equal(isPublicWebhookIp("1.1.1.1"), true);
  assert.equal(isPublicWebhookIp("8.8.8.8"), true);
  assert.equal(isPublicWebhookIp("127.0.0.1"), false);
  assert.equal(isPublicWebhookIp("10.0.0.1"), false);
  assert.equal(isPublicWebhookIp("169.254.169.254"), false);
  assert.equal(isPublicWebhookIp("192.168.1.1"), false);
  assert.equal(isPublicWebhookIp("::1"), false);
  assert.equal(isPublicWebhookIp("0:0:0:0:0:0:0:1"), false);
  assert.equal(isPublicWebhookIp("fd00::1"), false);
});

test("rejects insecure and internal webhook URLs", async () => {
  await assert.rejects(() => assertSafeWebhookUrl("http://example.com/hook"), /HTTPS/);
  await assert.rejects(() => assertSafeWebhookUrl("https://localhost/hook"), /localhost/);
  await assert.rejects(() => assertSafeWebhookUrl("https://127.0.0.1/hook"), /public IP/);
  await assert.rejects(
    () => assertSafeWebhookUrl("https://user:password@example.com/hook"),
    /credentials/,
  );
});

test("redacts webhook query strings and credentials from logs", () => {
  assert.equal(
    redactWebhookUrl("https://user:secret@example.com/hook?token=sensitive"),
    "https://example.com/hook",
  );
});












