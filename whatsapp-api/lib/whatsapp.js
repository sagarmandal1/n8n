import fs from "fs-extra";
import QRCode from "qrcode";
import Pino from "pino";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import sessionModel from "../models/sessionModel.js"; // ← DB
import User from "../models/userModel.js";
import ForwardedOrder from "../models/forwardedOrderModel.js";
import Message from "../models/messageModel.js";
import AutoReply from "../models/autoReplyModel.js";
import AgentAudit from "../models/agentAuditModel.js";
import {
  captureAgentRateSignal,
  createOrdersFromCustomerMessage,
  processAgentDocumentMessage,
} from "./signcopy/workflow.js";
import { extractAudioText, extractPdfText, extractImageText, extractImageTextEasyOcr, extractPdfTextDeep } from "./signcopy/documentProcessor.js";
import DynamicOrder from "../models/dynamicOrderModel.js";
import AgentCustomerProfile from "../models/agentCustomerProfileModel.js";
import LidMap from "../models/lidMapModel.js";
import DeliveredFile from "../models/deliveredFileModel.js";
import { isVendor, vendorName, setDbVendors, dbVendorsStale } from "./vendorList.js";
import { assignOrdersToVendor, findDynamicOrderMatches, isRevisionDone, normalizePhone, upsertDynamicOrder } from "./dynamicOrderDelivery.js";
import { askChatGPT } from "./openai.js";
import {
  onMessageReceived,
  onMessageSent,
  onSessionConnected,
  onSessionDisconnected,
  onQRReady,
  onReconnecting,
  onLoggedOut,
  onMessageStatusUpdate,
  onMessageReaction,
} from "./webhookDispatcher.js";

const clients = {};

// How long to hold a matched file before delivering it. The match is
// re-verified against the database after the hold, so a correction the customer
// sends in the meantime is respected instead of being overtaken by the send.
const DELIVERY_HOLD_MS = 15000;


function normalizeOcrDigits(value = "") {
  const bangla = "০১২৩৪৫৬৭৮৯";

  return String(value || "").replace(
    /[০-৯]/gu,
    (digit) => String(bangla.indexOf(digit)),
  );
}

function normalizeOcrDate(value = "") {
  const normalized = normalizeOcrDigits(value)
    .replace(/[.-]/gu, "/")
    .trim();

  const parts = normalized.split("/");

  if (parts.length !== 3) return "";

  const day = Number(parts[0]);
  const month = Number(parts[1]);
  const year = Number(parts[2]);

  if (
    !Number.isInteger(day)
    || !Number.isInteger(month)
    || !Number.isInteger(year)
    || day < 1
    || day > 31
    || month < 1
    || month > 12
    || year < 1800
    || year > 2100
  ) {
    return "";
  }

  return [
    String(day).padStart(2, "0"),
    String(month).padStart(2, "0"),
    String(year),
  ].join("/");
}

function extractOcrDobCandidates(text = "") {
  const normalized = normalizeOcrDigits(text);
  const labeled = new Set();

  const labeledRegex =
    /(?:date\s*of\s*birth|dob|birth\s*date|জন্ম\s*তারিখ|জন্মতারিখ)\s*[:：ঃ\-]?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})/giu;

  let match;

  while ((match = labeledRegex.exec(normalized)) !== null) {
    const value = normalizeOcrDate(match[1]);
    if (value) labeled.add(value);
  }

  if (labeled.size) {
    return [...labeled];
  }

  // Some OCR engines detect the DOB value perfectly but lose its label.
  // Only trust an unlabeled date here when exactly ONE date-like value
  // exists in that engine's OCR output.
  const all = new Set();
  const dateRegex =
    /\b(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})\b/gu;

  while ((match = dateRegex.exec(normalized)) !== null) {
    const value = normalizeOcrDate(match[1]);
    if (value) all.add(value);
  }

  return all.size === 1 ? [...all] : [];
}

// WhatsApp group replies often carry the original customer/order details in
// contextInfo. Include that quoted content in matching so a seller's file can
// still be linked to the correct pending order.
// Re-key every record stored against a LID once the real phone number becomes
// known. Backfilling only Message leaves DynamicOrder and AgentAudit keyed by
// the LID, which is worse than not resolving at all: the same order then exists
// twice, once per identity, and because both copies carry identical name/DOB
// they always tie in findDynamicOrderMatches. A tie is AMBIGUOUS, so the
// document is never auto-delivered and a legitimate order is blocked forever.
export async function backfillLidIdentity(lid, phone, sessionId = null) {
  const lidNum = String(lid || "").replace(/@lid$/i, "");
  const realPhone = String(phone || "").replace(/@s\.whatsapp\.net.*/, "").replace(/:\d+$/, "");
  if (!lidNum || !realPhone || lidNum === realPhone) return;

  // Remember the pairing so it survives a re-link, when Baileys' own store is
  // empty and getPNForLID can no longer answer.
  if (sessionId) {
    await LidMap.updateOne(
      { session: sessionId, lid: lidNum },
      { $set: { phone: realPhone } },
      { upsert: true },
    ).catch((err) => console.error("[LID map] persist failed:", err.message));
  }

  const results = { messages: 0, orders: 0, merged: 0, audits: 0 };

  const msgs = await Message.updateMany({ fromNumber: lidNum }, { $set: { fromNumber: realPhone } });
  results.messages = msgs.modifiedCount || 0;

  // DynamicOrder has a unique index on {user, session, customerPhone,
  // applicationId}, so a blind update collides whenever the phone-keyed twin
  // already exists. Drop the LID copy in that case, otherwise re-key it.
  for (const stale of await DynamicOrder.find({ customerPhone: lidNum })) {
    const twin = await DynamicOrder.findOne({
      user: stale.user,
      session: stale.session,
      customerPhone: realPhone,
      applicationId: stale.applicationId,
    });
    if (twin) {
      await DynamicOrder.deleteOne({ _id: stale._id });
      results.merged += 1;
    } else {
      stale.customerPhone = realPhone;
      await stale.save();
      results.orders += 1;
    }
  }

  const audits = await AgentAudit.updateMany({ customerPhone: lidNum }, { $set: { customerPhone: realPhone } });
  results.audits = audits.modifiedCount || 0;

  if (results.messages || results.orders || results.merged || results.audits) {
    console.log(
      `[LID→Phone] ${lidNum} → ${realPhone} | messages=${results.messages} orders=${results.orders} duplicates-merged=${results.merged} audits=${results.audits}`,
    );
  }
  return results;
}

// Human-readable Bangla explanation per failure reason, used in the caption
// sent to the not-delivered group.
const UNDELIVERED_REASONS = {
  NO_MATCH: "কোনো pending order-এর সঙ্গে মিল পাওয়া যায়নি।",
  AMBIGUOUS: "একাধিক order একই রকম মিলেছে, তাই কোনটি সঠিক তা নিশ্চিত নয়।",
  SOURCE_IS_CUSTOMER: "প্রেরক নিজেই ওই order-এর customer, তাই ফেরত পাঠানো হয়নি।",
  DUPLICATE: "এই ফাইলটি আগেই এই customer-কে পাঠানো হয়েছে।",
  ERROR: "processing error হওয়ায় delivery সম্পন্ন করা যায়নি।",
};

// Wording differs per outcome: a duplicate is not a failure to identify the
// customer, it is a deliberate refusal to send the same file twice.
const UNDELIVERED_HEADLINES = {
  DUPLICATE: [
    "⚠️ This file was already delivered to this customer.",
    "If you want to send it again, please deliver it manually.",
  ],
};

// Send a document that could not be auto-delivered to the configured review
// group, with the file attached and a note explaining why it needs a human.
// Auto-delivery deliberately fails closed, but until now it failed *silently*:
// the file only reached the audit trail, so nobody knew a customer was still
// waiting. This closes that gap without ever guessing a recipient.
async function forwardUndeliveredDocument({
  sock,
  userId,
  sessionId,
  outcome,
  buffer,
  mediaMeta,
  msgType,
  senderPhone,
  extraLines = [],
}) {
  if (!buffer) return false;

  // Only a VENDOR's file can be "undelivered". A customer sending their own
  // document is supplying the order data, not delivering a result, so it will
  // naturally match nothing — forwarding that to the review group both floods
  // the group and copies the customer's private documents somewhere they do
  // not belong.
  await refreshDbVendors(userId, sessionId);
  if (!isVendor(userId, sessionId, senderPhone)) {
    return false;
  }

  // Loaded here rather than passed in: this only runs on the failure path, so
  // one extra read costs nothing and the caller need not thread the session
  // through several nested blocks.
  const session = await sessionModel.findById(sessionId).lean();
  if (!session?.undeliveredEnabled || !session?.undeliveredTarget) return false;

  let target = String(session.undeliveredTarget).trim();
  if (!target.endsWith("@g.us") && !target.endsWith("@s.whatsapp.net")) {
    target = target.length > 15 ? `${target}@g.us` : `${target}@s.whatsapp.net`;
  }

  const reason = UNDELIVERED_REASONS[outcome] || UNDELIVERED_REASONS.ERROR;
  const headline = UNDELIVERED_HEADLINES[outcome] || [
    "⚠️ এই ফাইলটি স্বয়ংক্রিয়ভাবে পাঠানো যায়নি।",
    "অনুগ্রহ করে যাচাই করে সঠিক customer-কে ম্যানুয়ালি পাঠান।",
  ];
  const caption = [
    ...headline,
    "",
    `কারণ: ${reason}`,
    `স্ট্যাটাস: ${outcome}`,
    mediaMeta?.fileName ? `ফাইল: ${mediaMeta.fileName}` : "",
    senderPhone ? `প্রেরক: ${senderPhone}` : "",
    ...extraLines,
    `সময়: ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })}`,
  ].filter(Boolean).join("\n");

  try {
    const payload = msgType === "documentMessage"
      ? {
          document: buffer,
          mimetype: mediaMeta?.mimeType || "application/pdf",
          fileName: mediaMeta?.fileName || "undelivered.pdf",
          caption,
        }
      : { image: buffer, mimetype: mediaMeta?.mimeType || "image/jpeg", caption };

    const sent = await sock.sendMessage(target, payload);

    if (sent?.key?.id && !(await Message.exists({ session: sessionId, "message.key.id": sent.key.id }))) {
      await Message.create({
        user: userId,
        session: sessionId,
        message: sent,
        direction: "sent",
        fromNumber: target.replace(/@(g\.us|s\.whatsapp\.net)$/, ""),
        msgType: msgType === "documentMessage" ? "document" : "image",
        body: caption,
        mediaUrl: null,
      });
    }

    // The caption travels with the file, so no separate notice is sent —
    // posting both put the same Bangla text in the group twice.
    console.log(`[Undelivered] ${outcome} document forwarded to ${target}`);
    return true;
  } catch (err) {
    console.error(`[Undelivered] failed to forward ${outcome} document:`, err.message);
    return false;
  }
}

// Detect a file one vendor is handing to another vendor rather than returning
// to the CEO. Those are intermediate steps in the vendors' own workflow, not
// finished work for a customer, so they must never trigger automatic delivery.
// The tells are a mention of another vendor, or a reply to a message another
// vendor wrote.
// Look for a "Revision Done" marker in what this vendor recently wrote, not just
// on the file itself. WhatsApp frequently drops the caption on a document —
// verified on a real send where caption came through as undefined — and vendors
// naturally type the note as its own message just before or after the file.
async function vendorMarkedRevisionDone(userId, sessionId, vendorPhone, windowMs = 10 * 60 * 1000) {
  const phone = normalizePhone(vendorPhone);
  if (!phone) return false;
  const recent = await Message.find({
    user: userId,
    session: sessionId,
    direction: "received",
    fromNumber: phone,
    body: { $exists: true, $ne: "" },
    createdAt: { $gte: new Date(Date.now() - windowMs) },
  }).sort({ createdAt: -1 }).limit(10).lean();
  return recent.some((entry) => isRevisionDone(entry.body));
}

// Metadata-only keys WhatsApp attaches alongside the real payload. Reading the
// FIRST key of msg.message treats these as the message type, so anything
// carrying context — a caption, a mention, a reply, disappearing-message
// settings — was classified as "messageContextInfo", stored with an empty body
// and skipped by OCR, matching and delivery entirely.
const MESSAGE_METADATA_KEYS = new Set([
  "messageContextInfo",
  "senderKeyDistributionMessage",
  "deviceSentMessage",
  "protocolMessage",
]);

