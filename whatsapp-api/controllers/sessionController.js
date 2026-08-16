import sessionModel from "../models/sessionModel.js";
import {
  initSession,
  getQR as waGetQR,
  getPairCode as waGetPairCode,
  getStatus as waGetStatus,
  sendMessage as waSendMessage,
  getMyInfo as waGetMyInfo,
  logout as waLogout,
  clear as waClear,
} from "../lib/whatsapp.js";
import User from "../models/userModel.js";
import subscriptions from "../json/subscription.js";
import Message from "../models/messageModel.js";
import Campaign from "../models/campaignModel.js";
import ForwardedOrder from "../models/forwardedOrderModel.js";
import DynamicOrder from "../models/dynamicOrderModel.js";
import AgentAudit from "../models/agentAuditModel.js";
import crypto from "node:crypto";
import { assertSafeWebhookUrl } from "../lib/webhookSecurity.js";
import WebhookDelivery from "../models/webhookDeliveryModel.js";
import { setDbVendors, getVendors } from "../lib/vendorList.js";

/* ───────────────── CREATE SESSION ───────────────── */
export async function newSession(req, res) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const userId = req.user._id;

    const user = await User.findById(userId).select("-password");
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const activeSubscription = subscriptions.plans.filter(
      (plan) => plan.id === user.subscription?.id,
    )[0];

    if (!activeSubscription) {
      return res.status(403).json({ error: "No active subscription" });
    }

    const activeSessions = await sessionModel.find({ user: userId }).lean();
    if (activeSessions.length >= activeSubscription.sessions) {
      return res
        .status(403)
        .json({ error: "You have reached the maximum number of sessions" });
    }

    const session = await sessionModel.create({
      user: userId,
      status: "CREATED",
    });

    await initSession(userId.toString(), session._id.toString());

    res.status(201).json({
      success: true,
      sessionId: session._id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
}

/* ───────────────── GET QR ───────────────── */
export async function getQR(req, res) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const userId = req.user._id.toString();
    const { sessionId } = req.params;

    const session = await sessionModel.findOne({
      _id: sessionId,
      user: userId,
    });

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const qr = await waGetQR(userId, sessionId);

    res.json({
      connected: !qr,
      qr,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getPairCode(req, res) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const userId = req.user._id.toString();
    const { sessionId } = req.params;
    const { number } = req.body;

    const session = await sessionModel.findOne({
      _id: sessionId,
      user: userId,
    });

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const pairCode = await waGetPairCode(userId, sessionId, number);

    res.json({
      connected: !pairCode,
      pairCode,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/* ───────────────── STATUS ───────────────── */
export async function getStatus(req, res) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const userId = req.user._id.toString();
    const { sessionId } = req.params;

    const session = await sessionModel.findOne({
      _id: sessionId,
      user: userId,
    });

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const connected = await waGetStatus(userId, sessionId);

    res.json({ connected });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/* ───────────────── SEND MESSAGE ───────────────── */
export async function sendMessage(req, res) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const userId = req.user._id.toString();
    const { sessionId } = req.params;
    const { number, message, quotedMessageId, reactionEmoji } = req.body;

    if (!number) {
      return res.status(400).json({ error: "number required" });
    }

    if (!message && !reactionEmoji) {
      return res.status(400).json({ error: "message or reactionEmoji required" });
    }

    const session = await sessionModel.findOne({
      _id: sessionId,
      user: userId,
    });

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    let msgPayload = { text: message };
    let options = {};

    if (quotedMessageId) {
      const isObjectId = quotedMessageId.match(/^[0-9a-fA-F]{24}$/);
      let query = {};
      if (isObjectId) {
        query = { _id: quotedMessageId };
      } else {
        query = { "message.key.id": quotedMessageId };
      }

      const quotedMsg = await Message.findOne(query).lean();
      if (quotedMsg && quotedMsg.message) {
        if (reactionEmoji) {
          msgPayload = {
            react: {
              text: reactionEmoji,
              key: quotedMsg.message.key
            }
          };
        } else {
          options.quoted = quotedMsg.message;
        }
      } else if (reactionEmoji) {
        return res.status(400).json({ error: "Original message for reaction not found" });
      }
    }

    const result = await waSendMessage(userId, sessionId, number, msgPayload, false, options);

    res.json({
      success: true,
      message: result.key,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}


/* ───────────────── MY INFO ───────────────── */
export async function getMyInfo(req, res) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const userId = req.user._id.toString();
    const { sessionId } = req.params;

    const session = await sessionModel.findOne({
      _id: sessionId,
      user: userId,
    });

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const info = await waGetMyInfo(userId, sessionId);

    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/* ───────────────── LOGOUT ───────────────── */
export async function logoutSession(req, res) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const userId = req.user._id.toString();
    const { sessionId } = req.params;

    const session = await sessionModel.findOne({
      _id: sessionId,
      user: userId,
    });

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    await waLogout(userId, sessionId);

    session.status = "LOGGED_OUT";
    await session.save();

    res.json({
      success: true,
      message: "Session logged out",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
/* ───────────────── DELETE ───────────────── */
export async function deleteSession(req, res) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const userId = req.user._id.toString();
    const { sessionId } = req.params;

    const session = await sessionModel.findOne({
      _id: sessionId,
      user: userId,
    });

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    await waClear(userId, sessionId);

    res.json({
      success: true,
      message: "Session logged out",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/* ───────────────── SESSION LIST ───────────────── */

export async function getSessionList(req, res) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const userId = req.user._id.toString();
    const sessions = await sessionModel
      .find({ user: userId })
      .select(
        "_id status apiKey webhookUrl fallbackEnabled fallbackMessage forwardingEnabled forwardingTarget forwardingShowSender",
      )
      .sort({ createdAt: -1 })
      .lean();

    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function setWebhook(req, res) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  const { sessionId } = req.params;
  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  const { webhookUrl } = req.body;

  try {
    if (webhookUrl !== undefined && typeof webhookUrl !== "string") {
      return res.status(400).json({ error: "Webhook URL must be a string" });
    }

    const normalizedWebhookUrl = webhookUrl?.trim()
      ? await assertSafeWebhookUrl(webhookUrl)
      : "";
    const userId = req.user._id.toString();
    const session = await sessionModel
      .findOne({ _id: sessionId, user: userId })
      .select("+webhookSecret");

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    session.webhookUrl = normalizedWebhookUrl;
    if (normalizedWebhookUrl && !session.webhookSecret) {
      session.webhookSecret = crypto.randomBytes(32).toString("hex");
    }
    await session.save();

    return res.status(200).json({
      success: true,
      message: normalizedWebhookUrl ? "Webhook URL updated successfully" : "Webhook URL cleared",
      webhookUrl: session.webhookUrl,
      webhookSecret: normalizedWebhookUrl ? session.webhookSecret : undefined,
    });
  } catch (error) {
    console.error("Webhook setup error:", error);
    const isValidationError = /Webhook URL|public IP|HTTPS|credentials/i.test(error.message);
    return res.status(isValidationError ? 400 : 500).json({
      error: isValidationError ? error.message : "Failed to update webhook URL",
    });
  }
}

export async function getWebhookConfig(req, res) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const session = await sessionModel
      .findOne({ _id: req.params.sessionId, user: req.user._id })
      .select("webhookUrl +webhookSecret");

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    return res.json({
      success: true,
      webhookUrl: session.webhookUrl || "",
      webhookSecret: session.webhookSecret || "",
    });
  } catch (error) {
    console.error("Webhook config error:", error);
    return res.status(500).json({ error: "Failed to load webhook configuration" });
  }
}

export async function rotateWebhookSecret(req, res) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const session = await sessionModel
      .findOne({ _id: req.params.sessionId, user: req.user._id })
      .select("webhookUrl +webhookSecret");

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    if (!session.webhookUrl) {
      return res.status(400).json({ error: "Configure a webhook URL before rotating its secret" });
    }

    session.webhookSecret = crypto.randomBytes(32).toString("hex");
    await session.save();
    return res.json({ success: true, webhookSecret: session.webhookSecret });
  } catch (error) {
    console.error("Webhook secret rotation error:", error);
    return res.status(500).json({ error: "Failed to rotate webhook secret" });
  }
}

export async function getWebhookDeliveries(req, res) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const session = await sessionModel.findOne({
      _id: req.params.sessionId,
      user: req.user._id,
    });
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const requestedLimit = Number(req.query.limit || 50);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(100, Math.max(1, Math.floor(requestedLimit)))
      : 50;
    const deliveries = await WebhookDelivery.find({ session: session._id })
      .select("eventId event endpoint status attempts httpStatus lastError deliveredAt createdAt")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({ success: true, deliveries });
  } catch (error) {
    console.error("Webhook delivery history error:", error);
    return res.status(500).json({ error: "Failed to load webhook delivery history" });
  }
}

export async function setFallback(req, res) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  const { sessionId } = req.params;
  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  const { fallbackEnabled, fallbackMessage } = req.body;

  try {
    const userId = req.user._id.toString();
    const session = await sessionModel.findOne({
      _id: sessionId,
      user: userId,
    });

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    session.fallbackEnabled = fallbackEnabled === true || fallbackEnabled === "true";
    session.fallbackMessage = fallbackMessage?.trim() || "";
    await session.save();

    return res.status(200).json({
      success: true,
      message: "Fallback settings updated successfully",
      fallbackEnabled: session.fallbackEnabled,
      fallbackMessage: session.fallbackMessage
    });
  } catch (error) {
    console.error("Fallback setup error:", error);
    return res.status(500).json({ error: "Failed to update fallback settings" });
  }
}

export async function setHistory(req, res) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  const { sessionId } = req.params;
  if (!sessionId) {
    res.status(404).json({ error: "Session not found" });
  }
  try {
    const userId = req.user._id.toString();
    const session = await sessionModel.findOne({
      _id: sessionId,
      user: userId,
    });
    if (!session) {
      res.status(404).json({ error: "Session not found" });
    }
    if (session.user.toString() !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const messages = await Message.find({ session: sessionId })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, messages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

/* ───────────────── AI SETTINGS ───────────────── */
export async function setAiSettings(req, res) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  const { sessionId } = req.params;
  if (!sessionId) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  const { aiEnabled, openAiKey, aiPrompt } = req.body;

  try {
    const userId = req.user._id.toString();
    const session = await sessionModel.findOne({
      _id: sessionId,
      user: userId,
    });

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    session.aiEnabled = aiEnabled === true || aiEnabled === "true";
    session.openAiKey = openAiKey?.trim() || "";
    session.aiPrompt = aiPrompt?.trim() || "";
    await session.save();

    return res.status(200).json({
      success: true,
      message: "AI settings updated successfully",
      aiEnabled: session.aiEnabled,
      openAiKey: session.openAiKey,
      aiPrompt: session.aiPrompt
    });
  } catch (error) {
    console.error("AI setup error:", error);
    return res.status(500).json({ error: "Failed to update AI settings" });
  }
}

/* ───────────────── ANALYTICS ───────────────── */
export async function getAnalytics(req, res) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const userId = req.user._id.toString();

    // Past 7 Days Graph
    const labels = [];
    const messageCounts = [];
    const campaignCounts = [];

    // Aggregate Messages
    const startOfToday = new Date();
    startOfToday.setHours(0,0,0,0);
    
    // Create an array mapping for the last 7 days natively
    for (let i = 6; i >= 0; i--) {
       const date = new Date(startOfToday);
       date.setDate(date.getDate() - i);
       
       const nextDate = new Date(date);
       nextDate.setDate(date.getDate() + 1);
       
       labels.push(date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));
       
       // Count Messages exactly on this day
       const msgCount = await Message.countDocuments({
          user: userId,
          createdAt: { $gte: date, $lt: nextDate }
       });
       messageCounts.push(msgCount);
       
       // Count Campaigns activated this day
       const campCount = await Campaign.countDocuments({
          user: userId,
          createdAt: { $gte: date, $lt: nextDate }
       });
       campaignCounts.push(campCount);
    }

    res.json({
       success: true,
       labels,
       datasets: [
         { label: "Messages Sent", data: messageCounts, borderColor: "#10b981", backgroundColor: "rgba(16, 185, 129, 0.1)" },
         { label: "Campaigns Run", data: campaignCounts, borderColor: "#6366f1", backgroundColor: "rgba(99, 102, 241, 0.1)" }
       ]
    });
  } catch (error) {
    console.error("Analytics error:", error);
    res.status(500).json({ error: error.message });
  }
}

