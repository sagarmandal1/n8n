import mongoose from "mongoose";
import sessionModel from "../models/sessionModel.js";
import SignCustomer from "../models/signCustomerModel.js";
import SignAgent from "../models/signAgentModel.js";
import SignOrder from "../models/signOrderModel.js";
import SignDocument from "../models/signDocumentModel.js";
import SignLedger from "../models/signLedgerModel.js";
import SignCustomerRequest from "../models/signCustomerRequestModel.js";
import {
  applyCustomerTransaction,
  normalizePhone,
  retryOrderDelivery,
} from "../lib/signcopy/workflow.js";
import { sendMessage } from "../lib/whatsapp.js";

async function ensureOwnedSession(userId, sessionId) {
  const session = await sessionModel.findOne({ _id: sessionId, user: userId });
  if (!session) {
    throw new Error("Session not found");
  }
  return session;
}

function readSessionId(req) {
  return req.query.sessionId || req.body.sessionId;
}

async function ensureOwnedAgent(userId, sessionId, agentId) {
  if (!agentId) return null;
  const agent = await SignAgent.findOne({
    _id: agentId,
    user: userId,
    session: sessionId,
  });
  if (!agent) {
    throw new Error("Assigned agent not found in this session");
  }
  return agent;
}

export async function getSignCopyOverview(req, res) {
  try {
    const userId = req.user._id.toString();
    const sessionId = readSessionId(req);
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
    await ensureOwnedSession(userId, sessionId);

    const [customers, agents, orders, reviewDocs, pendingRequests, ledger] = await Promise.all([
      SignCustomer.countDocuments({ user: userId, session: sessionId, status: "active" }),
      SignAgent.countDocuments({ user: userId, session: sessionId, status: "active" }),
      SignOrder.find({ user: userId, session: sessionId }).lean(),
      SignDocument.countDocuments({ user: userId, session: sessionId, status: "MANUAL_REVIEW" }),
      SignCustomerRequest.countDocuments({ user: userId, session: sessionId, status: "pending" }),
      SignLedger.find({ user: userId, session: sessionId }).sort({ createdAt: -1 }).limit(30),
    ]);

    const orderStats = {
      total: orders.length,
      pending: orders.filter((o) => o.status === "PENDING").length,
      delivered: orders.filter((o) => o.status === "DELIVERED").length,
      hold: orders.filter((o) => o.status === "FUNDS_HOLD").length,
      review: orders.filter((o) => o.status === "MANUAL_REVIEW").length,
    };

    const finance = orders.reduce(
      (acc, order) => {
        acc.customerBill += Number(order.customerSellRate || 0);
        acc.agentPayable += Number(order.detectedAgentRate || 0);
        acc.profit += Number(order.adminProfit || 0);
        return acc;
      },
      { customerBill: 0, agentPayable: 0, profit: 0 },
    );

    res.json({
      success: true,
      overview: {
        customers,
        agents,
        reviewDocs,
        pendingRequests,
        orderStats,
        finance,
        recentLedger: ledger,
      },
    });
  } catch (err) {
    res.status(err.message === "Session not found" ? 404 : 500).json({ error: err.message });
  }
}

export async function getSignCopySettings(req, res) {
  try {
    const userId = req.user._id.toString();
    const { sessionId } = req.query;
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
    const session = await ensureOwnedSession(userId, sessionId);

    const s = session.signCopySettings || {};
    res.json({
      success: true,
      settings: {
        notifyEnabled: s.notifyEnabled !== false,
        notifyTargets: s.notifyTargets || [],
        rateLimitMinutes: Number(s.rateLimitMinutes ?? 10),
        blocklist: s.blocklist || [],
      },
    });
  } catch (err) {
    res.status(err.message === "Session not found" ? 404 : 500).json({ error: err.message });
  }
}

export async function updateSignCopySettings(req, res) {
  try {
    const userId = req.user._id.toString();
    const { sessionId, notifyEnabled, notifyTargets, rateLimitMinutes, blocklist } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
    const session = await ensureOwnedSession(userId, sessionId);

    const normalizedTargets = Array.from(
      new Set(
        (Array.isArray(notifyTargets) ? notifyTargets : [])
          .map((v) => normalizePhone(v))
          .filter(Boolean),
      ),
    );
    const normalizedBlocklist = Array.from(
      new Set(
        (Array.isArray(blocklist) ? blocklist : [])
          .map((v) => normalizePhone(v))
          .filter(Boolean),
      ),
    );

    session.signCopySettings = {
      notifyEnabled: notifyEnabled !== false,
      notifyTargets: normalizedTargets,
      rateLimitMinutes: Math.max(0, Number(rateLimitMinutes ?? 10)),
      blocklist: normalizedBlocklist,
    };
    await session.save();

    res.json({ success: true, settings: session.signCopySettings });
  } catch (err) {
    res.status(err.message === "Session not found" ? 404 : 500).json({ error: err.message });
  }
}