// Wrappers that hold the real message one level down. documentWithCaptionMessage
// is the important one: WhatsApp uses it whenever a document is sent WITH a
// caption, which is exactly how a vendor marks a file "Revision Done".
const MESSAGE_WRAPPER_KEYS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "documentWithCaptionMessage",
  "editedMessage",
];

// The automation belongs to exactly one workflow: customer -> CEO -> vendor ->
// customer. Everything outside it is ignored outright — no OCR, no order
// creation, no matching, no duplicate check, no delivery, and no copy into the
// review group.
//
// That last one is why the check has to run before OCR rather than at the
// delivery gate. A file picked up in an unrelated group that matches nothing is
// "unmatched", and the unmatched path forwards the file onward — so a lax scope
// does not merely waste OCR, it copies a stranger's documents into the review
// group. Skipping the work is also the only way to honour "do not process".
//
// In scope:  any direct chat (customer <-> CEO, vendor <-> CEO)
//            the vendor group configured on the session
// Ignored:   every other group, including the review/unmatched group itself,
//            whose contents are this system's own output
//
// With no vendor group configured, group traffic is ignored entirely. That is
// the requested behaviour, and it is announced loudly rather than silently:
// set the vendor group in the dashboard to re-enable group delivery.
const workflowScopeCache = new Map(); // "<userId>:<sessionId>" -> { vendorGroupJid, reviewJid, loadedAt }
const WORKFLOW_SCOPE_TTL_MS = 15000;
const announcedOutOfScope = new Set();

async function isWorkflowChat(userId, sessionId, chatJid) {
  const jid = String(chatJid || "");
  if (!jid.endsWith("@g.us")) return true;

  const key = `${userId}:${sessionId}`;
  let scope = workflowScopeCache.get(key);

  if (!scope || Date.now() - scope.loadedAt > WORKFLOW_SCOPE_TTL_MS) {
    try {
      const session = await sessionModel.findOne(
        { _id: sessionId, user: String(userId) },
        "vendorGroupJid undeliveredTarget"
      ).lean();

      const reviewTarget = String(session?.undeliveredTarget || "").trim();

      scope = {
        vendorGroupJid: String(session?.vendorGroupJid || "").trim(),
        reviewJid: reviewTarget.endsWith("@g.us") ? reviewTarget : "",
        loadedAt: Date.now(),
      };
      workflowScopeCache.set(key, scope);
    } catch (err) {
      console.error(`[Scope] could not read session scope [Session: ${sessionId}]:`, err.message);
      // Fail closed for groups: an unreadable configuration must not be treated
      // as permission to process a chat that may be unrelated.
      return false;
    }
  }

  const decision = decideWorkflowScope({
    chatJid: jid,
    vendorGroupJid: scope.vendorGroupJid,
    reviewJid: scope.reviewJid,
  });

  // Log each unfamiliar group once per process so a misconfiguration is
  // visible without flooding the log on every message.
  const noticeKey = `${key}:${jid}`;
  if (!decision.allowed && !announcedOutOfScope.has(noticeKey)) {
    announcedOutOfScope.add(noticeKey);
    console.warn(`[Scope] ignoring group ${jid}: ${decision.reason}`);
  }
  return decision.allowed;
}

// The scope rule itself, with no database or session state, so it can be
// tested directly. isWorkflowChat() supplies the configuration.
export function decideWorkflowScope({ chatJid = "", vendorGroupJid = "", reviewJid = "" } = {}) {
  const jid = String(chatJid || "");

  if (!jid.endsWith("@g.us")) {
    return { allowed: true, reason: "direct chat" };
  }
  if (reviewJid && jid === reviewJid) {
    return { allowed: false, reason: "this is the review group; its own output is not reprocessed" };
  }
  if (!vendorGroupJid) {
    return { allowed: false, reason: "no vendor group is configured for this session - set one in the dashboard to enable group delivery" };
  }
  if (jid === vendorGroupJid) {
    return { allowed: true, reason: "configured vendor group" };
  }
  return { allowed: false, reason: `not the configured vendor group (${vendorGroupJid})` };
}

// Keep the dashboard-managed vendor list current. isVendor() is synchronous and
// runs on every message, so the set is cached; this tops it up on a short TTL
// rather than querying per message.
async function refreshDbVendors(userId, sessionId) {
  if (!dbVendorsStale(userId, sessionId)) return;

  try {
    const session = await sessionModel.findOne(
      { _id: sessionId, user: String(userId) },
      "vendorNumbers"
    ).lean();

    setDbVendors(
      userId,
      sessionId,
      session?.vendorNumbers || []
    );
  } catch (err) {
    console.error(
      `[Vendors] could not refresh dashboard list [Session: ${sessionId}]:`,
      err.message
    );
  }
}

// A recipient must be a real dialable number. WhatsApp LIDs are numeric and can
// share a valid MSISDN length (the one seen here, 101069573120174, is 15
// digits), so length alone is not enough — require a plausible country code and
// reject the LID prefixes WhatsApp issues.
function isDeliverableNumber(value) {
  const phone = normalizePhone(String(value || ""));
  if (!/^\d{10,15}$/.test(phone)) return false;
  // LIDs observed from WhatsApp are 15-16 digits and do not begin with a
  // country calling code; no allocated country code starts with 0 or 1 followed
  // by this shape.
  if (phone.length >= 15 && /^1\d/.test(phone)) return false;
  return true;
}

function pickMessageType(container) {
  const keys = Object.keys(container || {});
  return keys.find((key) => !MESSAGE_METADATA_KEYS.has(key)) || keys[0];
}

// Unwrap nested containers and skip metadata keys to find the real content.
function resolveActualMessage(message) {
  let actualMessage = message;
  let msgType = pickMessageType(actualMessage);
  for (let depth = 0; depth < 4 && MESSAGE_WRAPPER_KEYS.includes(msgType); depth += 1) {
    const inner = actualMessage[msgType]?.message;
    if (!inner) break;
    actualMessage = inner;
    msgType = pickMessageType(actualMessage);
  }
  return { actualMessage, msgType };
}

function findVendorToVendorTarget(message, userId, sessionId, senderPhone) {
  const sender = normalizePhone(senderPhone);
  const contexts = [
    message?.extendedTextMessage?.contextInfo,
    message?.imageMessage?.contextInfo,
    message?.videoMessage?.contextInfo,
    message?.documentMessage?.contextInfo,
  ].filter(Boolean);

  for (const context of contexts) {
    for (const jid of context.mentionedJid || []) {
      const phone = normalizePhone(String(jid).replace(/@.*$/, ""));
      if (phone && phone !== sender && isVendor(userId, sessionId, phone)) return phone;
    }
    const quotedAuthor = normalizePhone(String(context.participant || "").replace(/@.*$/, ""));
    if (quotedAuthor && quotedAuthor !== sender && isVendor(userId, sessionId, quotedAuthor)) return quotedAuthor;
  }
  return "";
}

function extractMessageText(message, depth = 0) {
  if (!message || typeof message !== "object" || depth > 4) return "";
  const parts = [];
  const add = (value) => {
    if (typeof value === "string" && value.trim()) parts.push(value.trim());
  };

  add(message.conversation);
  add(message.extendedTextMessage?.text);
  add(message.imageMessage?.caption);
  add(message.videoMessage?.caption);
  add(message.documentMessage?.caption);
  add(message.documentMessage?.title);
  add(message.documentMessage?.fileName);

  for (const wrapper of ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "editedMessage"]) {
    if (message[wrapper]?.message) add(extractMessageText(message[wrapper].message, depth + 1));
  }

  const contexts = [
    message.extendedTextMessage?.contextInfo,
    message.imageMessage?.contextInfo,
    message.videoMessage?.contextInfo,
    message.documentMessage?.contextInfo,
  ].filter(Boolean);
  for (const context of contexts) {
    add(extractMessageText(context.quotedMessage, depth + 1));
    add(context.quotedMessage?.conversation);
    add(context.quotedMessage?.extendedTextMessage?.text);
  }

  return [...new Set(parts)].join(" ");
}

function taskOverlapsImage(taskText, imageText) {
  const task = String(taskText || "");
  const image = String(imageText || "");
  const normalize = (value) => value.replace(/[০-৯]/g, (d) => "0123456789"["০১২৩৪৫৬৭৮৯".indexOf(d)]);
  const imageDigits = normalize(image).replace(/\D/g, "");
  const dates = [...task.matchAll(/\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}\b/g)].map((m) => normalize(m[0]).replace(/\D/g, ""));
  if (dates.some((date) => date.length === 8 && imageDigits.includes(date))) return true;
  const name = task.match(/Name\s*\(\s*English\s*\)\s*:\s*([^\n\r]+)/i)?.[1] || "";
  const imageLower = image.toLowerCase();
  const nameTokens = name.toLowerCase().match(/[a-z]{4,}/g) || [];
  return nameTokens.some((token) => imageLower.includes(token));
}

async function recordDeliveryAudit({ userId, sessionId, messageId = "", customerPhone = "", outcome, confidence = 0, needsReview = false, details = {}, error = "" }) {
  try {
    const values = {
      user: userId,
      session: sessionId,
      eventType: error ? "PROCESSING_ERROR" : "DELIVERY_DECISION",
      customerPhone: normalizePhone(customerPhone),
      messageId: String(messageId || "").slice(0, 200),
      outcome,
      confidence: Math.max(0, Math.min(1, Number(confidence || 0))),
      needsReview,
      details,
      error: String(error || "").slice(0, 1000),
    };
    if (values.messageId) {
      await AgentAudit.findOneAndUpdate(
        { user: userId, session: sessionId, messageId: values.messageId, eventType: values.eventType },
        { $set: values },
        { upsert: true, setDefaultsOnInsert: true },
      );
    } else {
      await AgentAudit.create(values);
    }
  } catch (auditError) {
    console.error("[Agent Audit] delivery audit failed:", auditError.message);
  }
}

function sessionPath(userId, sessionId) {
  return `./sessions/${userId}/${sessionId}`;
}
function cleanNumber(number) {
  if (!number) throw new Error("Number is required");

  // remove everything except digits
  let cleaned = number.toString().replace(/\D/g, "");

  // basic length check (WhatsApp numbers are usually 8–15 digits)
  if (cleaned.length < 8 || cleaned.length > 20) {
    throw new Error("Invalid phone number");
  }

  return cleaned;
}

function hasSession(userId, sessionId) {
  return fs.existsSync(`${sessionPath(userId, sessionId)}/creds.json`);
}

async function destroyClient(userId, sessionId, removeFiles = false) {
  delete sessionLocks[sessionId];
  const client = clients[userId]?.[sessionId];

  if (!client) return;

  try {
    client.sock.ev.removeAllListeners();
    client.sock.ws?.close();
  } catch (e) { }

  delete clients[userId][sessionId];

  if (removeFiles) {
    await fs.remove(sessionPath(userId, sessionId));
  }
}

// Close every Baileys socket before a process restart. Without this, PM2 can
// start a new socket while WhatsApp still sees the old one as active, which
// causes 408/428 conflicts and Bad MAC decryption failures.
export async function closeAllSessions() {
  const pending = [];
  for (const [userId, userClients] of Object.entries(clients)) {
    for (const sessionId of Object.keys(userClients || {})) {
      pending.push(destroyClient(userId, sessionId, false));
    }
  }
  await Promise.allSettled(pending);
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => (resolve = res));
  return { promise, resolve };
}

const sessionLocks = {};

// Global LID-to-phone number map (populated from contacts.upsert events)
// Key: LID number string, Value: real E.164 phone number string
const lidPhoneMap = {};

