import AgentAudit from "../models/agentAuditModel.js";
import AgentCustomerProfile from "../models/agentCustomerProfileModel.js";
import AgentService from "../models/agentServiceModel.js";
import DynamicOrder from "../models/dynamicOrderModel.js";
import Message from "../models/messageModel.js";
import SignAgent from "../models/signAgentModel.js";
import SignCustomer from "../models/signCustomerModel.js";
import SignLedger from "../models/signLedgerModel.js";
import SignOrder from "../models/signOrderModel.js";
import {
  assessDynamicOrderMatch,
  normalizeDigits,
  normalizePhone,
  parseOrderDetails,
} from "../lib/dynamicOrderDelivery.js";
import { queryBkashPayment } from "../lib/bkashService.js";

const DEFAULT_SERVICES = [
  {
    code: "DHAKA_NEW_BIRTH",
    name: "Dhaka City New Birth Registration",
    requirements: ["জন্মসাল অনুযায়ী পরিচয়পত্র", "পিতা-মাতার NID", "প্রযোজ্য হলে টিকা কার্ড ও পিতা-মাতার অনলাইন জন্ম সনদ"],
    deliveryTime: "১ দিন",
    keywords: ["dhaka", "ঢাকা", "new birth", "নতুন জন্ম", "জন্ম নিবন্ধন"],
  },
  {
    code: "DHAKA_BIRTH_CORRECTION",
    name: "Dhaka City Birth Registration Correction",
    requirements: ["বর্তমান ১৭ ডিজিটের জন্ম সনদ", "সংশোধনের প্রমাণপত্র", "সিটি জোনের তথ্য"],
    deliveryTime: "২-৪ কার্যদিবস",
    keywords: ["dhaka correction", "ঢাকা সংশোধন", "জন্ম সংশোধন"],
  },
  {
    code: "CTG_NEW_BIRTH",
    name: "Chattogram City New Birth Registration",
    requirements: ["টিকা কার্ড", "পিতা-মাতার NID", "বিদ্যুৎ বিল"],
    deliveryTime: "প্রতি মঙ্গলবারের লট",
    keywords: ["ctg", "chattogram", "চট্টগ্রাম", "চট্টগ্রাম নতুন জন্ম"],
  },
  {
    code: "CTG_BIRTH_CORRECTION",
    name: "Chattogram City Birth Registration Correction",
    requirements: ["বর্তমান ১৭ ডিজিটের জন্ম সনদ", "সংশোধনের প্রমাণপত্র", "সিটি জোন"],
    deliveryTime: "২-৫ কার্যদিবস",
    keywords: ["ctg correction", "chattogram correction", "চট্টগ্রাম সংশোধন"],
  },
  {
    code: "ETIN",
    name: "e-TIN & Tax Return",
    requirements: ["NID", "সচল মোবাইল নম্বর"],
    deliveryTime: "১৫-৩০ মিনিট",
    keywords: ["etin", "e-tin", "tin", "টিন", "tax", "রিটার্ন"],
  },
  {
    code: "NID",
    name: "NID & Voter Service",
    requirements: ["আবেদনের তথ্য", "প্রয়োজনীয় পরিচয় ও প্রমাণপত্র"],
    deliveryTime: "৩-৭ কার্যদিবস",
    keywords: ["nid", "ভোটার"],
  },
  {
    code: "TRADE_LICENSE",
    name: "Trade License & Business Registration",
    requirements: ["NID", "ছবি", "দোকান ভাড়ার চুক্তিপত্র", "বিদ্যুৎ বিল"],
    deliveryTime: "১-২ কার্যদিবস",
    keywords: ["trade", "ট্রেড", "লাইসেন্স", "business"],
  },
];

function tenant(req) {
  return { user: req.user._id, session: req.session._id };
}

