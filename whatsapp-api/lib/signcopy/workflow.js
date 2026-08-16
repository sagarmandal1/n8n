import fs from "fs-extra";
import mongoose from "mongoose";
import SignCustomer from "../../models/signCustomerModel.js";
import SignAgent from "../../models/signAgentModel.js";
import SignOrder from "../../models/signOrderModel.js";
import SignDocument from "../../models/signDocumentModel.js";
import SignLedger from "../../models/signLedgerModel.js";
import SignCustomerRequest from "../../models/signCustomerRequestModel.js";
import Session from "../../models/sessionModel.js";
import { sendMessage } from "../whatsapp.js";
import { extractPdfText } from "./documentProcessor.js";
import {
  extractOrderDigits,
  normalizeDigits,
  normalizeText,
  parseRateFromText,
} from "./rateParser.js";

export function normalizePhone(input = "") {
  const digits = String(input).replace(/\D/g, "");
  if (/^01\d{9}$/.test(digits)) return `88${digits}`;
  return digits;
}

function normalizePhoneList(list = []) {
  return Array.from(
    new Set(
      (Array.isArray(list) ? list : [])
        .map((v) => normalizePhone(v))
        .filter(Boolean),
    ),
  );
}

async function addLedgerEntry(payload) {
  await SignLedger.create(payload);
}