export async function initSession(userId, sessionId) {
  clients[userId] ??= {};

  if (clients[userId][sessionId]) {
    return clients[userId][sessionId];
  }

  // Prevent Race Condition: If already initializing, wait for that promise
  if (sessionLocks[sessionId]) {
    return await sessionLocks[sessionId];
  }

  sessionLocks[sessionId] = (async () => {
    const sessionDir = sessionPath(userId, sessionId);
    await fs.ensureDir(sessionDir);

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    const readyDef = deferred();
    const qrDef = deferred();

    let waVersion = [2, 3000, 1035194821];
    try {
      const { version } = await fetchLatestBaileysVersion();
      if (Array.isArray(version)) {
        waVersion = version;
      }
    } catch (err) {
      console.error("[Baileys] Failed to fetch latest version, using fallback:", err.message);
    }

    const sock = makeWASocket({
      auth: state,
      logger: Pino({ level: "silent" }),
      printQRInTerminal: false,
      version: waVersion,
      browser: ["WaFastApi", "Chrome", "145.0.0"],
      syncFullHistory: false,
      // Ping the socket regularly. An idle websocket makes WhatsApp's device
      // and prekey lookups stall, which surfaced as single sends blocking for
      // the full default query timeout (~60s) before falling back.
      keepAliveIntervalMs: 10_000,
      // Cap a stalled query at 20s instead of Baileys' 60s default so a slow
      // lookup cannot hold the HTTP request open for a full minute.
      defaultQueryTimeoutMs: 20_000,
    });

    const client = {
      sock,
      connected: false,
      qr: null,
      ready: readyDef.promise,
      qrReady: qrDef.promise,
      resolveReady: readyDef.resolve,
      resolveQR: qrDef.resolve,
    };

    clients[userId][sessionId] = client;

    sock.ev.on("creds.update", saveCreds);

    // Build LID-to-real-phone mapping from WhatsApp contact sync events
    // Also backfill existing DB messages that stored a LID as fromNumber
    sock.ev.on("contacts.upsert", async (contacts) => {
      for (const c of contacts) {
        if (!c.id) continue;
        try {
          const isLid = c.id.endsWith("@lid");
          const lidNum = isLid ? c.id.replace(/@lid$/i, "") : null;
          const contactName = c.name || c.notify || null;

          // Attempt LID → real phone resolution (if WhatsApp provides mapping fields)
          let realPhone = null;
          if (!isLid && c.lid) {
            realPhone = c.id.replace(/@s\.whatsapp\.net$/i, "");
            const lid = c.lid.replace(/@lid$/i, "");
            if (realPhone && lid && realPhone !== lid) {
              lidPhoneMap[lid] = realPhone;
              await Message.updateMany({ fromNumber: lid }, { $set: { fromNumber: realPhone } })
                .catch(err => console.error("[LID Backfill]", err.message));
              console.log(`[LID Resolved] ${lid} → ${realPhone}`);
            }
          } else if (isLid && c.jid) {
            realPhone = c.jid.replace(/@s\.whatsapp\.net$/i, "");
            if (realPhone && lidNum && realPhone !== lidNum) {
              lidPhoneMap[lidNum] = realPhone;
              await Message.updateMany({ fromNumber: lidNum }, { $set: { fromNumber: realPhone } })
                .catch(err => console.error("[LID Backfill]", err.message));
              console.log(`[LID Resolved] ${lidNum} → ${realPhone}`);
            }
          } else if (isLid && c.phoneNumber) {
            realPhone = c.phoneNumber.replace(/\D/g, "");
            if (realPhone && lidNum && realPhone !== lidNum) {
              lidPhoneMap[lidNum] = realPhone;
              await Message.updateMany({ fromNumber: lidNum }, { $set: { fromNumber: realPhone } })
                .catch(err => console.error("[LID Backfill]", err.message));
              console.log(`[LID Resolved] ${lidNum} → ${realPhone}`);
            }
          }

          // Backfill displayName for LID contacts where we have a contact name
          if (isLid && lidNum && contactName) {
            await Message.updateMany(
              { fromNumber: lidNum, $or: [{ displayName: null }, { displayName: { $exists: false } }] },
              { $set: { displayName: contactName } }
            ).catch(err => console.error("[LID DisplayName Backfill]", err.message));
          }

        } catch (_) {}
      }
    });

    // Helper: resolve a single contact's LID and backfill DB if needed
    async function resolveLidContact(c) {
      if (!c?.id) return;
      let realPhone = null, lidNum = null;
      if (!c.id.endsWith("@lid") && c.lid) {
        realPhone = c.id.replace(/@s\.whatsapp\.net$/i, "");
        lidNum    = c.lid.replace(/@lid$/i, "");
      } else if (c.id.endsWith("@lid") && c.jid) {
        lidNum    = c.id.replace(/@lid$/i, "");
        realPhone = c.jid.replace(/@s\.whatsapp\.net$/i, "");
      }
      if (realPhone && lidNum && realPhone !== lidNum && !lidPhoneMap[lidNum]) {
        lidPhoneMap[lidNum] = realPhone;
        const updated = await Message.updateMany(
          { fromNumber: lidNum },
          { $set: { fromNumber: realPhone } }
        ).catch(err => console.error("[LID Backfill] DB error:", err.message));
        if (updated?.modifiedCount > 0) {
          console.log(`[LID Resolved] ${lidNum} → ${realPhone} (${updated.modifiedCount} messages updated)`);
        }
      }
    }

    // contacts.update fires when existing contacts get new info (e.g. after message receipt)
    sock.ev.on("contacts.update", async (updates) => {
      for (const c of updates) {
        await resolveLidContact(c).catch(() => {});
      }
    });

    sock.ev.on("connection.update", async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        client.qr = await QRCode.toDataURL(qr);
        client.resolveQR();
        await sessionModel.findByIdAndUpdate(sessionId, { status: "QR_READY" });
        onQRReady(sessionId, qr).catch(err => console.error(`[Webhook Error] session.qr_ready [Session: ${sessionId}]:`, err.message));
      }

      if (connection === "open") {
        client.connected = true;
        client.qr = null;
        client.resolveReady();

        await sessionModel.findByIdAndUpdate(sessionId, { status: "CONNECTED" });
        onSessionConnected(sessionId, sock.user).catch(err => console.error(`[Webhook Error] session.connected [Session: ${sessionId}]:`, err.message));
      }

      if (connection === "close") {
        client.connected = false;

        const error = lastDisconnect?.error;
        const code = error?.output?.statusCode;
        
        console.error(`🔴 WhatsApp Disconnected [Session: ${sessionId}]:`, error?.message || "Unknown Error", "Code:", code);

        // Logged out manually or account banned/unauthorized
        if (code === DisconnectReason.loggedOut || code === 401 || code === 403) {
          console.log(`🚫 Session ${sessionId} logged out or unauthorized. Deleting session.`);
          await sessionModel.findByIdAndUpdate(sessionId, { status: "LOGGED_OUT" });
          onLoggedOut(sessionId).catch(err => console.error(`[Webhook Error] session.logged_out [Session: ${sessionId}]:`, err.message));
          await destroyClient(userId, sessionId, true);
        } 
        // Restart Required (515)
        else if (code === DisconnectReason.restartRequired) {
          console.log(`🔄 Restart required for session ${sessionId}. Reconnecting immediately...`);
          await destroyClient(userId, sessionId, false);
          await initSession(userId, sessionId);
        }
        // Conflict / Replaced (440) - Another session using same creds
        else if (code === 440) {
          console.log(`⚠️ Conflict detected for session ${sessionId} (Code 440). Halting auto-reconnect.`);
          await sessionModel.findByIdAndUpdate(sessionId, { status: "DISCONNECTED" });
          onSessionDisconnected(sessionId, "conflict").catch(err => console.error(`[Webhook Error] session.disconnected [Session: ${sessionId}]:`, err.message));
          await destroyClient(userId, sessionId, false);
        }
        // General Disconnect / Network Drop - Auto reconnect with 5s delay
        else {
          console.log(`⏳ Reconnecting session ${sessionId} in 5 seconds...`);
          await sessionModel.findByIdAndUpdate(sessionId, { status: "RECONNECTING" });
          onReconnecting(sessionId).catch(err => console.error(`[Webhook Error] session.reconnecting [Session: ${sessionId}]:`, err.message));
          await destroyClient(userId, sessionId, false);
          
          setTimeout(async () => {
            // The session may have been deleted while this timer was pending
            // (delete/logout removes the document but cannot cancel an already
            // scheduled reconnect). Without this check a deleted session keeps
            // respawning its socket forever.
            const stillExists = await sessionModel.exists({ _id: sessionId });
            if (!stillExists) {
              console.log(`🛑 Session ${sessionId} no longer exists. Aborting reconnect.`);
              return;
            }
            await initSession(userId, sessionId);
          }, 5000);
        }
      }
    });

    sock.ev.on("messages.upsert", async (m) => {
      const { messages, type } = m;
      if (!["notify", "append"].includes(type) || !Array.isArray(messages)) return;

      for (const msg of messages) {
        if (!msg?.message) continue;

        const isFromMe = msg?.key?.fromMe;
        // console.log(`🤖 [AutoReply Trace] Raw message arrived. fromMe: ${isFromMe}`);
        if (isFromMe) {
          // Messages sent manually from WhatsApp/linked devices must still be
          // persisted. Do not pass them through inbound auto-reply logic.
          try {
            const sentContent = msg.message || {};
            const sentType = Object.keys(sentContent)[0] || "text";
            const sentBody =
              sentContent.conversation ||
              sentContent.extendedTextMessage?.text ||
              sentContent.imageMessage?.caption ||
              sentContent.videoMessage?.caption ||
              sentContent.documentMessage?.caption ||
              "";
            const recipientJid = msg.key?.remoteJid || "";
            let resolvedRecipient = recipientJid;
            if (recipientJid.endsWith("@lid")) {
              const lidNum = recipientJid.replace(/@lid$/i, "");
              const altJid = msg.key?.remoteJidAlt || msg.key?.participantAlt || "";
              const altPhone = altJid.endsWith("@s.whatsapp.net")
                ? altJid.replace(/@s\.whatsapp\.net$/i, "")
                : "";
              if (altPhone && altPhone !== lidNum) {
                lidPhoneMap[lidNum] = altPhone;
              }
              resolvedRecipient = altPhone || lidPhoneMap[lidNum] || null;
              if (resolvedRecipient) {
                Message.updateMany(
                  { fromNumber: lidNum },
                  { $set: { fromNumber: resolvedRecipient } },
                ).catch((err) => console.error("[Sent LID Backfill]", err.message));
              }
            }
            await Message.create({
              user: userId,
              session: sessionId,
              message: msg,
              direction: "sent",
              fromNumber: resolvedRecipient,
              msgType: sentType.replace("Message", "") || "text",
              body: sentBody,
              displayName: msg.pushName || null,
            });
            onMessageSent(sessionId, msg, resolvedRecipient || recipientJid).catch((err) =>
              console.error(`[Webhook Error] message.sent [Session: ${sessionId}]:`, err.message),
            );

            // Forwarding a customer's details to a vendor is what creates the
            // customer↔vendor relationship. Recording it here means the file the
            // vendor sends back can be resolved by who it was assigned to, not
            // by content alone — decisive once many customers share a name.
            try {
              const recipientPhone = String(resolvedRecipient || "").replace(/@.*$/, "");
              await refreshDbVendors(userId, sessionId);
              if (sentBody && isVendor(userId, sessionId, recipientPhone)) {
                const assigned = await assignOrdersToVendor({
                  userId, sessionId, vendorPhone: recipientPhone, text: sentBody,
                });
                for (const order of assigned) {
                  console.log(`[Assignment] ${order.applicationId} (customer ${order.customerPhone}) -> vendor ${recipientPhone} (${vendorName(userId, sessionId, recipientPhone)})`);
                }
              }
            } catch (assignErr) {
              console.error(`[Assignment Error] [Session: ${sessionId}]:`, assignErr.message);
            }
          } catch (sentErr) {
            console.error(`[Sent Message Save Error] [Session: ${sessionId}]:`, sentErr.message);
          }
          continue;
        }

        // --- FORWARDING BOT LOGIC ---
        try {
          const currentSession = await sessionModel.findById(sessionId);
          if (currentSession && currentSession.forwardingEnabled && currentSession.forwardingTarget) {
            const user = await User.findById(currentSession.user).lean();
            const isFwActive = user?.fwSubscription && 
                               user.fwSubscription.status === "active" && 
                               new Date(user.fwSubscription.endDate) > new Date();

            if (isFwActive) {
              const senderJid = msg.key.remoteJid;
              const targetJid = currentSession.forwardingTarget;
              const isFromTarget = senderJid === targetJid;

              // Extract actual message details
              let { actualMessage, msgType } = resolveActualMessage(msg.message);

              let textToSearch = extractMessageText(actualMessage);

              const orderMatch = textToSearch.match(/\d{8,17}/);

              if (orderMatch) {
                const orderId = orderMatch[0];

                if (!isFromTarget) {
                  // Case A: From customer containing order ID -> Forward to Target
                  console.log(`[Forwarding Bot] Forwarding order ${orderId} to target ${targetJid}`);
                  const sentMsg = await sock.sendMessage(targetJid, { forward: msg });
                  if (sentMsg?.key?.id) {
                    await ForwardedOrder.create({
                      session: sessionId,
                      orderId,
                      originalSender: senderJid,
                      forwardedMessageId: sentMsg.key.id,
                      status: "PENDING"
                    });
                  }
                } else {
                  // Case B: From Target containing order ID -> Forward back to original customer
                  console.log(`[Forwarding Bot] Target replied with file/message for order ${orderId}`);

                  let fileLength = 0;
                  const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];
                  if (mediaTypes.includes(msgType) && actualMessage[msgType]) {
                    const media = actualMessage[msgType];
                    fileLength = Number(media?.fileLength || 0);
                  }

                  if (fileLength > 2 * 1024 * 1024) {
                    console.log(`[Forwarding Bot] Blocked forward from Target: File size ${fileLength} exceeds 2MB limit.`);
                    await sock.sendMessage(targetJid, { text: "⚠️ File size exceeds the 2MB limit. Forwarding cancelled." });
                    continue;
                  }

                  const mapping = await ForwardedOrder.findOne({
                    session: sessionId,
                    orderId,
                    status: "PENDING"
                  }).sort({ createdAt: -1 });

                  if (mapping) {
                    console.log(`[Forwarding Bot] Sending reply to customer ${mapping.originalSender}`);
                    await sock.sendMessage(mapping.originalSender, { forward: msg });
                    mapping.status = "RESOLVED";
                    await mapping.save();
                    continue; // Skip further chatbot/reply logic for this message
                  }
                }
              }
            }
          }
        } catch (fwErr) {
          console.error("🔥 [Forwarding Bot Error]:", fwErr);
        }

        try {
          // Determine if message came from a LID (linked device) - not a real phone number
          const chatJid = msg?.key?.remoteJid || "";
          // Decided once, before any work: an out-of-scope chat is not OCR'd,
          // not matched, not delivered and never forwarded to the review group.
          const inWorkflowScope = await isWorkflowChat(userId, sessionId, chatJid);
          const remoteJid = msg?.key?.participant || chatJid || "";
          const isLidJid = remoteJid.endsWith("@lid");

          // Extract raw phone/lid number
          let rawNum = remoteJid.replace(/@s\.whatsapp\.net|@g\.us|@lid/g, "") || "unknown";

          // Resolve LID to real phone number
          let senderPhone = rawNum;
          if (isLidJid) {
            if (lidPhoneMap[rawNum]) {
              // Use cached mapping
              senderPhone = lidPhoneMap[rawNum];
            } else {
              // Try to find real JID from auth creds or sock.user mappings
              try {
                // Check if creds have a lid → phone mapping
                const authCreds = sock?.authState?.creds;
                if (authCreds?.account?.lid) {
                  const lidJid = authCreds.account.lid;
                  const myLid  = lidJid.replace(/@lid$/i, "");
                  const myPhone = sock?.user?.id?.replace(/@s\.whatsapp\.net.*/, "");
                  if (myLid === rawNum && myPhone) {
                    senderPhone = myPhone;
                    lidPhoneMap[rawNum] = myPhone;
                  }
                }
              } catch (_) {}
            }
          }

          // pushName is the WhatsApp display name of the sender
          const pushName = msg.pushName || null;

          // ── Resolve LID → real phone using remoteJidAlt / participantAlt ──
          // These fields contain the real E.164 phone JID when addressingMode === "lid"
          if (isLidJid && !lidPhoneMap[rawNum]) {
            const altJid =
              msg?.key?.participantAlt ||   // group message sender alt
              msg?.key?.remoteJidAlt ||     // DM sender alt
              null;
            if (altJid) {
              const realPhone = altJid.replace(/@s\.whatsapp\.net.*/, "");
              if (realPhone && realPhone !== rawNum) {
                lidPhoneMap[rawNum] = realPhone;
                senderPhone = realPhone;
                // Re-key messages, orders and audits that stored the LID
                backfillLidIdentity(rawNum, realPhone, sessionId)
                  .catch(err => console.error("[LID→Phone DB]", err.message));
              }
            }
          }

          // ── Fallback 1: the pairing we stored last time it resolved ──
          if (isLidJid && senderPhone === rawNum) {
            try {
              const remembered = await LidMap.findOne({ session: sessionId, lid: rawNum }).lean();
              if (remembered?.phone && remembered.phone !== rawNum) {
                lidPhoneMap[rawNum] = remembered.phone;
                senderPhone = remembered.phone;
                console.log(`[LID→Phone from stored map] ${rawNum} → ${remembered.phone}`);
              }
            } catch (err) {
              console.error(`[LID map lookup] ${rawNum}:`, err.message);
            }
          }

          // ── Fallback 2: ask Baileys' own LID mapping store ──
          // Newer WhatsApp clients address chats by LID with no remoteJidAlt or
          // participantAlt on the key, so the branches above cannot resolve them
          // and the sender stays a bare LID. Downstream that breaks everything
          // keyed on a phone number: the agent refuses to answer, memory is
          // bucketed under a non-phone id, and order matching by customerPhone
          // can never hit. The signal repository keeps the authoritative
          // mapping, so consult it before giving up.
          if (isLidJid && senderPhone === rawNum) {
            try {
              const mapped = await sock?.signalRepository?.lidMapping?.getPNForLID(`${rawNum}@lid`);
              const realPhone = String(mapped || "").replace(/@s\.whatsapp\.net.*/, "").replace(/:\d+$/, "");
              if (realPhone && realPhone !== rawNum) {
                lidPhoneMap[rawNum] = realPhone;
                senderPhone = realPhone;
                backfillLidIdentity(rawNum, realPhone, sessionId)
                  .catch((err) => console.error("[LID→Phone DB]", err.message));
              }
            } catch (err) {
              console.error(`[LID→Phone lookup] ${rawNum}:`, err.message);
            }
          }

          // Skip if we cannot determine a usable sender number
          if (senderPhone === "unknown") {
            // Silently ignore unidentifiable senders
          } else {

          if (msg.message.reactionMessage) {
             try {
               const currentSession = await sessionModel.findById(sessionId);
               if (currentSession && currentSession.forwardingEnabled && currentSession.forwardingTarget) {
                 const targetJid = currentSession.forwardingTarget;
                 const senderJid = msg.key.remoteJid;
                 const emoji = msg.message.reactionMessage.text || "";
                 const isNegative = ["👎", "❌", "😡", "🚫", "🛑"].some(neg => emoji.includes(neg));

                 if (senderJid === targetJid && isNegative) {
                   const originalMsgId = msg.message.reactionMessage.key.id;
                   const mapping = await ForwardedOrder.findOne({
                     session: sessionId,
                     forwardedMessageId: originalMsgId,
                     status: "PENDING"
                   });

                   if (mapping) {
                     console.log(`[Forwarding Bot] Negative reaction detected. Replying "Data not found" to ${mapping.originalSender}`);
                     await sock.sendMessage(mapping.originalSender, { text: "Data not found" });
                     mapping.status = "REJECTED";
                     await mapping.save();
                   }
                 }
               }
             } catch (reactErr) {
               console.error("🔥 [Forwarding Bot Reaction Error]:", reactErr);
             }
             await onMessageReaction(sessionId, msg.message.reactionMessage, senderPhone);
          } else {
             let mediaUrl = undefined;
             let savedMediaPath = undefined;
             let downloadedMediaBuffer = undefined;
             let location = undefined;
             let contact = undefined;
             let mediaMeta = undefined;
             
             // Recursively find the true message type (bypassing ephemeral wrappers)
             let { actualMessage, msgType } = resolveActualMessage(msg.message);
             
             // Check Media
             if (['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'].includes(msgType)) {
                try {
                   const media = actualMessage[msgType];
                   const buffer = await downloadMediaMessage(
                      msg,
                      'buffer',
                      { },
                      { logger: Pino({ level: "silent" }) }
                   );
                   downloadedMediaBuffer = buffer;
                   
                   let ext = "bin";
                   if (media.mimetype) {
                      ext = media.mimetype.split('/')[1].split(';')[0];
                   }
                   if (media.fileName) {
                      const parts = media.fileName.split('.');
                      if(parts.length > 1) ext = parts.pop();
                   }
                   
                   const randName = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
                   const saveDir = path.join(process.cwd(), "public", "received_media");
                   await fs.ensureDir(saveDir);
                   savedMediaPath = path.join(saveDir, randName);
                   await fs.writeFile(savedMediaPath, buffer);
                   const mimeType = String(media.mimetype || "");
                   const fileName = String(media.fileName || randName);
                   let extraction = { text: "", method: "NONE" };
                   const lowerName = fileName.toLowerCase();
                   const isPdf = mimeType.includes("pdf") || lowerName.endsWith(".pdf");
                   // Photos and screenshots are routinely sent "as a file" to
                   // avoid WhatsApp's compression, which delivers them as a
                   // documentMessage carrying an image mimetype. Those matched
                   // no branch here and so were never OCR'd — no text meant no
                   // order for a customer, and nothing to match for a vendor.
                   const isImageLike = mimeType.startsWith("image/")
                     || /\.(jpe?g|png|webp|heic|heif|bmp|tiff?|gif)$/u.test(lowerName);

                   // The media is still stored so conversation history stays
                   // complete, but nothing is read out of it outside the
                   // customer -> CEO -> vendor workflow.
                   if (!inWorkflowScope) {
                     extraction = { text: "", method: "SKIPPED_OUT_OF_SCOPE" };
                   } else if (msgType === "documentMessage" && isPdf) {
                     extraction = await extractPdfText(savedMediaPath);
                   } else if (msgType === "imageMessage" || msgType === "stickerMessage" || (msgType === "documentMessage" && isImageLike)) {
                     extraction = await extractImageText(savedMediaPath);
                   } else if (msgType === "audioMessage") {
                     extraction = await extractAudioText(savedMediaPath);
                   }
                   mediaMeta = {
                     mimeType,
                     fileName,
                     ocrText: extraction.text || "",
                     ocrMethod: extraction.method || "NONE",
                   };
                   if (msgType === "audioMessage") {
                     try {
                       await AgentAudit.findOneAndUpdate(
                         { user: userId, session: sessionId, messageId: msg?.key?.id || "", eventType: "VOICE_TRANSCRIPTION" },
                         { $set: {
                           user: userId,
                           session: sessionId,
                           eventType: "VOICE_TRANSCRIPTION",
                           customerPhone: normalizePhone(senderPhone),
                           messageId: msg?.key?.id || "",
                           outcome: extraction.text ? "TRANSCRIBED" : "NO_SPEECH",
                           confidence: Number(extraction.languageProbability || 0),
                           needsReview: !extraction.text,
                           details: { language: extraction.language || "", fileName, method: extraction.method || "NONE" },
                           error: extraction.error || "",
                         } },
                         { upsert: true, setDefaultsOnInsert: true },
                       );
                     } catch (auditError) {
                       console.error("[Agent Audit] voice audit failed:", auditError.message);
                     }
                   }
                   
                   const hostUrl = process.env.BASE_URL || "http://localhost:3000";
                   mediaUrl = `${hostUrl}/received_media/${randName}`;
                } catch(err) {
                   console.error("Failed to download media:", err);
                   mediaUrl = `ERROR: ${err.message}`;
                }
             } else if (msgType === 'locationMessage') {
                location = {
                   lat: actualMessage.locationMessage.degreesLatitude,
                   lng: actualMessage.locationMessage.degreesLongitude,
                   name: actualMessage.locationMessage.name || "",
                   address: actualMessage.locationMessage.address || ""
                };
             } else if (msgType === 'contactMessage') {
                contact = {
                   displayName: actualMessage.contactMessage.displayName || "",
                   vcard: actualMessage.contactMessage.vcard || ""
                };
             }

             let dynamicDeliveryHandled = false;
             // Dynamic delivery: a media file is delivered only after a safe
             // match to a pending order from a different WhatsApp contact.
             try {
               // Identify the customer from the CONTENT of the file, never its
               // name. Vendors name files arbitrarily, and auto-generated names
               // like 1786808990797_b8f5fc41.jpeg are long digit runs — matching
               // does a substring check on digits, so a shorter application ID
               // sitting anywhere inside such a timestamp would match a customer
               // who has nothing to do with the file.
               // WHO the file belongs to is decided by the document alone.
               //
               // The caption and quoted text used to be joined in here, which
               // meant a vendor typing a customer name beside an unrelated file
               // could steer the match. Identity has to come from the thing being
               // delivered: the certificate is what the customer receives, and it
               // is the only evidence a vendor cannot get wrong by typing in the
               // wrong chat.
               //
               // Losing the caption costs some matches, and those become NO_MATCH
               // and go to the review group. That is the direction to fail in: a
               // file in the review queue costs two minutes, a file sent to the
               // wrong person exposes a stranger's national ID and cannot be
               // recalled.
               let searchable = String(mediaMeta?.ocrText || "");

               // FAIL CLOSED ON UNUSABLE OCR.
               //
               // EasyOCR has timed out at 75s in production, and a rasterised
               // page can come back as noise. Either way the evidence is a few
               // stray characters, which is not "no match" - it is "we could not
               // read the document", and the two must not be treated alike. With
               // weak evidence the name fallbacks are exactly what fire, so this
               // is the state that produces wrong-customer deliveries.
               //
               // 40 characters is well under any real certificate (the incident
               // document produced 2,525) and well above OCR noise.
               const MIN_IDENTITY_EVIDENCE_CHARS = 40;
               // Evaluated on each use rather than captured once: the EasyOCR /
               // deep-PDF pass reassigns `searchable`, and a document it rescues
               // must stop being unreadable.
               const documentUnreadable = () =>
                 searchable.replace(/\s+/gu, "").length < MIN_IDENTITY_EVIDENCE_CHARS;

               // What the vendor WROTE stays available, but only for workflow
               // markers - never for identity. "Revision Done" is an instruction
               // about the file, not a claim about who owns it.
               const vendorNote = extractMessageText(actualMessage);
               // The marker is read from what the vendor wrote with the file —
               // caption or quoted text — not from the document's own content.
               const revisionDone = isRevisionDone(vendorNote)
                 || await vendorMarkedRevisionDone(userId, sessionId, senderPhone);
               const mediaMatch = Boolean(downloadedMediaBuffer && ["imageMessage", "documentMessage"].includes(msgType));
               // Never relax the two-field rule on the strength of a filename:
               // any file called 00000001.pdf would otherwise qualify.
               const filenameExact = false;
               // Only a vendor's file is a finished result to be delivered. A
               // customer's upload is order data, and running it through
               // delivery is actively dangerous: the sole guard below is that
               // the sender is not the matched order's own customer, so a
               // document from customer A that matched customer B's order
               // would be delivered straight to B. vendors.txt decides.
               await refreshDbVendors(userId, sessionId);
               const senderIsVendor = isVendor(userId, sessionId, senderPhone);
               // A vendor handing a file to another vendor is an intermediate
               // step in their own workflow, not finished work for a customer.
               // Automatic delivery is reserved for a completed file coming back
               // to the CEO; these stay manual until the customer is verified.
               const vendorToVendorTarget = senderIsVendor
                 ? findVendorToVendorTarget(actualMessage, userId, sessionId, senderPhone)
                 : "";
               if (vendorToVendorTarget) {
                 console.log(`[Vendor-to-Vendor] file from ${senderPhone} (${vendorName(userId, sessionId, senderPhone)}) addressed to vendor ${vendorToVendorTarget} (${vendorName(userId, sessionId, vendorToVendorTarget)}) - not delivered, manual handling`);
                 await recordDeliveryAudit({
                   userId,
                   sessionId,
                   messageId: msg?.key?.id || "",
                   customerPhone: "",
                   outcome: "VENDOR_TO_VENDOR",
                   confidence: 0,
                   needsReview: true,
                   details: {
                     matchedFile: mediaMeta?.fileName || "",
                     fromVendor: normalizePhone(senderPhone),
                     toVendor: vendorToVendorTarget,
                   },
                 });
               } else if (
                 mediaMatch
                 && senderIsVendor
                 && inWorkflowScope
                 && (mediaMeta?.ocrText || mediaMeta?.fileName || chatJid.endsWith("@g.us"))
               ) {
                 let ocrIdentityConflict = null;
                 let matches = documentUnreadable()
                   ? []
                   : await findDynamicOrderMatches({ userId, sessionId, evidenceText: searchable, filenameExact, vendorPhone: senderPhone, revisionDone });
                 if (documentUnreadable()) {
                   console.warn(`[OCR] ${mediaMeta?.fileName || "file"}: only ${searchable.trim().length} chars of text - too little to identify anyone, routing to review`);
                 }
                 let match = matches[0];
                 // Backfill recent order messages so an order received during a
                 // previous webhook outage can still be delivered safely.
                 if (!match) {
                   const historical = await Message.find({
                     user: userId,
                     session: sessionId,
                     direction: "received",
                     body: { $exists: true, $ne: "" },
                   }).sort({ createdAt: -1 }).limit(300).lean();

                   // Sellers send finished documents containing the customer's
                   // name and DOB, so backfilling every sender indiscriminately
                   // creates a phantom order keyed to the seller's own number.
                   // The seller's next file then matches that phantom, the
                   // sender equals the "customer", and the delivery is refused
                   // as SOURCE_IS_CUSTOMER — the real customer never gets it.
                   // Anyone who has already delivered an order, or is profiled
                   // as a seller, is excluded from order creation.
                   for (const historicalMessage of historical) {
                     // vendors.txt is the single source of truth for who is a
                     // vendor. Inferring it from delivery history as well would
                     // let a number count as a vendor for order creation while
                     // still failing the vendors.txt check used elsewhere.
                     if (isVendor(userId, sessionId, historicalMessage.fromNumber)) continue;
                     await upsertDynamicOrder({
                       userId,
                       sessionId,
                       customerPhone: historicalMessage.fromNumber,
                       text: historicalMessage.body,
                       messageId: historicalMessage.message?.key?.id || "",
                     });
                   }
                   matches = documentUnreadable()
                     ? []
                     : await findDynamicOrderMatches({ userId, sessionId, evidenceText: searchable, filenameExact, vendorPhone: senderPhone, revisionDone });
                   match = matches[0];
                 }

                 // Existing OCR did not produce a safe match. Run the heavier
                 // engines only now.
                 //
                 // A PDF gets the same treatment an image does: its pages are
                 // rendered and put through the multi-variant local engine and
                 // EasyOCR, then cross-checked for a date-of-birth conflict.
                 // Previously this whole stage was image-only, so a scanned PDF
                 // had neither the second chance at a match nor the conflict
                 // guard that refuses delivery when two engines disagree.
                 const secondPassIsPdf = msgType === "documentMessage" && (
                   String(mediaMeta?.mimeType || "").includes("pdf")
                   || /\.pdf$/iu.test(String(mediaMeta?.fileName || ""))
                 );
                 const secondPassIsImage = msgType === "imageMessage"
                   || String(mediaMeta?.mimeType || "").startsWith("image/")
                   || /\.(jpe?g|png|webp|heic|heif|bmp|tiff?|gif)$/iu.test(
                     String(mediaMeta?.fileName || "")
                   );

                 if (
                   !match
                   && savedMediaPath
                   && (secondPassIsImage || secondPassIsPdf)
                 ) {
                   console.log(
                     `[OCR Fallback] no safe primary OCR match; running ${secondPassIsPdf ? "deep PDF" : "EasyOCR"} pass for ${mediaMeta?.fileName || "file"}`
                   );

                   const easyExtraction = secondPassIsPdf
                     ? await extractPdfTextDeep(savedMediaPath)
                     : await extractImageTextEasyOcr(savedMediaPath);
                   const easyText = String(easyExtraction?.text || "").trim();

                   if (easyText) {
                     const primaryDobs = extractOcrDobCandidates(
                       mediaMeta?.ocrText || ""
                     );

                     const easyDobs = extractOcrDobCandidates(easyText);

                     const dobAgreement =
                       !primaryDobs.length
                       || !easyDobs.length
                       || primaryDobs.some((dob) => easyDobs.includes(dob));

                     if (!dobAgreement) {
                       ocrIdentityConflict = {
                         primaryDobs,
                         easyDobs,
                       };

                       matches = [];
                       match = null;

                       console.warn(
                         `[EasyOCR Fallback] DOB conflict - primary=${primaryDobs.join(",")} easyocr=${easyDobs.join(",")} - refusing auto-delivery`
                       );
                     } else {
                       searchable = [
                         searchable,
                         easyText,
                       ]
                         .filter(Boolean)
                         .join("\n");

                       mediaMeta.ocrText = [
                         mediaMeta?.ocrText || "",
                         easyText,
                       ]
                         .filter(Boolean)
                         .join("\n");

                       mediaMeta.ocrMethod = [
                         mediaMeta?.ocrMethod || "OCR",
                         "EASYOCR",
                       ]
                         .filter(Boolean)
                         .join("+");

                       matches = await findDynamicOrderMatches({
                         userId,
                         sessionId,
                         evidenceText: searchable,
                         filenameExact,
                         vendorPhone: senderPhone,
                         revisionDone,
                       });

                       match = matches[0];

                       if (match) {
                         console.log(
                           `[EasyOCR Fallback] safe match found: ${match.order.applicationId}`
                         );
                       } else {
                         console.log(
                           "[EasyOCR Fallback] EasyOCR completed but no safe match found"
                         );
                       }
                     }
                   } else {
                     console.warn(
                       `[EasyOCR Fallback] unavailable/no text: ${easyExtraction?.error || "unknown error"}`
                     );
                   }
                 }

                 // A group delivery usually follows a task message that we
                 // sent to that same group. The certificate photo may contain
                 // only a name/DOB, while the sent task contains the
                 // Application ID and full customer details. Match each task
                 // separately so unrelated group jobs cannot be combined.
                 if (!match && !ocrIdentityConflict) {
                   const taskFilter = {
                     user: userId,
                     session: sessionId,
                     direction: "sent",
                     body: { $regex: /Application ID/i },
                   };
                   // Prefer the same group, but also support a seller replying
                   // in a direct chat after receiving the task in a group.
                   if (chatJid.endsWith("@g.us")) taskFilter.fromNumber = chatJid;
                   const sentTasks = await Message.find(taskFilter)
                     .sort({ createdAt: -1 }).limit(100).lean();
                   const candidates = [];
                   for (const task of sentTasks) {
                     const taskText = String(task.body || "").trim();
                     if (!taskText) continue;
                     // The task text is the office's own sent message from the
                     // database, not something the vendor typed - but it still
                     // only counts when it overlaps the document itself.
                     if (!taskOverlapsImage(taskText, mediaMeta?.ocrText || "")) continue;
                     const taskMatches = await findDynamicOrderMatches({
                       userId,
                       sessionId,
                       evidenceText: `${taskText} ${searchable}`,
                     });
                     if (taskMatches[0]) candidates.push(...taskMatches);
                   }
                   candidates.sort((a, b) => b.score - a.score);
                   // The same order can have multiple task messages/retries.
                   // Deduplicate by order id before deciding ambiguity.
                   const uniqueCandidates = new Map();
                   for (const candidate of candidates) {
                     const key = String(candidate.order?._id || candidate.order?.applicationId || "");
                     const previous = uniqueCandidates.get(key);
                     if (!previous || candidate.score > previous.score) uniqueCandidates.set(key, candidate);
                   }
                   matches = [...uniqueCandidates.values()].sort((a, b) => b.score - a.score);
                   match = matches[0];
                 }
                 // Nothing matched yet: hold briefly and look again before
                 // giving up. A customer's details frequently arrive moments
                 // after the vendor's file, and declaring no-match immediately
                 // pushes deliverable work into the review group. Done here,
                 // ahead of the decision chain, so a late match is handled by
                 // the normal delivery path rather than a second copy of it.
                 if (!match && !ocrIdentityConflict) {
                   await new Promise((resolve) => setTimeout(resolve, DELIVERY_HOLD_MS));
                   const retry = documentUnreadable()
                     ? []
                     : await findDynamicOrderMatches({ userId, sessionId, evidenceText: searchable, filenameExact, vendorPhone: senderPhone, revisionDone });
                   if (retry.length) {
                     console.log(`[Dynamic Delivery] matched on retry after ${DELIVERY_HOLD_MS}ms - customer data arrived late`);
                     matches = retry;
                     match = retry[0];
                   }
                 }

                 const sender = normalizePhone(senderPhone);
                 // A tie only endangers anyone when the tied orders belong to
                 // DIFFERENT customers — that is when we cannot tell who should
                 // receive the file. OCR variation routinely produces several
                 // near-identical orders for the same person (applicationId is
                 // a hash of the parsed fields), and treating those as ambiguous
                 // blocked delivery even though every candidate named the same
                 // recipient.
                 let previousDelivery = null;
                 const tiedMatches = match ? matches.filter((candidate) => candidate.score === match.score) : [];
                 const tiedCustomers = new Set(tiedMatches.map((candidate) => normalizePhone(candidate.order.customerPhone)));
                 const ambiguous = Boolean(match && tiedMatches.length > 1 && tiedCustomers.size > 1);
                 if (ambiguous) {
                   console.log(`[Dynamic Delivery] Manual review required: ${matches.length} orders have the same match score`);
                   await recordDeliveryAudit({
                     userId,
                     sessionId,
                     messageId: msg?.key?.id || "",
                     customerPhone: match?.order?.customerPhone || "",
                     outcome: "AMBIGUOUS",
                     confidence: Math.min(Number(match?.confidence || 0), 0.69),
                     needsReview: true,
                     details: {
                       matchedFile: mediaMeta?.fileName || "",
                       candidateOrderIds: matches.filter((candidate) => candidate.score === match.score).slice(0, 5).map((candidate) => String(candidate.order._id)),
                     },
                   });
                   await forwardUndeliveredDocument({
                     sock, userId, sessionId,
                     outcome: "AMBIGUOUS",
                     buffer: downloadedMediaBuffer,
                     mediaMeta, msgType, senderPhone: sender,
                     extraLines: [`মিল পাওয়া order সংখ্যা: ${matches.filter((c) => c.score === match.score).length}`],
                   });
                 } else if (match && sender && sender !== normalizePhone(match.order.customerPhone)) {
                 // Hold briefly before delivering, then confirm the match still
                 // stands. A customer often sends a correction moments after the
                 // vendor returns the file, and this window lets that land — the
                 // order is re-read from the database rather than trusting the
                 // decision made 15 seconds ago.
                 await new Promise((resolve) => setTimeout(resolve, DELIVERY_HOLD_MS));

                 // Re-read the marker after the hold as well: a vendor often
                 // sends the file first and types "Revision Done" a moment later.
                 const revisionDoneNow = revisionDone
                   || await vendorMarkedRevisionDone(userId, sessionId, senderPhone);
                 const confirmed = await findDynamicOrderMatches({ userId, sessionId, evidenceText: searchable, filenameExact, vendorPhone: senderPhone, revisionDone: revisionDoneNow });
                 const confirmedMatch = confirmed.find((candidate) => String(candidate.order._id) === String(match.order._id));
                 if (!confirmedMatch) {
                   console.log(`[Dynamic Delivery] match no longer valid after ${DELIVERY_HOLD_MS}ms hold - not delivering`);
                   await recordDeliveryAudit({
                     userId, sessionId,
                     messageId: msg?.key?.id || "",
                     customerPhone: match.order.customerPhone,
                     outcome: "NO_MATCH",
                     confidence: 0,
                     needsReview: true,
                     details: { matchedFile: mediaMeta?.fileName || "", reason: "match invalidated during delivery hold" },
                   });
                   await forwardUndeliveredDocument({
                     sock, userId, sessionId,
                     outcome: "NO_MATCH",
                     buffer: downloadedMediaBuffer,
                     mediaMeta, msgType, senderPhone: sender,
                   });
                   dynamicDeliveryHandled = true;
                 } else if (!revisionDoneNow && (previousDelivery = await DeliveredFile.findOne({
                   session: sessionId,
                   customerPhone: normalizePhone(confirmedMatch.order.customerPhone),
                   fileHash: crypto.createHash("sha256").update(downloadedMediaBuffer).digest("hex"),
                 }).lean())) {
                   // Byte-identical to something this customer already received,
                   // and not marked as a revision. A marked revision always goes
                   // through: the vendor is asserting the content changed, and
                   // withholding a correction is worse than sending twice.
                   const customerNumber = normalizePhone(confirmedMatch.order.customerPhone);
                   console.log(`[Duplicate] ${mediaMeta?.fileName || "file"} already delivered to ${customerNumber} - not sending again`);
                   await recordDeliveryAudit({
                     userId, sessionId,
                     messageId: msg?.key?.id || "",
                     customerPhone: customerNumber,
                     outcome: "DUPLICATE",
                     confidence: confirmedMatch.confidence,
                     needsReview: true,
                     details: {
                       matchedFile: mediaMeta?.fileName || "",
                       applicationId: confirmedMatch.order.applicationId,
                       reason: "identical file already delivered to this customer",
                     },
                   });
                   await forwardUndeliveredDocument({
                     sock, userId, sessionId,
                     outcome: "DUPLICATE",
                     buffer: downloadedMediaBuffer,
                     mediaMeta, msgType, senderPhone: sender,
                     extraLines: [
                       `Customer Number: ${customerNumber}`,
                       `Delivered on: ${new Date(previousDelivery.createdAt).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })}`,
                     ],
                   });
                   dynamicDeliveryHandled = true;
                 } else if (confirmedMatch.order.status === "DELIVERED" && !revisionDoneNow) {
                   // A file matching an order that is already complete is a
                   // revision in progress. It only goes out once the vendor
                   // marks it "Revision Done"; until then the order is parked in
                   // REVISION and the file waits for manual handling.
                   console.log(`[Revision] ${confirmedMatch.order.applicationId}: resend without a "Revision Done" marker - held`);
                   await DynamicOrder.updateOne(
                     { _id: confirmedMatch.order._id },
                     { $set: { status: "REVISION", lastRevisionAt: new Date() }, $inc: { revisionCount: 1 } },
                   );
                   await recordDeliveryAudit({
                     userId, sessionId,
                     messageId: msg?.key?.id || "",
                     customerPhone: confirmedMatch.order.customerPhone,
                     outcome: "REVISION_PENDING",
                     confidence: confirmedMatch.confidence,
                     needsReview: true,
                     details: {
                       matchedFile: mediaMeta?.fileName || "",
                       applicationId: confirmedMatch.order.applicationId,
                       reason: 'awaiting "Revision Done" marker from the vendor',
                     },
                   });
                   // Surface it, otherwise a corrected file sits in the database
                   // indefinitely and nobody knows the customer is still waiting.
                   await forwardUndeliveredDocument({
                     sock, userId, sessionId,
                     outcome: "REVISION_PENDING",
                     buffer: downloadedMediaBuffer,
                     mediaMeta, msgType, senderPhone: sender,
                     extraLines: [`Customer Number: ${normalizePhone(confirmedMatch.order.customerPhone)}`],
                   });
                   dynamicDeliveryHandled = true;
                 } else if (!isDeliverableNumber(confirmedMatch.order.customerPhone)) {
                   // The order is keyed by something that is not a dialable
                   // number — almost always an unresolved LID. Sending to
                   // "<lid>@s.whatsapp.net" reports success while reaching
                   // nobody, so the file silently vanishes and the audit claims
                   // DELIVERED. Refuse, and route it for manual handling.
                   console.error(`[Dynamic Delivery] refusing to send to non-phone recipient "${confirmedMatch.order.customerPhone}" (order ${confirmedMatch.order.applicationId})`);
                   await recordDeliveryAudit({
                     userId, sessionId,
                     messageId: msg?.key?.id || "",
                     customerPhone: confirmedMatch.order.customerPhone,
                     outcome: "NO_MATCH",
                     confidence: 0,
                     needsReview: true,
                     details: {
                       matchedFile: mediaMeta?.fileName || "",
                       applicationId: confirmedMatch.order.applicationId,
                       reason: "customer record holds an unresolved LID, not a phone number",
                     },
                   });
                   await forwardUndeliveredDocument({
                     sock, userId, sessionId,
                     outcome: "NO_MATCH",
                     buffer: downloadedMediaBuffer,
                     mediaMeta, msgType, senderPhone: sender,
                     extraLines: ["কারণ: customer-এর নম্বর সঠিকভাবে সংরক্ষিত হয়নি"],
                   });
                   dynamicDeliveryHandled = true;
                 } else {
                 match = confirmedMatch;
                 if (revisionDoneNow && match.order.status !== "PENDING") {
                   console.log(`[Revision] ${match.order.applicationId}: marked Revision Done - delivering corrected file`);
                 }

                 const targetJid = `${match.order.customerPhone}@s.whatsapp.net`;
                 const caption = match.order.applicationId.startsWith("FORM-")
                   ? `আপনার অর্ডারের file দেওয়া হলো।\nনাম: ${match.order.name || match.order.englishName}\nDOB: ${match.order.dob}`
                   : `আপনার অর্ডারের file দেওয়া হলো।\nApplication ID: ${match.order.applicationId}`;
                 const outgoing = msgType === "documentMessage"
                   ? await sock.sendMessage(targetJid, { document: downloadedMediaBuffer, mimetype: mediaMeta?.mimeType || "application/pdf", fileName: mediaMeta?.fileName || `${match.order.applicationId}.pdf`, caption })
                   : await sock.sendMessage(targetJid, { image: downloadedMediaBuffer, mimetype: mediaMeta?.mimeType || "image/jpeg", caption });
                 if (outgoing?.key?.id && !(await Message.exists({ session: sessionId, "message.key.id": outgoing.key.id }))) {
                   await Message.create({
                     user: userId,
                     session: sessionId,
                     message: outgoing,
                     direction: "sent",
                     fromNumber: match.order.customerPhone,
                     msgType: msgType === "documentMessage" ? "document" : "image",
                     body: caption,
                     mediaUrl: null,
                   });
                 }
                 await match.order.updateOne({
                   $set: {
                     status: "DELIVERED",
                     sellerPhone: sender,
                     matchedFile: mediaMeta?.fileName || "",
                     matchedFields: match.matchedFields,
                     deliveryMessageId: outgoing?.key?.id || "",
                     deliveredAt: new Date(),
                   },
                 });
                 dynamicDeliveryHandled = true;
                 // Remember what this customer received so an identical resend
                 // can be recognised instead of being sent twice.
                 await DeliveredFile.updateOne(
                   {
                     session: sessionId,
                     customerPhone: normalizePhone(match.order.customerPhone),
                     fileHash: crypto.createHash("sha256").update(downloadedMediaBuffer).digest("hex"),
                   },
                   {
                     $set: {
                       user: userId,
                       fileName: mediaMeta?.fileName || "",
                       applicationId: match.order.applicationId,
                       sellerPhone: sender,
                       deliveryMessageId: outgoing?.key?.id || "",
                     },
                   },
                   { upsert: true },
                 ).catch((err) => console.error("[Duplicate] could not record delivery:", err.message));
                 await recordDeliveryAudit({
                   userId,
                   sessionId,
                   messageId: msg?.key?.id || "",
                   customerPhone: match.order.customerPhone,
                   outcome: "DELIVERED",
                   confidence: match.confidence,
                   needsReview: false,
                   details: {
                     orderId: String(match.order._id),
                     applicationId: match.order.applicationId,
                     matchedFields: match.matchedFields,
                     matchedFile: mediaMeta?.fileName || "",
                     sellerPhone: sender,
                   },
                 });
                 onMessageSent(sessionId, outgoing, match.order.customerPhone).catch((err) => console.error(`[Webhook Error] dynamic delivery [Session: ${sessionId}]:`, err.message));
                 console.log(`[Dynamic Delivery] ${msgType} matched ${match.order.applicationId} and sent to ${match.order.customerPhone}`);
                 }
                 } else if (match) {
                   await recordDeliveryAudit({
                     userId,
                     sessionId,
                     messageId: msg?.key?.id || "",
                     customerPhone: match.order.customerPhone,
                     outcome: "SOURCE_IS_CUSTOMER",
                     confidence: match.confidence,
                     needsReview: true,
                     details: { orderId: String(match.order._id), matchedFields: match.matchedFields },
                   });
                   await forwardUndeliveredDocument({
                     sock, userId, sessionId,
                     outcome: "SOURCE_IS_CUSTOMER",
                     buffer: downloadedMediaBuffer,
                     mediaMeta, msgType, senderPhone: sender,
                     extraLines: [`সম্ভাব্য order: ${match.order.applicationId}`],
                   });
                 } else {
                   // Before declaring NO_MATCH, check whether these exact file
                   // bytes were already delivered earlier in this account/session.
                   //
                   // This is important after an order becomes DELIVERED: the order
                   // may no longer qualify as a pending match, but an identical
                   // vendor resend is still a DUPLICATE, not a NO_MATCH.
                   const unmatchedFileHash = crypto
                     .createHash("sha256")
                     .update(downloadedMediaBuffer)
                     .digest("hex");

                   const priorDeliveries = await DeliveredFile.find({
                     user: userId,
                     session: sessionId,
                     fileHash: unmatchedFileHash,
                   })
                     .sort({ createdAt: -1 })
                     .lean();

                   if (priorDeliveries.length) {
                     const priorCustomers = [
                       ...new Set(
                         priorDeliveries
                           .map((item) => normalizePhone(item.customerPhone))
                           .filter(Boolean)
                       ),
                     ];

                     const prior = priorDeliveries[0];
                     const duplicateCustomer =
                       priorCustomers.length === 1 ? priorCustomers[0] : "";

                     console.log(
                       `[Duplicate] ${mediaMeta?.fileName || "file"} already exists in delivery history - not treating as NO_MATCH`
                     );

                     await recordDeliveryAudit({
                       userId,
                       sessionId,
                       messageId: msg?.key?.id || "",
                       customerPhone: duplicateCustomer || sender,
                       outcome: "DUPLICATE",
                       confidence: 1,
                       needsReview: true,
                       details: {
                         matchedFile: mediaMeta?.fileName || "",
                         applicationId: prior?.applicationId || "",
                         reason: "identical file hash already exists in delivery history",
                         priorCustomerCount: priorCustomers.length,
                       },
                     });

                     const duplicateExtraLines = [];

                     if (duplicateCustomer) {
                       duplicateExtraLines.push(
                         `Customer Number: ${duplicateCustomer}`
                       );
                     } else {
                       duplicateExtraLines.push(
                         `Previously delivered to ${priorCustomers.length} customers; manual verification required.`
                       );
                     }

                     if (prior?.createdAt) {
                       duplicateExtraLines.push(
                         `Delivered on: ${new Date(prior.createdAt).toLocaleString(
                           "en-GB",
                           { timeZone: "Asia/Dhaka" }
                         )}`
                       );
                     }

                     await forwardUndeliveredDocument({
                       sock,
                       userId,
                       sessionId,
                       outcome: "DUPLICATE",
                       buffer: downloadedMediaBuffer,
                       mediaMeta,
                       msgType,
                       senderPhone: sender,
                       extraLines: duplicateExtraLines,
                     });
                   } else {
                     await recordDeliveryAudit({
                       userId,
                       sessionId,
                       messageId: msg?.key?.id || "",
                       customerPhone: sender,
                       outcome: "NO_MATCH",
                       confidence: 0,
                       needsReview: true,
                       details: {
                         matchedFile: mediaMeta?.fileName || "",
                         ocrMethod: mediaMeta?.ocrMethod || "NONE",
                         reason: ocrIdentityConflict
                           ? "OCR engines disagree on DOB"
                           : "no safe customer match after OCR fallbacks",
                         primaryDobs: ocrIdentityConflict?.primaryDobs || [],
                         easyOcrDobs: ocrIdentityConflict?.easyDobs || [],
                       },
                     });

                     await forwardUndeliveredDocument({
                       sock,
                       userId,
                       sessionId,
                       outcome: "NO_MATCH",
                       buffer: downloadedMediaBuffer,
                       mediaMeta,
                       msgType,
                       senderPhone: sender,
                       extraLines: ocrIdentityConflict
                         ? [
                             `OCR DOB conflict: primary=${ocrIdentityConflict.primaryDobs.join(", ") || "unknown"} | EasyOCR=${ocrIdentityConflict.easyDobs.join(", ") || "unknown"}`,
                           ]
                         : [],
                     });
                   }
                 }
               }
             } catch (deliveryErr) {
               console.error(`[Dynamic Delivery Error] [Session: ${sessionId}]:`, deliveryErr.message);
               await recordDeliveryAudit({
                 userId,
                 sessionId,
                 messageId: msg?.key?.id || "",
                 customerPhone: senderPhone,
                 outcome: "ERROR",
                 needsReview: true,
                 details: { matchedFile: mediaMeta?.fileName || "" },
                 error: deliveryErr.message,
               });
               // A crash must not swallow the file. Push it to the review group
               // so the work is visible rather than lost in the logs.
               await forwardUndeliveredDocument({
                 sock, userId, sessionId,
                 outcome: "ERROR",
                 buffer: downloadedMediaBuffer,
                 mediaMeta, msgType, senderPhone: normalizePhone(senderPhone),
                 extraLines: [`Error: ${deliveryErr.message}`],
               }).catch((err) => console.error("[Undelivered] error-path forward failed:", err.message));
             }

             // Chatbot / Auto Responder Logic
             try {
                const textMsg = actualMessage.conversation || 
                                actualMessage.extendedTextMessage?.text || 
                                actualMessage.imageMessage?.caption || 
                                actualMessage.videoMessage?.caption || "";
                
                // console.log(`🤖 [AutoReply Trace] Incoming msg: "${textMsg}" for session: ${sessionId}`);

                if (textMsg) {
                    const rules = await AutoReply.find({ session: sessionId, isActive: true });
                    // console.log(`🤖 [AutoReply Trace] Found ${rules.length} active rules for this session.`);
                    let isMatchAny = false;
                    
                    for (const rule of rules) {
                        let isMatch = false;
                        const lowerInput = textMsg.trim().toLowerCase();
                        const lowerKeyword = rule.keyword.toLowerCase();

                        // console.log(`🤖 [AutoReply Trace] Evaluating rule ID: ${rule._id} | Type: ${rule.matchType} | Keyword: "${lowerKeyword}"`);

                        if (rule.matchType === "exact" && lowerInput === lowerKeyword) {
                            isMatch = true;
                        } else if (rule.matchType === "contains" && lowerInput.includes(lowerKeyword)) {
                            isMatch = true;
                        } else if (rule.matchType === "regex") {
                           try {
                             const regex = new RegExp(rule.keyword, "i");
                             if (regex.test(textMsg)) isMatch = true;
                           } catch(e) {}
                        }

                        if (isMatch) {
                            // console.log(`🤖 [AutoReply Trace] Rule matched! Replying to: ${senderPhone}`);
                            // 1. Initial short delay to "notice" the message
                            setTimeout(async () => {
                                try {
                                    const jid = msg.key.remoteJid;
                                    // console.log(`🤖 [AutoReply Trace] Activating typing status for: ${jid}`);
                                    
                                    // 2. Turn on 'composing' (Typing...) indicator
                                    await sock.sendPresenceUpdate('composing', jid);
                                    
                                    // 3. Dynamic typing delay based on message length (min 1.5s, max 4s)
                                    const typingDuration = Math.min(Math.max(rule.replyText.length * 40, 1500), 4000);
                                    
                                    setTimeout(async () => {
                                        // 4. Turn off composing
                                        await sock.sendPresenceUpdate('paused', jid);
                                        // 5. Send message with quote
                                        const payload = await buildMediaPayload(rule.replyText, rule.mediaUrl, rule.mediaType);
                                        await sock.sendMessage(jid, payload, { quoted: msg });
                                        // console.log(`🤖 [AutoReply Trace] Success! Sent reply after ${typingDuration}ms typing delay.`);
                                    }, typingDuration);

                                } catch(err) {
                                  console.error("AutoReply failed:", err);
                                }
                            }, 500); // 500ms delay before "typing" starts
                            
                            isMatchAny = true;
                            break; // Stop evaluating after first rule triggers
                        }
                    }

                    // Fallback message if no rules matched
                    if (!isMatchAny) {
                        const isGroup = msg.key.remoteJid.endsWith("@g.us");
                        
                        if (!isGroup) {
                            try {
                                const currentSession = await sessionModel.findById(sessionId);
                                
                                if (currentSession) {
                                    // 1) VIP ChatGPT AI Handling
                                    if (currentSession.aiEnabled && currentSession.openAiKey) {
                                        const jid = msg.key.remoteJid;
                                        await sock.sendPresenceUpdate('composing', jid);
                                        const aiResponse = await askChatGPT(currentSession.openAiKey, currentSession.aiPrompt, textMsg);
                                        await sock.sendPresenceUpdate('paused', jid);
                                        
                                        if (aiResponse) {
                                            const aiMsg = await sock.sendMessage(jid, { text: aiResponse }, { quoted: msg });
                                            // Make sure to dispatch the webhook for AI replies too
                                            onMessageSent(sessionId, aiMsg, senderPhone).catch(err => console.error(`[Webhook Error] message.sent (AI) [Session: ${sessionId}]:`, err.message));
                                            return; // Stop here, AI handled it
                                        }
                                    }

                                    // 2) Static Fallback message if AI is disabled or fails
                                    if (currentSession.fallbackEnabled && currentSession.fallbackMessage) {
                                        const fallbackText = currentSession.fallbackMessage.trim();
                                        
                                        // Anti-Loop Check: Don't auto-reply if the user's message IS the fallback text
                                        if (textMsg.trim() !== fallbackText) {
                                            setTimeout(async () => {
                                                try {
                                                    const jid = msg.key.remoteJid;
                                                    await sock.sendPresenceUpdate('composing', jid);
                                                    
                                                    // Dynamic typing duration based on fallback message length
                                                    const typingDur = Math.min(Math.max(fallbackText.length * 40, 1500), 3000);
                                                    
                                                    setTimeout(async () => {
                                                        await sock.sendPresenceUpdate('paused', jid);
                                                        const fallbackMsg = await sock.sendMessage(jid, { text: fallbackText }, { quoted: msg });
                                                        onMessageSent(sessionId, fallbackMsg, senderPhone).catch(err => console.error(`[Webhook Error] message.sent (Fallback) [Session: ${sessionId}]:`, err.message));
                                                    }, typingDur);
                                                } catch (e) {
                                                    console.error("Fallback failed:", e);
                                                }
                                            }, 500);
                                        }
                                    }
                                }
                            } catch (err) {
                                console.error("Error evaluating fallback settings:", err);
                            }
                        }
                    }
                }
             } catch(err) {
                console.error("AutoReply error:", err);
             }

             // ── Save incoming message to DB for inbox ──
             try {
               const textBody = actualMessage?.conversation ||
                 actualMessage?.extendedTextMessage?.text ||
                 actualMessage?.imageMessage?.caption ||
                 actualMessage?.videoMessage?.caption ||
                 actualMessage?.documentMessage?.caption || "";
               
               const simpleMsgType = msgType.replace("Message", "");
               
               await Message.create({
                 user: userId,
                 session: sessionId,
                 message: msg,
                 direction: "received",
                 fromNumber: senderPhone,
                 msgType: simpleMsgType || "text",
                 body: textBody || mediaMeta?.ocrText?.slice(0, 12000) || "",
                 mediaUrl: mediaUrl || null,
                 displayName: pushName || null,
               });

               // Include the OCR text, not just the caption. A customer who
               // sends a document with no caption has an empty textBody, so
               // parseOrderDetails saw nothing and no order was recorded even
               // though the details had been extracted and stored on the
               // message. The order then only appeared later, indirectly, via
               // the backfill triggered by an unmatched seller file. Caption
               // and OCR text are combined because either may carry fields the
               // other lacks.
               // Only a customer's message becomes an order. A seller's message
               // carries the customer's details too, so without this guard the
               // seller's own number acquires a phantom order and their next
               // delivery is refused as SOURCE_IS_CUSTOMER.
               // Only a customer's message becomes an order, and vendors.txt
               // alone decides who is a vendor.
               // An unresolved LID is not a phone number. Keying an order to
               // one produces a record that can never be delivered: the send
               // goes to "<lid>@s.whatsapp.net", reports success, and reaches
               // nobody. Length cannot tell the two apart — this LID is 15
               // digits, a valid MSISDN length — so rely on the JID itself.
               const senderIsUnresolvedLid = isLidJid && normalizePhone(senderPhone) === normalizePhone(rawNum);
               await refreshDbVendors(userId, sessionId);
               if (!inWorkflowScope) {
                 // Customer identification is one of the things an unrelated
                 // chat must not trigger.
               } else if (senderIsUnresolvedLid) {
                 console.warn(`[Order] sender ${rawNum} is an unresolved LID - no order created (cannot be delivered to)`);
               } else if (isVendor(userId, sessionId, senderPhone)) {
                 console.log(`[Vendors] ${senderPhone} (${vendorName(userId, sessionId, senderPhone)}) is a vendor - no order created`);
               } else {
                 const currentText = [textBody, mediaMeta?.ocrText || ""]
                   .filter(Boolean).join("\n").slice(0, 12000);

                 let created = await upsertDynamicOrder({
                   userId,
                   sessionId,
                   customerPhone: senderPhone,
                   text: currentText,
                   messageId: msg?.key?.id || "",
                 });

                 // Customers rarely put everything in one message: the name
                 // arrives as text, the date of birth in a photo, the parents'
                 // names in a PDF. Each fragment alone carries one field, and
                 // an order needs two, so on its own every fragment is
                 // discarded and no order is ever recorded. When the current
                 // message is not enough, retry against this customer's recent
                 // messages combined.
                 //
                 // The window is deliberately tight — recent messages only —
                 // because merging across unrelated conversations could stitch
                 // one person's name to another's date of birth and produce an
                 // order matching neither.
                 if (!created && currentText) {
                   const RECENT_FRAGMENT_MS = 30 * 60 * 1000;
                   const recent = await Message.find({
                     user: userId,
                     session: sessionId,
                     direction: "received",
                     fromNumber: senderPhone,
                     body: { $exists: true, $ne: "" },
                     createdAt: { $gte: new Date(Date.now() - RECENT_FRAGMENT_MS) },
                   }).sort({ createdAt: -1 }).limit(10).lean();

                   const combined = [...recent.map((entry) => entry.body), currentText]
                     .filter(Boolean).join("\n").slice(0, 12000);

                   if (combined !== currentText) {
                     created = await upsertDynamicOrder({
                       userId,
                       sessionId,
                       customerPhone: senderPhone,
                       text: combined,
                       messageId: msg?.key?.id || "",
                     });
                     if (created) {
                       console.log(`[Order] ${senderPhone}: built from ${recent.length + 1} recent messages -> ${created.applicationId}`);
                     }
                   }
                 }
               }

               try {
                 const inboundMessageId = msg?.key?.id || "";
                 await createOrdersFromCustomerMessage({
                   userId,
                   sessionId,
                   senderPhone,
                   senderName: pushName || "",
                   text: textBody,
                   messageId: inboundMessageId,
                 });

                 if (textBody) {
                   await captureAgentRateSignal({
                     userId,
                     sessionId,
                     senderPhone,
                     text: textBody,
                   });
                 }

                 if (
                   !dynamicDeliveryHandled &&
                   simpleMsgType === "document" &&
                   savedMediaPath &&
                   actualMessage?.documentMessage
                 ) {
                   await processAgentDocumentMessage({
                     userId,
                     sessionId,
                     senderPhone,
                     messageId: inboundMessageId,
                     caption: textBody,
                     storedPath: savedMediaPath,
                     mimeType: actualMessage.documentMessage.mimetype || "",
                     originalFileName:
                       actualMessage.documentMessage.fileName || "",
                   });
                 }
               } catch (signCopyErr) {
                 console.error("[SignCopy] inbound processing failed:", signCopyErr.message);
               }
             } catch (saveErr) {
               console.error("[Inbox] Failed to save incoming message:", saveErr.message);
             }

             onMessageReceived(sessionId, msg, senderPhone, mediaUrl, location, contact, mediaMeta).catch(err => console.error(`[Webhook Error] message.received [Session: ${sessionId}]:`, err.message));
          }

          } // end: isLidJid guard
        } catch (error) {
          console.error("Error dispatching message webhook:", error);
        }
      }
    });

    sock.ev.on("messages.update", async (updates) => {
      for (const update of updates) {
        if (update.update?.status) {
          try {
             onMessageStatusUpdate(sessionId, update).catch(err => console.error(`[Webhook Error] message.status [Session: ${sessionId}]:`, err.message));
          } catch (error) {
             console.error("Error dispatching status update webhook:", error);
          }
        }
      }
    });

    return client;
  })();

  try {
    return await sessionLocks[sessionId];
  } finally {
    // Only delete the lock once fully resolved and stabilized
    delete sessionLocks[sessionId];
  }
}