/* ───────────────── INBOX ───────────────── */
export async function getInbox(req, res) {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 30, session, msgType } = req.query;

    const filter = { user: userId, direction: "received" };
    if (session) filter.session = session;
    if (msgType) filter.msgType = msgType;

    const messages = await Message.find(filter)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .populate("session", "_id status");

    const total = await Message.countDocuments(filter);

    res.json({ success: true, messages, total, page: Number(page) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export async function getConversation(req, res) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const userId = req.user._id;
    const { number, session } = req.query;

    if (!number || !session) {
      return res.status(400).json({ error: "number and session required" });
    }

    // Match both received (fromNumber = sender) and sent (fromNumber = recipient)
    const messages = await Message.find({
      user: userId,
      session: session,
      $or: [
        { fromNumber: number },
        { fromNumber: { $regex: new RegExp(`^${number}`) } }
      ]
    })
      .sort({ createdAt: 1 })
      .lean();

    res.json({ success: true, messages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

export async function setForwarding(req, res) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  const { sessionId } = req.params;
  const { forwardingEnabled, forwardingTarget } = req.body;

  try {
    const userId = req.user._id.toString();
    const user = await User.findById(userId).lean();
    const isFwActive = user?.fwSubscription && 
                       user.fwSubscription.status === "active" && 
                       new Date(user.fwSubscription.endDate) > new Date();
    
    if (!isFwActive) {
      return res.status(403).json({ error: "You need an active Forwarding Bot Subscription to use this feature." });
    }

    const session = await sessionModel.findOne({
      _id: sessionId,
      user: userId,
    });

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    session.forwardingEnabled = !!forwardingEnabled;
    
    let cleanedTarget = "";
    if (forwardingTarget && forwardingTarget.trim()) {
      cleanedTarget = forwardingTarget.trim().replace(/\s+/g, "");
      if (!cleanedTarget.endsWith("@s.whatsapp.net") && !cleanedTarget.endsWith("@g.us")) {
        if (cleanedTarget.includes("-")) {
          cleanedTarget = `${cleanedTarget}@g.us`;
        } else {
          cleanedTarget = `${cleanedTarget.replace(/\D/g, "")}@s.whatsapp.net`;
        }
      }
    }
    
    session.forwardingTarget = cleanedTarget;
    await session.save();

    return res.status(200).json({
      success: true,
      message: "Forwarding settings updated successfully",
      forwardingEnabled: session.forwardingEnabled,
      forwardingTarget: session.forwardingTarget,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Configure where documents go when they cannot be auto-delivered safely.
// Deliberately not behind the Forwarding Bot subscription: this is a safety
// net for the core delivery flow, not an add-on feature, and leaving it off
// means undelivered customer documents are silently dropped.
export async function setUndelivered(req, res) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  const { sessionId } = req.params;
  const { undeliveredEnabled, undeliveredTarget } = req.body;

  try {
    const userId = req.user._id.toString();
    const session = await sessionModel.findOne({ _id: sessionId, user: userId });
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    let cleanedTarget = "";
    if (undeliveredTarget && String(undeliveredTarget).trim()) {
      cleanedTarget = String(undeliveredTarget).trim().replace(/\s+/g, "");
      if (!cleanedTarget.endsWith("@s.whatsapp.net") && !cleanedTarget.endsWith("@g.us")) {
        cleanedTarget = cleanedTarget.includes("-") || cleanedTarget.replace(/\D/g, "").length > 15
          ? `${cleanedTarget}@g.us`
          : `${cleanedTarget.replace(/\D/g, "")}@s.whatsapp.net`;
      }
    }

    if (undeliveredEnabled && !cleanedTarget) {
      return res.status(400).json({ error: "A target group or number is required to enable undelivered forwarding" });
    }

    session.undeliveredEnabled = !!undeliveredEnabled;
    session.undeliveredTarget = cleanedTarget;
    await session.save();

    return res.status(200).json({
      success: true,
      message: "Undelivered document routing updated successfully",
      undeliveredEnabled: session.undeliveredEnabled,
      undeliveredTarget: session.undeliveredTarget,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getForwardingHistory(req, res) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const userId = req.user._id.toString();
    const { page = 1, limit = 50 } = req.query;

    const sessions = await sessionModel.find({ user: userId }, "_id");
    const sessionIds = sessions.map(s => s._id);

    const logs = await ForwardedOrder.find({ session: { $in: sessionIds } })
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .populate("session", "_id status");

    const total = await ForwardedOrder.countDocuments({ session: { $in: sessionIds } });

    res.json({
      success: true,
      logs,
      total,
      page: Number(page),
      limit: Number(limit)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Live dashboard counters, read from the order pipeline that actually runs.
// The older forwarding-bot stats are backed by ForwardedOrder, which this
// workflow never writes, so those cards always showed zero.
export async function getDashboardStats(req, res) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const userId = req.user._id.toString();
    const sessions = await sessionModel.find({ user: userId }, "_id status").lean();
    const sessionIds = sessions.map((session) => session._id);

    const connected = sessions.filter((session) => session.status === "CONNECTED").length;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const today = { $gte: startOfToday };
    const scope = { user: userId, session: { $in: sessionIds } };

    const [
      forwardedToday,
      resolvedToday,
      rejectedToday,
      pendingNow,
      inRevision,
      deliveredTotal,
      ordersTotal,
    ] = await Promise.all([
      // Handed to a vendor today — the moment the CEO forwards the details.
      DynamicOrder.countDocuments({ ...scope, assignedAt: today }),
      DynamicOrder.countDocuments({ ...scope, status: "DELIVERED", deliveredAt: today }),
      // Files examined today that could not be delivered and need a human.
      AgentAudit.countDocuments({
        ...scope,
        eventType: "DELIVERY_DECISION",
        outcome: { $in: ["NO_MATCH", "AMBIGUOUS", "SOURCE_IS_CUSTOMER", "VENDOR_TO_VENDOR", "REVISION_PENDING", "ERROR"] },
        createdAt: today,
      }),
      DynamicOrder.countDocuments({ ...scope, status: "PENDING" }),
      DynamicOrder.countDocuments({ ...scope, status: "REVISION" }),
      DynamicOrder.countDocuments({ ...scope, status: "DELIVERED" }),
      DynamicOrder.countDocuments(scope),
    ]);

    return res.status(200).json({
      success: true,
      instances: {
        total: sessions.length,
        connected,
        offline: sessions.length - connected,
      },
      today: {
        forwarded: forwardedToday,
        resolved: resolvedToday,
        rejected: rejectedToday,
        pending: pendingNow,
      },
      totals: {
        orders: ordersTotal,
        delivered: deliveredTotal,
        pending: pendingNow,
        inRevision,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Vendors managed from the dashboard. These sit alongside vendors.txt; a number
// present in either source is treated as a vendor.
export async function setVendors(req, res) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  const { sessionId } = req.params;
  const { vendorNumbers, vendorGroupJid } = req.body;

  try {
    if (vendorNumbers !== undefined && !Array.isArray(vendorNumbers)) {
      return res.status(400).json({ error: "vendorNumbers must be an array" });
    }
    const session = await sessionModel.findOne({ _id: sessionId, user: req.user._id.toString() });
    if (!session) return res.status(404).json({ error: "Session not found" });

    if (vendorNumbers !== undefined) {
      session.vendorNumbers = [...new Set(
        vendorNumbers
          .map((value) => String(value).replace(/\D/g, ""))
          .filter((digits) => digits.length >= 10)
          .map((digits) => (/^01\d{9}$/.test(digits) ? `88${digits}` : digits)),
      )];
    }
    if (vendorGroupJid !== undefined) {
      const target = String(vendorGroupJid || "").trim();
      session.vendorGroupJid = target && !target.endsWith("@g.us") ? `${target}@g.us` : target;
    }
    await session.save();

    // Push straight into the in-memory set so the change applies immediately.
    const all = await sessionModel.find({ user: req.user._id.toString() }, "vendorNumbers").lean();
    setDbVendors(all.flatMap((entry) => entry.vendorNumbers || []));

    return res.status(200).json({
      success: true,
      vendorNumbers: session.vendorNumbers,
      vendorGroupJid: session.vendorGroupJid,
      activeVendors: [...getVendors()].map(([number, name]) => ({ number, name })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getVendorConfig(req, res) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  try {
    const session = await sessionModel.findOne({ _id: req.params.sessionId, user: req.user._id.toString() }).lean();
    if (!session) return res.status(404).json({ error: "Session not found" });
    return res.status(200).json({
      success: true,
      // Included so the dashboard can list the account's groups for the
      // vendor-group picker; the caller already owns this session.
      apiKey: session.apiKey || "",
      vendorNumbers: session.vendorNumbers || [],
      vendorGroupJid: session.vendorGroupJid || "",
      activeVendors: [...getVendors()].map(([number, name]) => ({ number, name })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getForwardingStats(req, res) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const userId = req.user._id.toString();
    const user = await User.findById(userId).lean();
    const isFwActive = user?.fwSubscription && 
                       user.fwSubscription.status === "active" && 
                       new Date(user.fwSubscription.endDate) > new Date();

    if (!isFwActive) {
      return res.json({ success: true, isFwActive: false });
    }

    const sessions = await sessionModel.find({ user: userId }, "_id");
    const sessionIds = sessions.map(s => s._id);

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const total = await ForwardedOrder.countDocuments({
      session: { $in: sessionIds },
      createdAt: { $gte: startOfToday }
    });

    const resolved = await ForwardedOrder.countDocuments({
      session: { $in: sessionIds },
      status: "RESOLVED",
      createdAt: { $gte: startOfToday }
    });

    const rejected = await ForwardedOrder.countDocuments({
      session: { $in: sessionIds },
      status: "REJECTED",
      createdAt: { $gte: startOfToday }
    });

    const pending = await ForwardedOrder.countDocuments({
      session: { $in: sessionIds },
      status: "PENDING",
      createdAt: { $gte: startOfToday }
    });

    res.json({
      success: true,
      isFwActive: true,
      stats: { total, resolved, rejected, pending }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