export async function getSignCustomerRequests(req, res) {
  try {
    const userId = req.user._id.toString();
    const { sessionId, status = "pending" } = req.query;
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
    await ensureOwnedSession(userId, sessionId);

    const filter = { user: userId, session: sessionId };
    if (status) filter.status = status;

    const requests = await SignCustomerRequest.find(filter).sort({ lastSeenAt: -1 }).limit(200);
    res.json({ success: true, requests });
  } catch (err) {
    res.status(err.message === "Session not found" ? 404 : 500).json({ error: err.message });
  }
}

export async function approveSignCustomerRequest(req, res) {
  try {
    const userId = req.user._id.toString();
    const { id } = req.params;
    const {
      name,
      customerType = "prepaid",
      assignedAgent,
      sellRate,
      balance = 0,
      creditLimit = 0,
      notes = "",
    } = req.body;

    const request = await SignCustomerRequest.findOne({ _id: id, user: userId });
    if (!request) return res.status(404).json({ error: "Request not found" });
    await ensureOwnedSession(userId, request.session.toString());
    await ensureOwnedAgent(userId, request.session.toString(), assignedAgent);

    if (request.status !== "pending") {
      return res.status(400).json({ error: "Request is not pending" });
    }

    const customer = await SignCustomer.create({
      user: userId,
      session: request.session,
      name: String(name || request.senderName || "Customer").trim(),
      phone: normalizePhone(request.phone),
      customerType,
      status: "active",
      assignedAgent: assignedAgent || null,
      sellRate: Number(sellRate || 0),
      balance: Number(balance || 0),
      creditLimit: Number(creditLimit || 0),
      notes: String(notes || ""),
    });

    const digits = Array.isArray(request.requestedDigits) ? request.requestedDigits : [];
    const createdOrders = [];
    for (const digit of digits) {
      const exists = await SignOrder.findOne({
        user: userId,
        session: request.session,
        customer: customer._id,
        requestedDigit: digit,
        status: { $in: ["PENDING", "MATCHED", "FUNDS_HOLD", "MANUAL_REVIEW"] },
      });
      if (exists) continue;
      const order = await SignOrder.create({
        user: userId,
        session: request.session,
        customer: customer._id,
        agent: customer.assignedAgent || null,
        sourceMessageId: request.lastMessageId || "",
        requestedDigit: digit,
        customerMessage: request.lastMessage || "",
        status: customer.assignedAgent ? "PENDING" : "MANUAL_REVIEW",
        reviewReason: customer.assignedAgent
          ? ""
          : "এই customer-এর জন্য assigned agent set করা নেই",
      });
      createdOrders.push(order._id);
    }

    request.status = "approved";
    request.approvedAt = new Date();
    await request.save();

    try {
      const session = await sessionModel
        .findOne({ _id: request.session, user: userId })
        .select("forwardingEnabled");
      if (!session?.forwardingEnabled) {
        return res.json({ success: true, customer, createdOrders });
      }
      const hasAgent = !!customer.assignedAgent;
      const approvedText = hasAgent
        ? "আপনার অনুরোধ approve করা হয়েছে। কাজ প্রসেস করা হচ্ছে।"
        : "আপনার অনুরোধ approve করা হয়েছে। Agent assign না থাকায় কাজ pending থাকতে পারে।";
      await sendMessage(userId, request.session.toString(), customer.phone, {
        text: `${approvedText}\nDigits: ${(digits || []).slice(0, 6).join(", ") || "-"}`,
      });
    } catch (_) {}

    res.json({ success: true, customer, createdOrders });
  } catch (err) {
    const status =
      err.message === "Session not found" || err.message.includes("Assigned agent not found")
        ? 400
        : 500;
    res.status(status).json({ error: err.message });
  }
}