/* ───────── GET CLIENT ───────── */
export async function getClient(userId, sessionId) {
  clients[userId] ??= {};

  if (!clients[userId][sessionId]) {
    await initSession(userId, sessionId);
  }

  return clients[userId][sessionId];
}

/* ───────── GET QR ───────── */
export async function getQR(userId, sessionId, timeout = 20000) {
  const client = await getClient(userId, sessionId);

  if (client.connected) return null;

  if (client.qr) return client.qr;

  await Promise.race([
    client.qrReady,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("QR timeout")), timeout),
    ),
  ]);

  return client.qr;
}

/* ───────── PAIR CODE ───────── */
export async function getPairCode(
  userId,
  sessionId,
  phoneNumber,
  timeout = 20000,
) {
  const client = await getClient(userId, sessionId);

  if (client.connected) {
    throw new Error("Already connected");
  }

  const clean = cleanNumber(phoneNumber);

  const code = await Promise.race([
    client.sock.requestPairingCode(clean),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Pair code timeout")), timeout),
    ),
  ]);

  await sessionModel.findByIdAndUpdate(sessionId, {
    status: "PAIR_CODE",
  });

  return code;
}

/* ───────── STATUS ───────── */
export async function getStatus(userId, sessionId, timeout = 15000) {
  const session = await sessionModel.findById(sessionId);
  return session?.status === "CONNECTED";
}

