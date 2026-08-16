import Settings from "../models/settingsModel.js";
import Transaction from "../models/transactionModel.js";
import Session from "../models/sessionModel.js";
import subscriptionsFallback from "../json/subscription.js";

// Helper: DB থেকে active plans আনো (fallback: json file)
async function getActivePlans() {
  try {
    const settings = await Settings.findOne().lean();
    if (settings && settings.subscriptionPlans && settings.subscriptionPlans.length > 0) {
      return settings.subscriptionPlans.filter(p => p.isActive);
    }
  } catch (_) {}
  // fallback to json
  return subscriptionsFallback.plans.map(p => ({
    id: p.id,
    name: p.name,
    price: p.price,
    durationDays: 30,
    features: p.features,
    sessionLimit: p.sessions,
    sessions: p.sessions,
    maxCampaigns: 10,
    isActive: true,
    description: p.description,
    cta: p.cta,
    highlighted: p.highlighted,
    popular: p.popular,
    pricePerSession: p.pricePerSession
  }));
}

// Helper: normalize plan (DB plans may not have all fields)
function normalizePlan(p) {
  return {
    id: p.id,
    name: p.name,
    price: p.price,
    durationDays: p.durationDays || 30,
    features: p.features || [],
    sessionLimit: p.sessionLimit || p.sessions || 1,
    sessions: p.sessionLimit || p.sessions || 1,
    maxCampaigns: p.maxCampaigns || 5,
    isActive: p.isActive !== false,
    description: p.description || "",
    cta: p.cta || "Subscribe Now",
    highlighted: p.highlighted || false,
    popular: p.popular || false,
    pricePerSession: p.pricePerSession || Math.round(p.price / (p.sessionLimit || p.sessions || 1))
  };
}