export async function rejectSignCustomerRequest(req, res) {
  try {
    const userId = req.user._id.toString();
    const { id } = req.params;
    const request = await SignCustomerRequest.findOne({ _id: id, user: userId });
    if (!request) return res.status(404).json({ error: "Request not found" });
    await ensureOwnedSession(userId, request.session.toString());

    request.status = "rejected";
    request.rejectedAt = new Date();
    await request.save();
    res.json({ success: true, request });
  } catch (err) {
    res.status(err.message === "Session not found" ? 404 : 500).json({ error: err.message });
  }
}

export async function blockSignCustomerRequest(req, res) {
  try {
    const userId = req.user._id.toString();
    const { id } = req.params;
    const request = await SignCustomerRequest.findOne({ _id: id, user: userId });
    if (!request) return res.status(404).json({ error: "Request not found" });
    const session = await ensureOwnedSession(userId, request.session.toString());

    const phone = normalizePhone(request.phone);
    const s = session.signCopySettings || {};
    const current = Array.isArray(s.blocklist) ? s.blocklist : [];
    session.signCopySettings = {
      notifyEnabled: s.notifyEnabled !== false,
      notifyTargets: Array.isArray(s.notifyTargets) ? s.notifyTargets : [],
      rateLimitMinutes: Number(s.rateLimitMinutes ?? 10),
      blocklist: Array.from(new Set([...current, phone].map((v) => normalizePhone(v)).filter(Boolean))),
    };
    await session.save();

    request.status = "blocked";
    request.blockedAt = new Date();
    await request.save();

    res.json({ success: true, request, settings: session.signCopySettings });
  } catch (err) {
    res.status(err.message === "Session not found" ? 404 : 500).json({ error: err.message });
  }
}

export async function getSignCustomers(req, res) {
  try {
    const userId = req.user._id.toString();
    const { sessionId } = req.query;
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
    await ensureOwnedSession(userId, sessionId);

    const customers = await SignCustomer.find({ user: userId, session: sessionId })
      .sort({ createdAt: -1 })
      .populate("assignedAgent", "name phone");

    res.json({ success: true, customers });
  } catch (err) {
    res.status(err.message === "Session not found" ? 404 : 500).json({ error: err.message });
  }
}

export async function createSignCustomer(req, res) {
  try {
    const userId = req.user._id.toString();
    const {
      sessionId,
      name,
      phone,
      customerType = "prepaid",
      assignedAgent,
      sellRate,
      balance = 0,
      creditLimit = 0,
      notes = "",
    } = req.body;

    if (!sessionId || !name || !phone) {
      return res.status(400).json({ error: "sessionId, name and phone are required" });
    }
    await ensureOwnedSession(userId, sessionId);
    await ensureOwnedAgent(userId, sessionId, assignedAgent);

    const customer = await SignCustomer.create({
      user: userId,
      session: sessionId,
      name: String(name).trim(),
      phone: normalizePhone(phone),
      customerType,
      assignedAgent: assignedAgent || null,
      sellRate: Number(sellRate || 0),
      balance: Number(balance || 0),
      creditLimit: Number(creditLimit || 0),
      notes,
    });

    res.status(201).json({ success: true, customer });
  } catch (err) {
    const status = err.code === 11000 ? 409 : err.message === "Session not found" ? 404 : 500;
    res.status(status).json({ error: err.code === 11000 ? "Customer already exists for this phone" : err.message });
  }
}