export async function getClientForMsg(userId, sessionId) {
  clients[userId] ??= {};

  // 1️⃣ Restore client if missing
  if (!clients[userId][sessionId]) {
    if (!hasSession(userId, sessionId)) {
      throw new Error("Session not found. Please login first.");
    }
    await initSession(userId, sessionId);
  }

  const client = clients[userId][sessionId];

  // 2️⃣ Socket already usable → return immediately
  if (client.connected && client.sock?.ws?.readyState === 1) {
    return client;
  }

  // 3️⃣ Wait ONLY if not connected
  await Promise.race([
    client.ready,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("WhatsApp connect timeout")), 5000),
    ),
  ]);

  return client;
}

/* ───────── SEND MESSAGE ───────── */
export async function sendMessage(
  userId,
  sessionId,
  number,
  message,
  isGroup = false,
  options = {}
) {
  const client = await getClientForMsg(userId, sessionId);
  if (!client.connected) throw new Error("WhatsApp not connected");

  const clean = cleanNumber(number);

  const jid = isGroup ? `${clean}@g.us` : `${clean}@s.whatsapp.net`;

  const res = await client.sock.sendMessage(jid, message, options);

  const isReaction = !!message.react;

  const sentType = Object.keys(res?.message || {})[0] || (isReaction ? "reaction" : "text");
  const sentBody =
    res?.message?.conversation ||
    res?.message?.extendedTextMessage?.text ||
    res?.message?.imageMessage?.caption ||
    res?.message?.videoMessage?.caption ||
    res?.message?.documentMessage?.caption ||
    (isReaction ? message.react.text : (message.text || ""));
  if (!(await Message.exists({ session: sessionId, "message.key.id": res?.key?.id }))) {
    await Message.create({
      user: userId,
      session: sessionId,
      message: res,
      direction: "sent",
      fromNumber: clean,
      msgType: sentType.replace("Message", "") || "text",
      body: sentBody,
    });
  }

  // Send webhook event for sent message
  try {
    onMessageSent(sessionId, res, clean).catch(err => console.error(`[Webhook Error] message.sent [Session: ${sessionId}]:`, err.message));
  } catch (error) {
    console.error("Error dispatching message sent webhook:", error);
  }

  return res;
}