export async function getSubscriptionList(req, res) {
  try {
    const plans = await getActivePlans();
    return res.status(200).json({
      subscriptions: {
        currency: "BDT",
        billing: "monthly",
        plans: plans.map(normalizePlan)
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export async function getCurrentSubscription(req, res) {
  try {
    const user = req.user;
    if (!user) return res.status(400).json({ error: "User not found" });

    if (!user.subscription) {
      return res.status(200).json({ subscription: null, message: "No active subscription" });
    }

    const plans = await getActivePlans();
    const plan = plans.find(p => p.id === user.subscription.id);

    if (!plan) {
      return res.status(200).json({ subscription: null, message: "Subscription plan not found" });
    }

    const now = new Date();
    const endDate = new Date(user.subscription.endDate);
    const remainingDays = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));

    return res.status(200).json({
      subscription: {
        ...normalizePlan(plan),
        startDate: user.subscription.startDate,
        endDate: user.subscription.endDate,
        autoRenew: user.subscription.autoRenew || false,
        status: user.subscription.status,
        remainingDays: remainingDays > 0 ? remainingDays : 0,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export async function purchaseSubscription(req, res) {
  try {
    const user = req.user;
    if (!user) return res.status(400).json({ error: "User not found" });

    const { subscriptionId, autoRenew = false } = req.body;
    if (!subscriptionId) return res.status(400).json({ error: "Subscription ID is required" });

    const plans = await getActivePlans();
    const plan = plans.find(p => p.id === subscriptionId);
    if (!plan) return res.status(400).json({ error: "Subscription plan not found" });

    const normalPlan = normalizePlan(plan);

    const sessions = await Session.find({ user: user._id });
    if (sessions.length > normalPlan.sessionLimit) {
      return res.status(400).json({
        error: `Session limit exceeded. Delete some sessions to subscribe to this plan.`,
        limit: normalPlan.sessionLimit,
        current: sessions.length,
      });
    }

    if (user.balance < normalPlan.price) {
      return res.status(400).json({
        error: "Insufficient balance",
        required: normalPlan.price,
        current: user.balance,
      });
    }

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + (normalPlan.durationDays || 30));

    user.balance -= normalPlan.price;
    user.subscription = { id: normalPlan.id, startDate, endDate, autoRenew, status: "active" };
    await user.save();

    const transaction = await Transaction.create({
      user: user._id,
      amount: normalPlan.price,
      type: "debit",
      description: `Subscription purchase: ${normalPlan.name}`,
      by: "subscription",
    });

    return res.status(200).json({
      message: "Subscription purchased successfully",
      subscription: user.subscription,
      transaction,
      balance: user.balance,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export async function changeSubscription(req, res) {
  try {
    const user = req.user;
    if (!user) return res.status(400).json({ error: "User not found" });

    const { subscriptionId, autoRenew = false } = req.body;
    if (!subscriptionId) return res.status(400).json({ error: "Subscription ID is required" });
    if (!user.subscription) return res.status(400).json({ error: "No active subscription" });

    const plans = await getActivePlans();
    const newPlan = plans.find(p => p.id === subscriptionId);
    if (!newPlan) return res.status(400).json({ error: "Subscription plan not found" });

    const normalPlan = normalizePlan(newPlan);

    if (user.balance < normalPlan.price) {
      return res.status(400).json({ error: "Insufficient balance", required: normalPlan.price, current: user.balance });
    }

    user.balance -= normalPlan.price;
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + (normalPlan.durationDays || 30));

    user.subscription = { id: normalPlan.id, startDate, endDate, autoRenew, status: "active" };
    await user.save();

    const transaction = await Transaction.create({
      user: user._id, amount: normalPlan.price, type: "debit", by: "subscription"
    });

    return res.status(200).json({ message: "Subscription changed successfully", subscription: user.subscription, transaction, balance: user.balance });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export async function cancelSubscription(req, res) {
  try {
    const user = req.user;
    if (!user) return res.status(400).json({ error: "User not found" });
    if (!user.subscription || user.subscription.status !== "active") {
      return res.status(400).json({ error: "No active subscription to cancel" });
    }
    user.subscription.autoRenew = false;
    user.subscription.status = "cancelled";
    await user.save();
    return res.status(200).json({ message: "Subscription cancelled successfully", subscription: user.subscription, willExpire: user.subscription.endDate });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export async function renewSubscription(req, res) {
  try {
    const user = req.user;
    if (!user) return res.status(400).json({ error: "User not found" });
    if (!user.subscription) return res.status(400).json({ error: "No subscription found" });

    const now = new Date();
    const endDate = new Date(user.subscription.endDate);
    if (endDate > now) return res.status(400).json({ error: "Subscription is still active" });

    const plans = await getActivePlans();
    const plan = plans.find(p => p.id === user.subscription.id);
    if (!plan) return res.status(400).json({ error: "Subscription plan not found" });

    const normalPlan = normalizePlan(plan);

    const sessions = await Session.find({ user: user._id });
    if (sessions.length > normalPlan.sessionLimit) {
      return res.status(400).json({ error: "You have more sessions than this plan allows. Delete some sessions first." });
    }
    if (user.balance < normalPlan.price) {
      return res.status(400).json({ error: "Insufficient balance", required: normalPlan.price, current: user.balance });
    }

    const startDate = now;
    const newEndDate = new Date(startDate);
    newEndDate.setDate(newEndDate.getDate() + (normalPlan.durationDays || 30));

    user.balance -= normalPlan.price;
    user.subscription = { id: normalPlan.id, startDate, endDate: newEndDate, autoRenew: user.subscription.autoRenew || false, status: "active" };
    await user.save();

    const transaction = await Transaction.create({ user: user._id, amount: normalPlan.price, type: "debit", by: "subscription" });

    return res.status(200).json({ message: "Subscription renewed successfully", subscription: user.subscription, transaction, balance: user.balance });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export async function updateAutoRenew(req, res) {
  try {
    const user = req.user;
    if (!user) return res.status(400).json({ error: "User not found" });
    const { autoRenew } = req.body;
    if (typeof autoRenew !== "boolean") return res.status(400).json({ error: "autoRenew must be boolean" });
    if (!user.subscription) return res.status(400).json({ error: "No subscription found" });
    user.subscription.autoRenew = autoRenew;
    await user.save();
    return res.status(200).json({ message: `Auto-renew ${autoRenew ? "enabled" : "disabled"} successfully`, subscription: user.subscription });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export async function getPaymentHistory(req, res) {
  try {
    const user = req.user;
    if (!user) return res.status(400).json({ error: "User not found" });
    const transactions = await Transaction.find({ user: user._id }).sort({ createdAt: -1 }).limit(50);
    return res.status(200).json({ payments: transactions, total: transactions.length });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export async function getFwSubscriptionList(req, res) {
  try {
    return res.status(200).json({
      subscriptions: {
        currency: "BDT",
        plans: subscriptionsFallback.fwPlans || []
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export async function getCurrentFwSubscription(req, res) {
  try {
    const user = req.user;
    if (!user) return res.status(400).json({ error: "User not found" });

    if (!user.fwSubscription) {
      return res.status(200).json({ subscription: null, message: "No active forwarding bot subscription" });
    }

    const plan = (subscriptionsFallback.fwPlans || []).find(p => p.id === user.fwSubscription.id);
    if (!plan) {
      return res.status(200).json({ subscription: null, message: "Plan not found" });
    }

    const now = new Date();
    const endDate = new Date(user.fwSubscription.endDate);
    const remainingDays = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));

    return res.status(200).json({
      subscription: {
        ...plan,
        startDate: user.fwSubscription.startDate,
        endDate: user.fwSubscription.endDate,
        status: user.fwSubscription.status,
        remainingDays: remainingDays > 0 ? remainingDays : 0,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export async function purchaseFwSubscription(req, res) {
  try {
    const user = req.user;
    if (!user) return res.status(400).json({ error: "User not found" });

    const { planId } = req.body;
    if (!planId) return res.status(400).json({ error: "Plan ID is required" });

    const plan = (subscriptionsFallback.fwPlans || []).find(p => p.id === planId);
    if (!plan) return res.status(400).json({ error: "Forwarding bot plan not found" });

    if (user.balance < plan.price) {
      return res.status(400).json({
        error: "Insufficient balance",
        required: plan.price,
        current: user.balance,
      });
    }

    user.balance -= plan.price;
    
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + plan.durationDays);

    user.fwSubscription = {
      id: plan.id,
      startDate,
      endDate,
      status: "active",
      expiryAlertSent: false
    };

    await user.save();

    const transaction = await Transaction.create({
      user: user._id,
      amount: plan.price,
      type: "debit",
      description: `Forwarding Bot subscription purchase: ${plan.name}`,
      by: "subscription",
    });

    return res.status(200).json({
      message: "Forwarding Bot subscription purchased successfully",
      fwSubscription: user.fwSubscription,
      transaction,
      balance: user.balance,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