function isPositiveNumber(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

async function getSignCopySettings({ userId, sessionId }) {
  const session = await Session.findOne({ _id: sessionId, user: userId }).select(
    "forwardingEnabled signCopySettings",
  );
  const settings = session?.signCopySettings || {};
  return {
    forwardingEnabled: session?.forwardingEnabled === true,
    notifyEnabled: settings.notifyEnabled !== false,
    notifyTargets: normalizePhoneList(settings.notifyTargets || []),
    rateLimitMinutes: Number(settings.rateLimitMinutes ?? 10),
    blocklist: normalizePhoneList(settings.blocklist || []),
  };
}

async function maybeNotifyAdminAboutPending({ userId, sessionId, request, settings }) {
  if (!settings.forwardingEnabled) return { notified: false };
  if (!settings.notifyEnabled) return { notified: false };
  if (!settings.notifyTargets.length) return { notified: false };

  const rateLimitMinutes = Math.max(0, Number(settings.rateLimitMinutes || 0));
  const lastNotifiedAt = request.lastNotifiedAt
    ? new Date(request.lastNotifiedAt).getTime()
    : 0;
  const now = Date.now();
  if (rateLimitMinutes > 0 && lastNotifiedAt && now - lastNotifiedAt < rateLimitMinutes * 60000) {
    return { notified: false, reason: "rate_limited" };
  }

  const digitsPreview = (request.requestedDigits || []).slice(0, 8).join(", ");
  const notifyText = [
    "New Sign Copy Customer Request",
    `Phone: ${request.phone}`,
    request.senderName ? `Name: ${request.senderName}` : null,
    digitsPreview ? `Digits: ${digitsPreview}` : null,
    request.lastMessage ? `Msg: ${String(request.lastMessage).slice(0, 160)}` : null,
    "Approve from dashboard:",
    "https://wafastapi.com/templates?module=signcopy",
  ]
    .filter(Boolean)
    .join("\n");

  let sent = 0;
  for (const target of settings.notifyTargets) {
    try {
      await sendMessage(userId, sessionId, target, { text: notifyText });
      sent += 1;
    } catch (_) {}
  }

  if (sent > 0) {
    request.lastNotifiedAt = new Date();
    request.notifyCount = Number(request.notifyCount || 0) + 1;
    await request.save();
  }

  return { notified: sent > 0, sent };
}

async function maybeNotifyCustomerPending({ userId, sessionId, request, settings }) {
  if (!settings.forwardingEnabled) return { notified: false };
  const rateLimitMinutes = Math.max(0, Number(settings.rateLimitMinutes || 0));
  const lastNotifiedAt = request.lastCustomerNotifiedAt
    ? new Date(request.lastCustomerNotifiedAt).getTime()
    : 0;
  const now = Date.now();
  if (rateLimitMinutes > 0 && lastNotifiedAt && now - lastNotifiedAt < rateLimitMinutes * 60000) {
    return { notified: false, reason: "rate_limited" };
  }

  const text =
    "আপনার নম্বর যোগ করার অনুরোধ গ্রহণ করা হয়েছে এবং এখন pending আছে।\n" +
    "Admin approve করলে এই নম্বরটি bot-এ যোগ করা হবে।\n" +
    "অনুগ্রহ করে কিছুক্ষণ অপেক্ষা করুন।";

  try {
    await sendMessage(userId, sessionId, request.phone, { text });
    request.lastCustomerNotifiedAt = new Date();
    request.customerNotifyCount = Number(request.customerNotifyCount || 0) + 1;
    await request.save();
    return { notified: true };
  } catch (_) {
    return { notified: false };
  }
}

async function persistDeliveredState({
  userId,
  sessionId,
  orderId,
  customerId,
  agentId,
  documentId,
  customerRate,
  agentRate,
  deliveryMessageId,
  dbSession = null,
}) {
  const [freshOrder, freshCustomer, freshAgent] = await Promise.all([
    SignOrder.findById(orderId).session(dbSession),
    SignCustomer.findById(customerId).session(dbSession),
    SignAgent.findById(agentId).session(dbSession),
  ]);

  if (!freshOrder || !freshCustomer || !freshAgent) {
    throw new Error("Delivery update করার সময় data পাওয়া যায়নি");
  }

  if (freshOrder.status === "DELIVERED" || freshOrder.deliveredAt || freshOrder.deliveryMessageId) {
    throw new Error("এই order আগে থেকেই delivered");
  }

  if (
    freshCustomer.customerType === "prepaid" &&
    Number(freshCustomer.balance || 0) < customerRate
  ) {
    throw new Error("Prepaid balance যথেষ্ট নেই");
  }

  if (
    freshCustomer.customerType === "trusted" &&
    isPositiveNumber(freshCustomer.creditLimit) &&
    Number(freshCustomer.dueAmount || 0) + customerRate > Number(freshCustomer.creditLimit)
  ) {
    throw new Error("Trusted customer credit limit ছাড়িয়ে গেছে");
  }

  if (freshCustomer.customerType === "prepaid") {
    freshCustomer.balance = Number(freshCustomer.balance || 0) - customerRate;
  } else {
    freshCustomer.dueAmount = Number(freshCustomer.dueAmount || 0) + customerRate;
  }
  freshCustomer.totalBilled = Number(freshCustomer.totalBilled || 0) + customerRate;
  freshCustomer.totalDelivered = Number(freshCustomer.totalDelivered || 0) + 1;
  await freshCustomer.save(dbSession ? { session: dbSession } : undefined);

  freshAgent.totalPayable = Number(freshAgent.totalPayable || 0) + agentRate;
  freshAgent.totalDelivered = Number(freshAgent.totalDelivered || 0) + 1;
  await freshAgent.save(dbSession ? { session: dbSession } : undefined);

  freshOrder.status = "DELIVERED";
  freshOrder.reviewReason = "";
  freshOrder.matchedDocument = documentId;
  freshOrder.detectedAgentRate = agentRate;
  freshOrder.customerSellRate = customerRate;
  freshOrder.adminProfit = customerRate - agentRate;
  freshOrder.deliveryMessageId = deliveryMessageId;
  freshOrder.deliveredAt = new Date();
  await freshOrder.save(dbSession ? { session: dbSession } : undefined);

  const ledgerDocs = [
    {
      user: userId,
      session: sessionId,
      customer: freshCustomer._id,
      order: freshOrder._id,
      entryType: "CUSTOMER_CHARGE",
      amount: customerRate,
      note:
        freshCustomer.customerType === "prepaid"
          ? "Prepaid customer charge"
          : "Trusted customer due charge",
      meta: {
        requestedDigit: freshOrder.requestedDigit,
        customerType: freshCustomer.customerType,
      },
    },
    {
      user: userId,
      session: sessionId,
      agent: freshAgent._id,
      order: freshOrder._id,
      entryType: "AGENT_PAYABLE",
      amount: agentRate,
      note: "Agent delivery payable",
      meta: { requestedDigit: freshOrder.requestedDigit },
    },
    {
      user: userId,
      session: sessionId,
      customer: freshCustomer._id,
      agent: freshAgent._id,
      order: freshOrder._id,
      entryType: "PROFIT",
      amount: customerRate - agentRate,
      note: "Admin profit from delivered order",
      meta: { requestedDigit: freshOrder.requestedDigit },
    },
  ];

  if (dbSession) {
    await SignLedger.create(ledgerDocs, { session: dbSession });
  } else {
    await SignLedger.insertMany(ledgerDocs);
  }
}

async function putOrderInReview(order, reason, extra = {}) {
  order.status = "MANUAL_REVIEW";
  order.reviewReason = reason;
  Object.assign(order, extra);
  await order.save();
  return order;
}

async function putOrderOnHold(order, reason, extra = {}) {
  order.status = "FUNDS_HOLD";
  order.reviewReason = reason;
  Object.assign(order, extra);
  await order.save();
  return order;
}

async function finalizeDelivery({ userId, sessionId, order, customer, agent, document, agentRate }) {
  if (!agent) {
    return putOrderInReview(order, "Assigned agent পাওয়া যায়নি", {
      matchedDocument: document._id,
    });
  }

  if (order.status === "DELIVERED" || order.deliveredAt || order.deliveryMessageId) {
    throw new Error("এই order আগে থেকেই delivered");
  }

  const customerRate = Number(customer.sellRate || 0);
  if (!customerRate || customerRate <= 0) {
    return putOrderInReview(order, "Customer sell rate set করা নেই", {
      matchedDocument: document._id,
      detectedAgentRate: agentRate,
    });
  }

  if (!Number.isFinite(agentRate) || agentRate < 0) {
    return putOrderInReview(order, "Agent rate detect করা যায়নি", {
      matchedDocument: document._id,
    });
  }

  if (customerRate < agentRate) {
    return putOrderInReview(order, "Customer rate agent rate-এর চেয়ে কম", {
      matchedDocument: document._id,
      detectedAgentRate: agentRate,
      customerSellRate: customerRate,
    });
  }

  if (
    customer.customerType === "prepaid" &&
    Number(customer.balance || 0) < customerRate
  ) {
    return putOrderOnHold(order, "Prepaid balance যথেষ্ট নেই", {
      matchedDocument: document._id,
      detectedAgentRate: agentRate,
      customerSellRate: customerRate,
    });
  }

  if (customer.customerType === "trusted" && isPositiveNumber(customer.creditLimit)) {
    const projectedDue = Number(customer.dueAmount || 0) + customerRate;
    if (projectedDue > Number(customer.creditLimit)) {
      return putOrderOnHold(order, "Trusted customer credit limit ছাড়িয়ে গেছে", {
        matchedDocument: document._id,
        detectedAgentRate: agentRate,
        customerSellRate: customerRate,
      });
    }
  }

  const pdfBuffer = await fs.readFile(document.storedPath);
  const delivery = await sendMessage(userId, sessionId, customer.phone, {
    document: pdfBuffer,
    mimetype: "application/pdf",
    fileName: `${order.requestedDigit}.pdf`,
    caption: `আপনার অর্ডারের ফাইল দেওয়া হলো।\nOrder: ${order.requestedDigit}`,
  });

  const dbSession = await mongoose.startSession();
  try {
    try {
      await dbSession.withTransaction(async () => {
        await persistDeliveredState({
          userId,
          sessionId,
          orderId: order._id,
          customerId: customer._id,
          agentId: agent._id,
          documentId: document._id,
          customerRate,
          agentRate,
          deliveryMessageId: delivery?.key?.id || "",
          dbSession,
        });
      });
    } catch (error) {
      const message = String(error?.message || "");
      const txUnsupported =
        message.includes("Transaction numbers are only allowed") ||
        message.includes("Transaction support") ||
        message.includes("replica set") ||
        message.includes("NoSuchTransaction");

      if (!txUnsupported) throw error;

      await persistDeliveredState({
        userId,
        sessionId,
        orderId: order._id,
        customerId: customer._id,
        agentId: agent._id,
        documentId: document._id,
        customerRate,
        agentRate,
        deliveryMessageId: delivery?.key?.id || "",
      });
    }
  } finally {
    await dbSession.endSession();
  }

  return SignOrder.findById(order._id);
}

export async function createOrdersFromCustomerMessage({
  userId,
  sessionId,
  senderPhone,
  senderName = "",
  text = "",
  messageId = "",
}) {
  const phone = normalizePhone(senderPhone);

  const settings = await getSignCopySettings({ userId, sessionId });
  if (!settings.forwardingEnabled) {
    return { handled: false, createdOrders: [] };
  }

  const customer = await SignCustomer.findOne({
    user: userId,
    session: sessionId,
    phone,
    status: "active",
  });

  if (!customer) {
    const digits = extractOrderDigits(text);
    const normalizedMessage = normalizeText(text);
    if (!digits.length && !normalizedMessage) {
      return { handled: false, createdOrders: [] };
    }

    if (settings.blocklist.includes(phone)) {
      return { handled: true, createdOrders: [], blocked: true };
    }

    const now = new Date();
    const request = await SignCustomerRequest.findOneAndUpdate(
      { user: userId, session: sessionId, phone },
      {
        $setOnInsert: {
          user: userId,
          session: sessionId,
          phone,
          status: "pending",
          firstSeenAt: now,
        },
        $set: {
          senderName: senderName ? String(senderName).trim() : "",
          lastMessage: normalizedMessage,
          lastMessageId: messageId || "",
          lastSeenAt: now,
        },
        $addToSet: { requestedDigits: { $each: digits } },
      },
      { new: true, upsert: true },
    );

    if (request.status === "pending") {
      await maybeNotifyAdminAboutPending({ userId, sessionId, request, settings });
      await maybeNotifyCustomerPending({ userId, sessionId, request, settings });
    }

    return { handled: true, createdOrders: [], pendingRequestId: request._id };
  }

  const digits = extractOrderDigits(text);
  if (!digits.length) {
    return { handled: true, createdOrders: [] };
  }

  const createdOrders = [];
  for (const digit of digits) {
    const existing = await SignOrder.findOne({
      user: userId,
      session: sessionId,
      customer: customer._id,
      requestedDigit: digit,
      status: { $in: ["PENDING", "MATCHED", "FUNDS_HOLD", "MANUAL_REVIEW"] },
    });

    if (existing) continue;

    const order = await SignOrder.create({
      user: userId,
      session: sessionId,
      customer: customer._id,
      agent: customer.assignedAgent || null,
      sourceMessageId: messageId,
      requestedDigit: digit,
      customerMessage: normalizeText(text),
      status: customer.assignedAgent ? "PENDING" : "MANUAL_REVIEW",
      reviewReason: customer.assignedAgent
        ? ""
        : "এই customer-এর জন্য assigned agent set করা নেই",
    });

    createdOrders.push(order);
  }

  if (createdOrders.length && !customer.name && senderName) {
    customer.name = senderName;
    await customer.save();
  }

  return { handled: true, createdOrders };
}

export async function captureAgentRateSignal({
  userId,
  sessionId,
  senderPhone,
  text = "",
}) {
  const phone = normalizePhone(senderPhone);
  const agent = await SignAgent.findOne({
    user: userId,
    session: sessionId,
    phone,
    status: "active",
  });
  if (!agent) {
    return { handled: false, parsed: null };
  }

  const parsed = parseRateFromText(text);
  if (parsed.found && parsed.confidence >= 0.82) {
    agent.lastDetectedRate = parsed.rate;
    agent.lastRateSourceText = text;
    agent.lastRateDetectedAt = new Date();
    await agent.save();
  }

  return { handled: true, parsed, agent };
}

export async function processAgentDocumentMessage({
  userId,
  sessionId,
  senderPhone,
  messageId = "",
  caption = "",
  storedPath,
  mimeType = "",
  originalFileName = "",
}) {
  const phone = normalizePhone(senderPhone);
  const agent = await SignAgent.findOne({
    user: userId,
    session: sessionId,
    phone,
    status: "active",
  });
  if (!agent) {
    return { handled: false };
  }

  const rateParsed = parseRateFromText(`${caption}\n${originalFileName}`);
  if (rateParsed.found && rateParsed.confidence >= 0.82) {
    agent.lastDetectedRate = rateParsed.rate;
    agent.lastRateSourceText = `${caption}\n${originalFileName}`.trim();
    agent.lastRateDetectedAt = new Date();
    await agent.save();
  }

  const document = await SignDocument.create({
    user: userId,
    session: sessionId,
    agent: agent._id,
    sourceMessageId: messageId,
    originalFileName,
    storedPath,
    mimeType,
    caption,
    rateDetected: rateParsed.found ? rateParsed.rate : null,
    rateConfidence: rateParsed.confidence || 0,
  });

  const isPdf =
    String(mimeType).toLowerCase().includes("pdf") ||
    String(originalFileName).toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    document.status = "MANUAL_REVIEW";
    document.reviewReason = "PDF file পাওয়া যায়নি";
    await document.save();
    return { handled: true, document, matchedOrders: [] };
  }

  const extraction = await extractPdfText(storedPath);
  document.extractedText = normalizeDigits(extraction.text || "");
  document.extractionMethod = extraction.method || "NONE";
  if (!document.extractedText) {
    document.status = "MANUAL_REVIEW";
    document.reviewReason = extraction.error || "PDF text extract করা যায়নি";
    await document.save();
    return { handled: true, document, matchedOrders: [] };
  }
  await document.save();

  const pendingOrders = await SignOrder.find({
    user: userId,
    session: sessionId,
    agent: agent._id,
    status: { $in: ["PENDING", "FUNDS_HOLD"] },
  })
    .sort({ createdAt: 1 })
    .populate("customer");

  const matchedOrders = [];
  for (const order of pendingOrders) {
    if (!document.extractedText.includes(String(order.requestedDigit))) continue;

    const liveOrder = await SignOrder.findById(order._id);
    const customer = await SignCustomer.findById(order.customer._id);
    if (!liveOrder || !customer) continue;

    liveOrder.status = "MATCHED";
    liveOrder.reviewReason = "";
    liveOrder.matchedDocument = document._id;
    await liveOrder.save();

    const effectiveRate =
      rateParsed.found && rateParsed.confidence >= 0.58
        ? rateParsed.rate
        : agent.lastDetectedRate;

    const finalOrder = await finalizeDelivery({
      userId,
      sessionId,
      order: liveOrder,
      customer,
      agent,
      document,
      agentRate: effectiveRate,
    });
    matchedOrders.push(finalOrder._id);
  }

  if (!matchedOrders.length) {
    document.status = "MANUAL_REVIEW";
    document.reviewReason = "কোনো pending order-এর digit PDF-এ পাওয়া যায়নি";
  } else {
    document.status = "MATCHED";
    document.reviewReason = "";
    document.matchedOrders = matchedOrders;
  }
  await document.save();

  return { handled: true, document, matchedOrders };
}

