import User from "../models/userModel.js";
import Session from "../models/sessionModel.js";
import Campaign from "../models/campaignModel.js";
import Settings from "../models/settingsModel.js";
import Transaction from "../models/transactionModel.js";
import Message from "../models/messageModel.js";
import AutoReply from "../models/autoReplyModel.js";
import Announcement from "../models/announcementModel.js";
import Coupon from "../models/couponModel.js";
import AuditLog from "../models/auditLogModel.js";

// ═══════════════════════════════════════════════
//   HELPER: log admin action
// ═══════════════════════════════════════════════
async function logAction(adminId, action, target = "", details = "", ip = "") {
  try { await AuditLog.create({ admin: adminId, action, target, details, ip }); } catch (_) {}
}

// ═══════════════════════════════════════════════
//   DASHBOARD
// ═══════════════════════════════════════════════
export async function getDashboardStats(req, res) {
  try {
    const totalUsers = await User.countDocuments();
    const activeSessions = await Session.countDocuments({ status: "CONNECTED" });
    const totalCampaigns = await Campaign.countDocuments();
    const recentUsers = await User.find().sort({ createdAt: -1 }).limit(5).select("name email balance status role createdAt");

    res.json({ success: true, stats: { totalUsers, activeSessions, totalCampaigns }, recentUsers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ═══════════════════════════════════════════════
//   USER MANAGEMENT
// ═══════════════════════════════════════════════
export async function getUsers(req, res) {
  try {
    const users = await User.find().sort({ createdAt: -1 }).select("-password");
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateUserStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!["active", "banned"].includes(status)) return res.status(400).json({ error: "Invalid status" });
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.role === "admin") return res.status(400).json({ error: "Cannot ban an admin" });

    user.status = status;
    await user.save();
    await logAction(req.user._id, status === "banned" ? "user_banned" : "user_unbanned", user.email, "", req.ip);
    res.json({ success: true, message: "User status updated", user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function addBalance(req, res) {
  try {
    const { id } = req.params;
    const { amount } = req.body;
    if (isNaN(amount)) return res.status(400).json({ error: "Invalid amount" });
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.balance += Number(amount);
    await user.save();
    await Transaction.create({ user: user._id, amount: Number(amount), type: "credit", by: "admin" });
    await logAction(req.user._id, "balance_added", user.email, `৳${amount}`, req.ip);
    res.json({ success: true, message: `Added balance. New Total: ${user.balance}`, balance: user.balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// User export CSV
export async function exportUsersCSV(req, res) {
  try {
    const users = await User.find().select("-password").lean();
    const header = "Name,Email,Username,Balance,Role,Status,Subscription,Joined\n";
    const rows = users.map(u => {
      return `"${u.name}","${u.email}","${u.username}",${u.balance},${u.role},${u.status},"${u.subscription?.id || 'none'}","${new Date(u.createdAt).toISOString()}"`;
    }).join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="users_export_${Date.now()}.csv"`);
    res.send(header + rows);
    await logAction(req.user._id, "users_exported", "", `${users.length} users`, req.ip);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ═══════════════════════════════════════════════
//   SESSIONS (platform-wide)
// ═══════════════════════════════════════════════
export async function getAllSessions(req, res) {
  try {
    const sessions = await Session.find().sort({ createdAt: -1 }).populate("user", "name email").select("_id status apiKey webhookUrl createdAt user");
    res.json({ success: true, sessions, total: sessions.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteSession(req, res) {
  try {
    const { id } = req.params;
    const session = await Session.findById(id).populate("user", "email");
    if (!session) return res.status(404).json({ error: "Session not found" });
    const email = session.user?.email || "unknown";
    await Session.findByIdAndDelete(id);
    await logAction(req.user._id, "session_deleted", email, `Session ${id}`, req.ip);
    res.json({ success: true, message: "Session deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function disconnectSession(req, res) {
  try {
    const { id } = req.params;
    const session = await Session.findById(id).populate("user", "email");
    if (!session) return res.status(404).json({ error: "Session not found" });
    session.status = "DISCONNECTED";
    await session.save();
    await logAction(req.user._id, "session_disconnected", session.user?.email || "", `Session ${id}`, req.ip);
    res.json({ success: true, message: "Session disconnected" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ═══════════════════════════════════════════════
//   CAMPAIGNS (platform-wide)
// ═══════════════════════════════════════════════
export async function getAllCampaigns(req, res) {
  try {
    const campaigns = await Campaign.find().sort({ createdAt: -1 }).limit(100).populate("user", "name email").select("name status totalContacts sentCount failedCount createdAt user");
    const total = await Campaign.countDocuments();
    res.json({ success: true, campaigns, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ═══════════════════════════════════════════════
//   GLOBAL INBOX
// ═══════════════════════════════════════════════
export async function getAdminInbox(req, res) {
  try {
    const { page = 1, limit = 50, session } = req.query;
    const filter = { direction: "received" };
    if (session) filter.session = session;
    const messages = await Message.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(Number(limit)).populate("session", "_id status").populate("user", "name email");
    const total = await Message.countDocuments(filter);
    res.json({ success: true, messages, total, page: Number(page) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ═══════════════════════════════════════════════
//   REVENUE & FINANCE
// ═══════════════════════════════════════════════
export async function getRevenueStats(req, res) {
  try {
    const rechargeAgg = await Transaction.aggregate([{ $match: { type: "credit" } }, { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }]);
    const totalRevenue = rechargeAgg[0]?.total || 0;
    const totalRecharges = rechargeAgg[0]?.count || 0;
    const spendAgg = await Transaction.aggregate([{ $match: { type: "debit", by: "subscription" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]);
    const totalSubscriptionRevenue = spendAgg[0]?.total || 0;

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const newUsersWeek = await User.countDocuments({ createdAt: { $gte: weekAgo } });
    const activeSubscribers = await User.countDocuments({ "subscription.status": "active", "subscription.endDate": { $gte: new Date() } });
    const totalMessages = await Message.countDocuments({ direction: "sent" });
    const totalReceived = await Message.countDocuments({ direction: "received" });

    const topUsers = await User.find().sort({ balance: -1 }).limit(5).select("name email balance subscription.status");
    const recentTransactions = await Transaction.find().sort({ createdAt: -1 }).limit(20).populate("user", "name email");

    res.json({ success: true, revenue: { totalRevenue, totalRecharges, totalSubscriptionRevenue, newUsersWeek, activeSubscribers, totalMessages, totalReceived }, topUsers, recentTransactions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Revenue chart data (last N days)
export async function getRevenueChart(req, res) {
  try {
    const days = parseInt(req.query.days) || 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const pipeline = [
      { $match: { createdAt: { $gte: since } } },
      { $group: {
        _id: { date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, type: "$type" },
        total: { $sum: "$amount" }, count: { $sum: 1 }
      }},
      { $sort: { "_id.date": 1 } }
    ];
    const raw = await Transaction.aggregate(pipeline);

    // Build labels + data arrays
    const labels = [];
    const credits = [];
    const debits = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      labels.push(key);
      const cr = raw.find(r => r._id.date === key && r._id.type === "credit");
      const db = raw.find(r => r._id.date === key && r._id.type === "debit");
      credits.push(cr?.total || 0);
      debits.push(db?.total || 0);
    }
    res.json({ success: true, labels, credits, debits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ═══════════════════════════════════════════════
//   SETTINGS (Gateway + Platform)
// ═══════════════════════════════════════════════
export async function getSettings(req, res) {
  try {
    let settings = await Settings.findOne();
    if (!settings) { settings = new Settings({}); await settings.save(); }
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateSettings(req, res) {
  try {
    const { paymentGateway, subscriptionPlans, platform } = req.body;
    let settings = await Settings.findOne();
    if (!settings) settings = new Settings({});
    if (paymentGateway) settings.paymentGateway = paymentGateway;
    if (subscriptionPlans) settings.subscriptionPlans = subscriptionPlans;
    if (platform) settings.platform = { ...settings.platform?.toObject?.() || {}, ...platform };
    await settings.save();
    await logAction(req.user._id, "settings_updated", "", JSON.stringify(Object.keys(req.body)), req.ip);
    res.json({ success: true, message: "Settings updated successfully", settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ═══════════════════════════════════════════════
//   SUBSCRIPTION PLAN CRUD
// ═══════════════════════════════════════════════
export async function getSubscriptionPlans(req, res) {
  try {
    let settings = await Settings.findOne();
    if (!settings) settings = new Settings({});
    res.json({ success: true, plans: settings.subscriptionPlans || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createPlan(req, res) {
  try {
    const { id, name, price, durationDays, features, sessionLimit, maxCampaigns } = req.body;
    if (!id || !name || !price || !durationDays) return res.status(400).json({ error: "id, name, price, durationDays required" });

    let settings = await Settings.findOne();
    if (!settings) settings = new Settings({});
    if (settings.subscriptionPlans.some(p => p.id === id)) return res.status(400).json({ error: "Plan ID already exists" });

    settings.subscriptionPlans.push({ id, name, price: Number(price), durationDays: Number(durationDays), features: features || [], sessionLimit: sessionLimit || 1, maxCampaigns: maxCampaigns || 5, isActive: true });
    await settings.save();
    await logAction(req.user._id, "plan_created", name, `৳${price} / ${durationDays}d`, req.ip);
    res.json({ success: true, message: "Plan created", plans: settings.subscriptionPlans });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updatePlan(req, res) {
  try {
    const { planId } = req.params;
    const updates = req.body;
    let settings = await Settings.findOne();
    if (!settings) return res.status(404).json({ error: "Settings not found" });
    const plan = settings.subscriptionPlans.find(p => p.id === planId);
    if (!plan) return res.status(404).json({ error: "Plan not found" });

    if (updates.name) plan.name = updates.name;
    if (updates.price !== undefined) plan.price = Number(updates.price);
    if (updates.durationDays !== undefined) plan.durationDays = Number(updates.durationDays);
    if (updates.features) plan.features = updates.features;
    if (updates.sessionLimit !== undefined) plan.sessionLimit = Number(updates.sessionLimit);
    if (updates.maxCampaigns !== undefined) plan.maxCampaigns = Number(updates.maxCampaigns);
    if (updates.isActive !== undefined) plan.isActive = updates.isActive;

    await settings.save();
    await logAction(req.user._id, "plan_updated", plan.name, "", req.ip);
    res.json({ success: true, message: "Plan updated", plans: settings.subscriptionPlans });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function deletePlan(req, res) {
  try {
    const { planId } = req.params;
    let settings = await Settings.findOne();
    if (!settings) return res.status(404).json({ error: "Settings not found" });
    const idx = settings.subscriptionPlans.findIndex(p => p.id === planId);
    if (idx === -1) return res.status(404).json({ error: "Plan not found" });

    const planName = settings.subscriptionPlans[idx].name;
    settings.subscriptionPlans.splice(idx, 1);
    await settings.save();
    await logAction(req.user._id, "plan_deleted", planName, "", req.ip);
    res.json({ success: true, message: "Plan deleted", plans: settings.subscriptionPlans });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ═══════════════════════════════════════════════
//   ANNOUNCEMENTS
// ═══════════════════════════════════════════════
export async function getAnnouncements(req, res) {
  try {
    const announcements = await Announcement.find().sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, announcements });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createAnnouncement(req, res) {
  try {
    const { title, body, type, expiresAt } = req.body;
    if (!title || !body) return res.status(400).json({ error: "Title and body required" });
    const ann = await Announcement.create({ title, body, type: type || "info", expiresAt: expiresAt || null });
    await logAction(req.user._id, "announcement_created", title, "", req.ip);
    res.json({ success: true, announcement: ann });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteAnnouncement(req, res) {
  try {
    const { id } = req.params;
    const ann = await Announcement.findByIdAndDelete(id);
    if (!ann) return res.status(404).json({ error: "Announcement not found" });
    await logAction(req.user._id, "announcement_deleted", ann.title, "", req.ip);
    res.json({ success: true, message: "Announcement deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Public: users fetch active announcements
export async function getActiveAnnouncements(req, res) {
  try {
    const now = new Date();
    const announcements = await Announcement.find({
      isActive: true,
      $or: [{ expiresAt: null }, { expiresAt: { $gte: now } }]
    }).sort({ createdAt: -1 }).limit(10);
    res.json({ success: true, announcements });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ═══════════════════════════════════════════════
//   COUPON / PROMO CODES
// ═══════════════════════════════════════════════
export async function getCoupons(req, res) {
  try {
    const coupons = await Coupon.find().sort({ createdAt: -1 });
    res.json({ success: true, coupons });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createCoupon(req, res) {
  try {
    const { code, discountPercent, maxUses, expiresAt, description, applicablePlans } = req.body;
    if (!code || !discountPercent) return res.status(400).json({ error: "Code and discountPercent required" });
    const coupon = await Coupon.create({
      code: code.toUpperCase().trim(),
      discountPercent: Number(discountPercent),
      maxUses: Number(maxUses) || 0,
      expiresAt: expiresAt || null,
      description: description || "",
      applicablePlans: applicablePlans || []
    });
    await logAction(req.user._id, "coupon_created", code, `${discountPercent}% off`, req.ip);
    res.json({ success: true, coupon });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: "Coupon code already exists" });
    res.status(500).json({ error: err.message });
  }
}

export async function deleteCoupon(req, res) {
  try {
    const { id } = req.params;
    const coupon = await Coupon.findByIdAndDelete(id);
    if (!coupon) return res.status(404).json({ error: "Coupon not found" });
    await logAction(req.user._id, "coupon_deleted", coupon.code, "", req.ip);
    res.json({ success: true, message: "Coupon deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function toggleCoupon(req, res) {
  try {
    const { id } = req.params;
    const coupon = await Coupon.findById(id);
    if (!coupon) return res.status(404).json({ error: "Coupon not found" });
    coupon.isActive = !coupon.isActive;
    await coupon.save();
    res.json({ success: true, coupon });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ═══════════════════════════════════════════════
//   CHATBOT RULES OVERVIEW
// ═══════════════════════════════════════════════
export async function getAllAutoReplies(req, res) {
  try {
    const rules = await AutoReply.find().sort({ createdAt: -1 }).populate("user", "name email").populate("session", "_id status").limit(200);
    res.json({ success: true, rules, total: rules.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ═══════════════════════════════════════════════
//   API USAGE MONITOR (simplified)
// ═══════════════════════════════════════════════
export async function getApiUsage(req, res) {
  try {
    // Per-user message counts + session counts
    const userStats = await User.find().select("name email").lean();
    const result = [];
    for (const u of userStats) {
      const sessions = await Session.countDocuments({ user: u._id });
      const sent = await Message.countDocuments({ user: u._id, direction: "sent" });
      const received = await Message.countDocuments({ user: u._id, direction: "received" });
      const campaigns = await Campaign.countDocuments({ user: u._id });
      result.push({ name: u.name, email: u.email, sessions, sent, received, campaigns });
    }
    result.sort((a, b) => (b.sent + b.received) - (a.sent + a.received));
    res.json({ success: true, usage: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ═══════════════════════════════════════════════
//   AUDIT LOG
// ═══════════════════════════════════════════════
export async function getAuditLogs(req, res) {
  try {
    const { page = 1, limit = 50 } = req.query;
    const logs = await AuditLog.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(Number(limit)).populate("admin", "name email");
    const total = await AuditLog.countDocuments();
    res.json({ success: true, logs, total, page: Number(page) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ═══════════════════════════════════════════════
//   SYSTEM INFO
// ═══════════════════════════════════════════════
export async function getSystemInfo(req, res) {
  try {
    const totalUsers = await User.countDocuments();
    const totalSessions = await Session.countDocuments();
    const totalCampaigns = await Campaign.countDocuments();
    const totalMessages = await Message.countDocuments();
    const uptime = process.uptime();
    const mem = process.memoryUsage();

    res.json({
      success: true,
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        uptime: Math.floor(uptime),
        memoryUsed: Math.round(mem.heapUsed / 1024 / 1024),
        memoryTotal: Math.round(mem.heapTotal / 1024 / 1024),
        totalUsers, totalSessions, totalCampaigns, totalMessages,
        serverTime: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