/* ───────── MY INFO ───────── */
export async function getMyInfo(userId, sessionId, timeout = 10000) {
  const client = await getClient(userId, sessionId);
  if (!client.connected) {
    await Promise.race([
      client.ready,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Not connected")), timeout),
      ),
    ]);
  }
  return client.sock.user;
}

/* ───────── LOGOUT ───────── */
export async function logout(userId, sessionId) {
  const client = clients[userId]?.[sessionId];
  if (client?.connected) await client.sock.logout();

  await fs.remove(sessionPath(userId, sessionId));
  delete clients[userId]?.[sessionId];

  //reinit
  await initSession(userId, sessionId);
}

export async function clear(userId, sessionId) {
  const client = clients[userId]?.[sessionId];
  if (client?.connected) await client.sock.logout();

  await fs.remove(sessionPath(userId, sessionId));
  delete clients[userId]?.[sessionId];

  await sessionModel.findByIdAndDelete(sessionId);
}

/* ───────── GROUP LIST ───────── */

export async function getGroupList(userId, sessionId) {
  const client = await getClient(userId, sessionId);

  if (!client.connected) {
    await Promise.race([
      client.ready,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Not connected")), 15000),
      ),
    ]);
  }
  const groups = await client.sock.groupFetchAllParticipating();
  const normalizeJid = (value = "") => String(value).replace(/:\d+(?=@)/, "");
  const ownJids = new Set([
    client.sock.user?.id,
    client.sock.user?.lid,
  ].filter(Boolean).map(normalizeJid));

  for (const group of Object.values(groups)) {
    const me = (group.participants || []).find((participant) =>
      ownJids.has(normalizeJid(participant.id)),
    );
    const isAdmin = me?.admin === "admin" || me?.admin === "superadmin";
    // announce=true means only admins can write; in a normal group every
    // participant can write. Never infer write access from the group name.
    group.isAdmin = isAdmin;
    group.myRole = me?.admin || "member";
    group.canWrite = !group.announce || isAdmin;
  }
  return groups;
}