export async function retryOrderDelivery({ userId, orderId, overrideAgentRate }) {
  const order = await SignOrder.findOne({ _id: orderId, user: userId }).populate(
    "customer agent matchedDocument",
  );
  if (!order) {
    throw new Error("Order not found");
  }
  if (order.status === "DELIVERED" || order.deliveredAt || order.deliveryMessageId) {
    throw new Error("Delivered order retry করা যাবে না");
  }
  if (!order.matchedDocument) {
    throw new Error("Matched document পাওয়া যায়নি");
  }
  if (!order.agent) {
    throw new Error("Assigned agent পাওয়া যায়নি");
  }

  return finalizeDelivery({
    userId,
    sessionId: order.session.toString(),
    order,
    customer: order.customer,
    agent: order.agent,
    document: order.matchedDocument,
    agentRate:
      overrideAgentRate !== undefined && overrideAgentRate !== null
        ? Number(overrideAgentRate)
        : order.detectedAgentRate ?? order.agent?.lastDetectedRate,
  });
}

export async function applyCustomerTransaction({
  userId,
  sessionId,
  customer,
  amount,
  transactionType,
  note = "",
}) {
  const safeAmount = Number(amount);
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    throw new Error("Invalid amount");
  }

  if (transactionType === "PREPAID_TOPUP") {
    customer.balance = Number(customer.balance || 0) + safeAmount;
  } else if (transactionType === "TRUSTED_PAYMENT") {
    customer.dueAmount = Math.max(0, Number(customer.dueAmount || 0) - safeAmount);
    customer.totalPaid = Number(customer.totalPaid || 0) + safeAmount;
  } else {
    throw new Error("Unsupported transaction type");
  }

  await customer.save();
  await addLedgerEntry({
    user: userId,
    session: sessionId,
    customer: customer._id,
    entryType: transactionType,
    amount: safeAmount,
    note,
    meta: {
      customerType: customer.customerType,
    },
  });

  return customer;
}