export async function updateSignCustomer(req, res) {
  try {
    const userId = req.user._id.toString();
    const { id } = req.params;
    const updates = { ...req.body };
    if (updates.phone) updates.phone = normalizePhone(updates.phone);
    if (updates.sellRate !== undefined) updates.sellRate = Number(updates.sellRate || 0);
    if (updates.creditLimit !== undefined) updates.creditLimit = Number(updates.creditLimit || 0);
    if (updates.balance !== undefined) delete updates.balance;
    if (updates.dueAmount !== undefined) delete updates.dueAmount;

    const existingCustomer = await SignCustomer.findOne({ _id: id, user: userId });
    if (!existingCustomer) return res.status(404).json({ error: "Customer not found" });
    await ensureOwnedAgent(
      userId,
      existingCustomer.session.toString(),
      updates.assignedAgent,
    );

    const customer = await SignCustomer.findOneAndUpdate(
      { _id: id, user: userId },
      updates,
      { new: true },
    );
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    res.json({ success: true, customer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function signCustomerTransaction(req, res) {
  try {
    const userId = req.user._id.toString();
    const { id } = req.params;
    const { amount, type, note = "" } = req.body;
    const customer = await SignCustomer.findOne({ _id: id, user: userId });
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    const updated = await applyCustomerTransaction({
      userId,
      sessionId: customer.session.toString(),
      customer,
      amount,
      transactionType: type,
      note,
    });

    res.json({ success: true, customer: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getSignAgents(req, res) {
  try {
    const userId = req.user._id.toString();
    const { sessionId } = req.query;
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
    await ensureOwnedSession(userId, sessionId);

    const agents = await SignAgent.find({ user: userId, session: sessionId }).sort({
      createdAt: -1,
    });
    res.json({ success: true, agents });
  } catch (err) {
    res.status(err.message === "Session not found" ? 404 : 500).json({ error: err.message });
  }
}

export async function createSignAgent(req, res) {
  try {
    const userId = req.user._id.toString();
    const { sessionId, name, phone, notes = "" } = req.body;
    if (!sessionId || !name || !phone) {
      return res.status(400).json({ error: "sessionId, name and phone are required" });
    }
    await ensureOwnedSession(userId, sessionId);

    const agent = await SignAgent.create({
      user: userId,
      session: sessionId,
      name: String(name).trim(),
      phone: normalizePhone(phone),
      notes,
    });

    res.status(201).json({ success: true, agent });
  } catch (err) {
    const status = err.code === 11000 ? 409 : err.message === "Session not found" ? 404 : 500;
    res.status(status).json({ error: err.code === 11000 ? "Agent already exists for this phone" : err.message });
  }
}

export async function updateSignAgent(req, res) {
  try {
    const userId = req.user._id.toString();
    const { id } = req.params;
    const updates = { ...req.body };
    if (updates.phone) updates.phone = normalizePhone(updates.phone);

    const agent = await SignAgent.findOneAndUpdate(
      { _id: id, user: userId },
      updates,
      { new: true },
    );
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    res.json({ success: true, agent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getSignOrders(req, res) {
  try {
    const userId = req.user._id.toString();
    const { sessionId, status } = req.query;
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
    await ensureOwnedSession(userId, sessionId);

    const filter = { user: userId, session: sessionId };
    if (status) filter.status = status;

    const orders = await SignOrder.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate("customer", "name phone customerType sellRate balance dueAmount")
      .populate("agent", "name phone lastDetectedRate")
      .populate("matchedDocument", "originalFileName extractionMethod status");

    res.json({ success: true, orders });
  } catch (err) {
    res.status(err.message === "Session not found" ? 404 : 500).json({ error: err.message });
  }
}

export async function retrySignOrder(req, res) {
  try {
    const userId = req.user._id.toString();
    const { id } = req.params;
    const { overrideAgentRate } = req.body;
    const order = await retryOrderDelivery({
      userId,
      orderId: id,
      overrideAgentRate,
    });

    res.json({ success: true, order });
  } catch (err) {
    const knownErrors = new Set([
      "Order not found",
      "Matched document পাওয়া যায়নি",
      "Delivered order retry করা যাবে না",
      "Assigned agent পাওয়া যায়নি",
      "এই order আগে থেকেই delivered",
      "Prepaid balance যথেষ্ট নেই",
      "Trusted customer credit limit ছাড়িয়ে গেছে",
    ]);
    res.status(knownErrors.has(err.message) ? 400 : 500).json({ error: err.message });
  }
}

export async function getSignDocuments(req, res) {
  try {
    const userId = req.user._id.toString();
    const { sessionId, status } = req.query;
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
    await ensureOwnedSession(userId, sessionId);

    const filter = { user: userId, session: sessionId };
    if (status) filter.status = status;

    const documents = await SignDocument.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("agent", "name phone");

    res.json({ success: true, documents });
  } catch (err) {
    res.status(err.message === "Session not found" ? 404 : 500).json({ error: err.message });
  }
}

export async function getSignLedger(req, res) {
  try {
    const userId = req.user._id.toString();
    const { sessionId } = req.query;
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
    await ensureOwnedSession(userId, sessionId);

    const ledger = await SignLedger.find({ user: userId, session: sessionId })
      .sort({ createdAt: -1 })
      .limit(200)
      .populate("customer", "name phone")
      .populate("agent", "name phone")
      .populate("order", "requestedDigit status");

    res.json({ success: true, ledger });
  } catch (err) {
    res.status(err.message === "Session not found" ? 404 : 500).json({ error: err.message });
  }
}

export function validateObjectIdParam(req, res, next, id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid ID format" });
  }
  next();
}