/* ───────── CREATE REVIEW GROUP ───────── */

export async function createReviewGroup(
  userId,
  sessionId,
  groupName,
  participantNumbers = [],
) {
  const client = await getClientForMsg(userId, sessionId);

  if (!client?.connected || !client?.sock) {
    throw new Error("WhatsApp session is not connected");
  }

  const subject = String(groupName || "").trim();

  if (subject.length < 3 || subject.length > 100) {
    throw new Error("Group name must be between 3 and 100 characters");
  }

  const participants = [...new Set(
    (Array.isArray(participantNumbers) ? participantNumbers : [])
      .map((number) => cleanNumber(String(number || "")))
      .filter((number) => number.length >= 10 && number.length <= 15)
  )];

  if (!participants.length) {
    throw new Error("At least one valid WhatsApp participant number is required");
  }

  const participantJids = participants.map(
    (number) => `${number}@s.whatsapp.net`
  );

  const metadata = await client.sock.groupCreate(subject, participantJids);

  const groupJid = String(metadata?.id || "").trim();

  if (!groupJid.endsWith("@g.us")) {
    throw new Error("WhatsApp did not return a valid group JID");
  }

  return {
    jid: groupJid,
    subject: String(metadata?.subject || subject),
    participants,
    metadata,
  };
}