function safeText(value, max = 12000) {
  return String(value || "").trim().slice(0, max);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function recordAudit(req, values) {
  const base = { ...tenant(req), ...values };
  if (base.messageId) {
    return AgentAudit.findOneAndUpdate(
      { ...tenant(req), messageId: base.messageId, eventType: base.eventType },
      { $set: base },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
  }
  return AgentAudit.create(base);
}

async function ensureDefaultServices(req) {
  const owner = tenant(req);
  await Promise.all(
    DEFAULT_SERVICES.map((service) =>
      AgentService.updateOne(
        { ...owner, code: service.code },
        { $setOnInsert: { ...owner, ...service, priceText: "যোগাযোগ করে নিশ্চিত করুন", active: true } },
        { upsert: true },
      ),
    ),
  );
  return AgentService.find({ ...owner, active: true }).sort({ code: 1 }).lean();
}

function pickService(services, text) {
  const value = safeText(text, 4000).toLowerCase();
  if (!value) return null;
  let best = null;
  let bestScore = 0;
  for (const service of services) {
    const score = (service.keywords || []).filter((keyword) => value.includes(String(keyword).toLowerCase())).length;
    if (score > bestScore) {
      best = service;
      bestScore = score;
    }
  }
  return best;
}

function getMissingInformation(text, service) {
  const source = safeText(text);
  const parsed = parseOrderDetails(source) || {};
  const present = [
    parsed.applicationId && !String(parsed.applicationId).startsWith("FORM-") && "applicationId",
    (parsed.name || parsed.englishName) && "name",
    parsed.dob && "dob",
    parsed.fatherName && "fatherName",
    parsed.motherName && "motherName",
    parsed.address && "address",
    parsed.birthRegistrationNumber && "birthRegistrationNumber",
  ].filter(Boolean);
  const missingForSafeMatch = [];
  if (present.length < 2) {
    if (!present.includes("name")) missingForSafeMatch.push("name");
    if (!present.includes("dob")) missingForSafeMatch.push("dob");
    if (2 - present.length > missingForSafeMatch.length) missingForSafeMatch.push("fatherName বা motherName");
  }
  return {
    extracted: parsed,
    presentFields: present,
    safeMatchReady: present.length >= 2,
    missingForSafeMatch,
    serviceRequirements: service?.requirements || [],
  };
}

function serializeDynamicOrder(order) {
  return {
    id: String(order._id),
    applicationId: order.applicationId,
    name: order.name || order.englishName,
    dob: order.dob,
    status: order.status,
    matchedFields: order.matchedFields || [],
    reviewReason: order.reviewReason || "",
    sellerPhone: order.sellerPhone || "",
    matchedFile: order.matchedFile || "",
    createdAt: order.createdAt,
    deliveredAt: order.deliveredAt,
  };
}

export async function getAgentContext(req, res) {
  try {
    const phone = normalizePhone(req.body.phone || req.body.customerPhone || req.body.customer_id);
    if (!phone) return res.status(400).json({ success: false, error: "phone is required" });
    const owner = tenant(req);
    const text = safeText(req.body.message || req.body.text || req.body.evidenceText);
    const [services, dynamicOrders, customer, seller, profile, messages] = await Promise.all([
      ensureDefaultServices(req),
      DynamicOrder.find({ ...owner, customerPhone: phone }).sort({ createdAt: -1 }).limit(25).lean(),
      SignCustomer.findOne({ ...owner, phone }).populate("assignedAgent", "name phone").lean(),
      SignAgent.findOne({ ...owner, phone }).lean(),
      AgentCustomerProfile.findOne({ ...owner, phone }).lean(),
      Message.find({ ...owner, fromNumber: phone }).sort({ createdAt: -1 }).limit(20).lean(),
    ]);
    const signOrders = customer
      ? await SignOrder.find({ ...owner, customer: customer._id })
          .sort({ createdAt: -1 })
          .limit(25)
          .populate("matchedDocument", "originalFileName extractionMethod status")
          .lean()
      : [];
    const service = pickService(services, text);
    const missingInformation = getMissingInformation(text, service);
    const context = {
      phone,
      role: seller ? "seller" : customer || dynamicOrders.length ? "customer" : "unknown",
      customer: customer
        ? {
            name: customer.name,
            type: customer.customerType,
            status: customer.status,
            balance: customer.balance,
            dueAmount: customer.dueAmount,
            totalDelivered: customer.totalDelivered,
            assignedAgent: customer.assignedAgent || null,
          }
        : null,
      seller: seller ? { name: seller.name, status: seller.status, phone: seller.phone } : null,
      profile: profile
        ? {
            lastIntent: profile.lastIntent,
            sentiment: profile.sentiment,
            lifecycleStage: profile.lifecycleStage,
            serviceCode: profile.serviceCode,
            entities: profile.entities,
            messageCount: profile.messageCount,
            lastMessageAt: profile.lastMessageAt,
          }
        : null,
      selectedService: service,
      missingInformation,
      orderSummary: {
        total: dynamicOrders.length + signOrders.length,
        pending: [...dynamicOrders, ...signOrders].filter((order) => order.status === "PENDING").length,
        delivered: [...dynamicOrders, ...signOrders].filter((order) => order.status === "DELIVERED").length,
        review: [...dynamicOrders, ...signOrders].filter((order) => ["MANUAL_REVIEW", "FUNDS_HOLD", "FAILED"].includes(order.status)).length,
      },
      dynamicOrders: dynamicOrders.map(serializeDynamicOrder),
      managedOrders: signOrders.map((order) => ({
        id: String(order._id),
        requestedDigit: order.requestedDigit,
        status: order.status,
        reviewReason: order.reviewReason || "",
        file: order.matchedDocument?.originalFileName || "",
        createdAt: order.createdAt,
        deliveredAt: order.deliveredAt,
      })),
      recentMessages: messages.reverse().map((message) => ({
        direction: message.direction,
        type: message.msgType,
        text: safeText(message.body, 600),
        mediaUrl: message.mediaUrl || null,
        at: message.createdAt,
      })),
    };
    await recordAudit(req, {
      eventType: "CONTEXT_LOOKUP",
      customerPhone: phone,
      messageId: safeText(req.body.messageId || req.body.message_id, 200),
      outcome: "FOUND",
      confidence: customer || dynamicOrders.length ? 1 : 0.5,
      needsReview: false,
      details: { role: context.role, orderSummary: context.orderSummary, selectedService: service?.code || "" },
    });
    res.json({ success: true, context });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function analyzeAgentRequest(req, res) {
  try {
    const phone = normalizePhone(req.body.phone || req.body.customerPhone || req.body.customer_id);
    if (!phone) return res.status(400).json({ success: false, error: "phone is required" });
    const owner = tenant(req);
    const text = safeText(req.body.message || req.body.text || req.body.evidenceText);
    const messageId = safeText(req.body.messageId || req.body.message_id, 200);
    const [services, dynamicOrders, customer, seller, profile, messages] = await Promise.all([
      ensureDefaultServices(req),
      DynamicOrder.find({ ...owner, customerPhone: phone }).sort({ createdAt: -1 }).limit(25).lean(),
      SignCustomer.findOne({ ...owner, phone }).populate("assignedAgent", "name phone").lean(),
      SignAgent.findOne({ ...owner, phone }).lean(),
      AgentCustomerProfile.findOne({ ...owner, phone }).lean(),
      Message.find({ ...owner, fromNumber: phone }).sort({ createdAt: -1 }).limit(20).lean(),
    ]);
    const signOrders = customer
      ? await SignOrder.find({ ...owner, customer: customer._id })
          .sort({ createdAt: -1 })
          .limit(25)
          .populate("matchedDocument", "originalFileName extractionMethod status")
          .lean()
      : [];
    const selectedService = pickService(services, text);
    const missingInformation = getMissingInformation(text, selectedService);
    const allOrders = [...dynamicOrders, ...signOrders];
    const role = seller ? "seller" : customer || dynamicOrders.length ? "customer" : "unknown";

    const hasDocumentEvidence = Boolean(
      req.body.hasMedia ||
      req.body.ocrText ||
      /\[(?:OCR extracted text|voice transcription)\]/iu.test(text),
    );
    let documentAssessment = null;
    if (hasDocumentEvidence && missingInformation.safeMatchReady) {
      const assessment = await assessDynamicOrderMatch({
        userId: req.user._id,
        sessionId: req.session._id,
        evidenceText: text,
      });
      documentAssessment = {
        decision: assessment.decision,
        autoDeliver: assessment.autoDeliver,
        needsReview: assessment.needsReview,
        confidence: assessment.confidence,
        reason: assessment.reason,
        matchedFields: assessment.match?.matchedFields || [],
        order: assessment.match?.order ? serializeDynamicOrder(assessment.match.order) : null,
        alternatives: (assessment.alternatives || []).slice(0, 5).map((entry) => ({
          order: serializeDynamicOrder(entry.order),
          matchedFields: entry.matchedFields,
          confidence: entry.confidence,
        })),
      };
    }

    let payment = null;
    const isPaymentMessage = /(?:trx\s*id|trxid|transaction|payment|paid|bkash|bKash|nagad|বিকাশ|নগদ|পেমেন্ট|টাকা পাঠ)/iu.test(text);
    const paymentReference = (normalizeDigits(text).match(/[A-Za-z0-9][A-Za-z0-9_-]{7,63}/) || [""])[0];
    if (isPaymentMessage && paymentReference) {
      const exact = new RegExp(`(^|[^A-Za-z0-9])${escapeRegex(paymentReference)}([^A-Za-z0-9]|$)`, "i");
      const ledger = await SignLedger.findOne({
        ...owner,
        $or: [
          { "meta.trxId": paymentReference },
          { "meta.trxID": paymentReference },
          { "meta.paymentID": paymentReference },
          { note: exact },
        ],
      }).sort({ createdAt: -1 }).lean();
      let gateway = null;
      let gatewayError = "";
      if (!ledger && /payment\s*id/iu.test(text)) {
        try {
          gateway = await queryBkashPayment({ paymentID: paymentReference });
        } catch (error) {
          gatewayError = error.message;
        }
      }
      const gatewayStatus = String(gateway?.transactionStatus || gateway?.statusMessage || "").toLowerCase();
      const gatewayVerified = ["completed", "success", "successful"].some((value) => gatewayStatus.includes(value));
      payment = {
        verified: Boolean(ledger || gatewayVerified),
        status: ledger || gatewayVerified ? "VERIFIED" : gatewayError ? "VERIFICATION_UNAVAILABLE" : "NOT_FOUND",
        source: ledger ? "internal_ledger" : gatewayVerified ? "bkash_gateway" : "none",
        amount: ledger?.amount ?? gateway?.amount ?? null,
        transactionStatus: ledger ? "RECORDED" : gateway?.transactionStatus || null,
        checkedReference: `***${paymentReference.slice(-4)}`,
      };
    }

    const analysis = {
      phone,
      role,
      customer: customer
        ? {
            name: customer.name,
            type: customer.customerType,
            status: customer.status,
            balance: customer.balance,
            dueAmount: customer.dueAmount,
            totalDelivered: customer.totalDelivered,
            assignedAgent: customer.assignedAgent || null,
          }
        : null,
      seller: seller ? { name: seller.name, status: seller.status, phone: seller.phone } : null,
      profile: profile
        ? {
            lastIntent: profile.lastIntent,
            sentiment: profile.sentiment,
            lifecycleStage: profile.lifecycleStage,
            serviceCode: profile.serviceCode,
            entities: profile.entities,
            messageCount: profile.messageCount,
            lastMessageAt: profile.lastMessageAt,
          }
        : null,
      selectedService,
      missingInformation,
      orderSummary: {
        total: allOrders.length,
        pending: allOrders.filter((order) => order.status === "PENDING").length,
        delivered: allOrders.filter((order) => order.status === "DELIVERED").length,
        review: allOrders.filter((order) => ["MANUAL_REVIEW", "FUNDS_HOLD", "FAILED"].includes(order.status)).length,
      },
      orders: [
        ...dynamicOrders.map(serializeDynamicOrder),
        ...signOrders.map((order) => ({
          id: String(order._id),
          requestedDigit: order.requestedDigit,
          status: order.status,
          reviewReason: order.reviewReason || "",
          file: order.matchedDocument?.originalFileName || "",
          createdAt: order.createdAt,
          deliveredAt: order.deliveredAt,
        })),
      ].slice(0, 30),
      recentMessages: messages.reverse().map((message) => ({
        direction: message.direction,
        type: message.msgType,
        text: safeText(message.body, 600),
        mediaUrl: message.mediaUrl || null,
        at: message.createdAt,
      })),
      documentAssessment,
      payment,
      humanReviewRequired: Boolean(documentAssessment?.needsReview || (payment && !payment.verified)),
    };

    await recordAudit(req, {
      eventType: documentAssessment ? "DOCUMENT_MATCH" : payment ? "PAYMENT_CHECK" : "CONTEXT_LOOKUP",
      customerPhone: phone,
      messageId,
      outcome: documentAssessment?.decision || payment?.status || "ANALYZED",
      confidence: documentAssessment?.confidence ?? (payment?.verified ? 1 : 0.5),
      needsReview: analysis.humanReviewRequired,
      details: {
        role,
        serviceCode: selectedService?.code || "",
        orderSummary: analysis.orderSummary,
        matchedFields: documentAssessment?.matchedFields || [],
      },
    });
    res.json({ success: true, analysis });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function matchAgentDocument(req, res) {
  try {
    const evidenceText = safeText(req.body.evidenceText || req.body.ocrText || req.body.text);
    if (!evidenceText) return res.status(400).json({ success: false, error: "evidenceText is required" });
    const assessment = await assessDynamicOrderMatch({ ...tenant(req), userId: req.user._id, sessionId: req.session._id, evidenceText });
    const bestOrder = assessment.match?.order;
    const result = {
      decision: assessment.decision,
      autoDeliver: assessment.autoDeliver,
      needsReview: assessment.needsReview,
      confidence: assessment.confidence,
      reason: assessment.reason,
      matchedFields: assessment.match?.matchedFields || [],
      order: bestOrder ? serializeDynamicOrder(bestOrder) : null,
      alternatives: (assessment.alternatives || []).map((entry) => ({
        order: serializeDynamicOrder(entry.order),
        matchedFields: entry.matchedFields,
        confidence: entry.confidence,
      })),
      missingInformation: getMissingInformation(evidenceText, null),
    };
    await recordAudit(req, {
      eventType: "DOCUMENT_MATCH",
      customerPhone: normalizePhone(bestOrder?.customerPhone || req.body.phone),
      messageId: safeText(req.body.messageId || req.body.message_id, 200),
      outcome: result.decision,
      confidence: result.confidence,
      needsReview: result.needsReview,
      details: { matchedFields: result.matchedFields, orderId: result.order?.id || "", reason: result.reason },
    });
    res.json({ success: true, match: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function getAgentServices(req, res) {
  try {
    const services = await ensureDefaultServices(req);
    const selected = pickService(services, req.query.q || req.body?.q || "");
    res.json({ success: true, selected, services });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function updateAgentService(req, res) {
  try {
    const code = safeText(req.params.code, 80).toUpperCase();
    const allowed = ["name", "requirements", "deliveryTime", "priceText", "keywords", "active"];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
    const service = await AgentService.findOneAndUpdate(
      { ...tenant(req), code },
      { $set: updates },
      { new: true, runValidators: true },
    );
    if (!service) return res.status(404).json({ success: false, error: "Service not found" });
    res.json({ success: true, service });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function verifyAgentPayment(req, res) {
  try {
    const rawReference = safeText(req.body.trxId || req.body.trxID || req.body.paymentId || req.body.reference, 2000);
    const normalizedReference = normalizeDigits(rawReference);
    const reference = (normalizedReference.match(/[A-Za-z0-9][A-Za-z0-9_-]{7,63}/) || [""])[0];
    if (reference.length < 8 || reference.length > 64) {
      return res.status(400).json({ success: false, verified: false, error: "A valid TrxID or paymentID is required" });
    }
    const owner = tenant(req);
    const exact = new RegExp(`(^|[^A-Za-z0-9])${escapeRegex(reference)}([^A-Za-z0-9]|$)`, "i");
    const ledger = await SignLedger.findOne({
      ...owner,
      $or: [
        { "meta.trxId": reference },
        { "meta.trxID": reference },
        { "meta.paymentID": reference },
        { note: exact },
      ],
    }).sort({ createdAt: -1 }).lean();

    let gateway = null;
    let gatewayError = "";
    if (!ledger && req.body.paymentId) {
      try {
        gateway = await queryBkashPayment({ paymentID: reference });
      } catch (error) {
        gatewayError = error.message;
      }
    }
    const gatewayStatus = String(gateway?.transactionStatus || gateway?.statusMessage || "").toLowerCase();
    const gatewayVerified = ["completed", "success", "successful"].some((value) => gatewayStatus.includes(value));
    const verified = Boolean(ledger || gatewayVerified);
    const result = {
      verified,
      status: verified ? "VERIFIED" : gatewayError ? "VERIFICATION_UNAVAILABLE" : "NOT_FOUND",
      source: ledger ? "internal_ledger" : gatewayVerified ? "bkash_gateway" : "none",
      amount: ledger?.amount ?? gateway?.amount ?? null,
      transactionStatus: ledger ? "RECORDED" : gateway?.transactionStatus || null,
      checkedReference: `***${reference.slice(-4)}`,
      gatewayError: gatewayError ? "Payment gateway could not verify this reference" : "",
    };
    await recordAudit(req, {
      eventType: "PAYMENT_CHECK",
      customerPhone: normalizePhone(req.body.phone),
      messageId: safeText(req.body.messageId || req.body.message_id, 200),
      outcome: result.status,
      confidence: verified ? 1 : 0,
      needsReview: !verified,
      details: { source: result.source, checkedReference: result.checkedReference },
    });
    res.json({ success: true, payment: result });
  } catch (error) {
    res.status(500).json({ success: false, verified: false, error: error.message });
  }
}

export async function saveAgentAudit(req, res) {
  try {
    const eventType = safeText(req.body.eventType || "AGENT_RESPONSE", 80);
    const allowed = AgentAudit.schema.path("eventType").enumValues;
    const normalizedType = allowed.includes(eventType) ? eventType : "AGENT_RESPONSE";
    const audit = await recordAudit(req, {
      eventType: normalizedType,
      customerPhone: normalizePhone(req.body.customerPhone || req.body.phone),
      messageId: safeText(req.body.messageId || req.body.message_id, 200),
      outcome: safeText(req.body.outcome, 120),
      confidence: Math.max(0, Math.min(1, Number(req.body.confidence || 0))),
      needsReview: Boolean(req.body.needsReview),
      details: req.body.details && typeof req.body.details === "object" ? req.body.details : {},
      error: safeText(req.body.error, 1000),
    });
    const profilePhone = normalizePhone(req.body.customerPhone || req.body.phone);
    if (profilePhone && normalizedType === "AGENT_RESPONSE") {
      const details = req.body.details && typeof req.body.details === "object" ? req.body.details : {};
      await AgentCustomerProfile.findOneAndUpdate(
        { ...tenant(req), phone: profilePhone },
        {
          $set: {
            role: ["customer", "seller"].includes(details.role) ? details.role : "unknown",
            lastIntent: safeText(details.intent, 100),
            sentiment: safeText(details.sentiment || "neutral", 40),
            lifecycleStage: safeText(details.lifecycleStage, 100),
            serviceCode: safeText(details.serviceCode, 100),
            entities: details.entities && typeof details.entities === "object" ? details.entities : {},
            lastMessageAt: new Date(),
          },
          $inc: { messageCount: 1 },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }
    const response = req.body.response && typeof req.body.response === "object" ? req.body.response : {};
    res.json({ ...response, audit_saved: true, audit_id: String(audit._id) });
  } catch (error) {
    const response = req.body.response && typeof req.body.response === "object" ? req.body.response : {};
    res.status(200).json({ ...response, audit_saved: false, audit_error: error.message });
  }
}

export async function getAgentReviewQueue(req, res) {
  try {
    const events = await AgentAudit.find({ ...tenant(req), needsReview: true })
      .sort({ createdAt: -1 })
      .limit(Math.min(200, Math.max(1, Number(req.query.limit || 50))))
      .lean();
    res.json({ success: true, count: events.length, events });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}