/* ───────── HELPER: BUILD MEDIA PAYLOAD ───────── */
export async function buildMediaPayload(text, mediaUrl, mediaType) {
  if (!mediaUrl || !mediaType || mediaType === "none") {
    return { text: text || "" };
  }

  let mediaContent;

  // If it's a local path (e.g. /uploads/xxx.jpg), load from disk as buffer
  if (mediaUrl.startsWith("/")) {
    try {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      // Strip leading slash and join properly (important on Windows)
      const relativePath = mediaUrl.replace(/^\//, '');
      const localPath = path.join(__dirname, "..", "public", relativePath);
      console.log("[buildMediaPayload] Reading file from:", localPath);
      const buffer = await fs.readFile(localPath);
      mediaContent = buffer;
      console.log("[buildMediaPayload] Buffer size:", buffer.length, "bytes");
    } catch (e) {
      console.error("[buildMediaPayload] Failed to read local file:", e.message);
      // fallback to URL
      mediaContent = { url: (process.env.BASE_URL || "http://localhost:" + (process.env.PORT || 3000)) + mediaUrl };
    }
  } else {
    mediaContent = { url: mediaUrl };
  }

  if (mediaType === "image") {
    return { image: mediaContent, caption: text || "" };
  } else if (mediaType === "video") {
    return { video: mediaContent, caption: text || "" };
  } else if (mediaType === "document") {
    const fileName = (typeof mediaUrl === 'string' ? mediaUrl.split('/').pop() : "document") || "document";
    return { document: mediaContent, mimetype: "application/octet-stream", fileName, caption: text || "" };
  } else if (mediaType === "audio") {
    return { audio: mediaContent, mimetype: "audio/mp4" };
  }

  return { text: text || "" };
}

export async function sendUserAlert(userId, text) {
  const userSessions = clients[userId];
  if (!userSessions) return false;
  
  for (const sessionId of Object.keys(userSessions)) {
    const client = userSessions[sessionId];
    if (client && client.connected && client.sock) {
      try {
        // Strip out the connection suffix if Baileys provides one (e.g. :1)
        const myJid = client.sock.user.id.split(":")[0] + "@s.whatsapp.net";
        await client.sock.sendMessage(myJid, { text });
        console.log(`[Alert] Sent WhatsApp alert to user ${userId} via session ${sessionId}`);
        return true;
      } catch (err) {
        console.error(`Failed to send alert via session ${sessionId}:`, err.message);
      }
    }
  }
  return false;
}
