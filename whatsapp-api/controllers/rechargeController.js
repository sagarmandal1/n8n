import Recharge from "../models/rechargeModel.js";
import Transaction from "../models/transactionModel.js";
import User from "../models/userModel.js";
import { createBkashPayment, executeBkashPayment } from "../lib/bkashService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build dynamic callback URL from incoming request
// ─────────────────────────────────────────────────────────────────────────────
function getCallbackURL(req) {
  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${protocol}://${host}/api/recharge/bkash/callback`;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/recharge/bkash/create
// Called by frontend after user enters amount. Returns bkashURL to redirect to.
// ─────────────────────────────────────────────────────────────────────────────
export async function bkashCreate(req, res) {
  const { amount } = req.body;
  if (!amount || isNaN(amount) || parseFloat(amount) < 10) {
    return res.status(400).json({ error: "Invalid amount. Minimum ৳10." });
  }

  try {
    const invoiceNumber = `INV-${req.user._id.toString().slice(-6)}-${Date.now().toString().slice(-6)}`;
    const callbackURL = getCallbackURL(req);

    const payment = await createBkashPayment({
      amount: parseFloat(amount),
      invoiceNumber,
      callbackURL,
      payerReference: req.user._id.toString(),
    });

    // Temporarily persist amount against paymentID  in a pending Recharge doc
    await Recharge.create({
      id: invoiceNumber,
      user: req.user._id,
      amount: parseFloat(amount),
      number: "bKash-PGW",
      method: "bKash",
      transactionId: payment.paymentID,
      status: "pending",
    });

    return res.json({
      success: true,
      bkashURL: payment.bkashURL,
      paymentID: payment.paymentID,
    });
  } catch (err) {
    console.error("[bkashCreate]", err.message);
    return res.status(500).json({ error: err.message || "bKash payment init failed." });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/recharge/bkash/callback
// bKash redirects here after user pays/cancels. No auth required (bKash hits it).
// ─────────────────────────────────────────────────────────────────────────────
export async function bkashCallback(req, res) {
  const { paymentID, status } = req.query;

  if (status === "cancel") {
    return res.redirect("/?recharge=cancelled");
  }
  if (status === "failure" || !paymentID) {
    return res.redirect("/?recharge=failed");
  }

  try {
    const result = await executeBkashPayment({ paymentID });

    if (result.transactionStatus !== "Completed") {
      // Update pending recharge to failed
      await Recharge.findOneAndUpdate(
        { transactionId: paymentID },
        { status: "failed", transactionId: result.trxID || paymentID }
      );
      return res.redirect(`/recharge?bkash_status=failed&msg=${encodeURIComponent(result.statusMessage || "Payment not completed")}`);
    }

    // Find the pending recharge doc
    const recharge = await Recharge.findOne({ transactionId: paymentID });
    if (!recharge) {
      return res.redirect("/recharge?bkash_status=failed&msg=Recharge+record+not+found");
    }

    // Mark recharge completed & update trxID
    recharge.status = "completed";
    recharge.transactionId = result.trxID;
    await recharge.save();

    // Credit user wallet
    const user = await User.findById(recharge.user);
    if (user) {
      user.balance += recharge.amount;
      await user.save();

      // Record transaction
      await Transaction.create({
        user: user._id,
        amount: recharge.amount,
        type: "credit",
        by: "bKash-PGW",
      });
    }

    return res.redirect(`/recharge?bkash_status=success&trxID=${result.trxID}&amount=${recharge.amount}`);
  } catch (err) {
    console.error("[bkashCallback]", err.message);
    return res.redirect(`/recharge?bkash_status=failed&msg=${encodeURIComponent(err.message)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/recharge/submit   (existing manual / fallback route — kept as-is)
// ─────────────────────────────────────────────────────────────────────────────
export async function submitRecharge(req, res) {
  const { amount, bKashNumber, transactionId } = req.body;
  if (!amount || !bKashNumber || !transactionId)
    return res.status(400).json({ error: "amount, bKashNumber, transactionId required" });
  try {
    const existingRecharge = await Recharge.findOne({ transactionId });
    if (existingRecharge) {
      return res.status(400).json({ error: "Transaction ID already exists" });
    }

    const recharge = await Recharge.create({
      id: `REF-${Date.now().toString().slice(-8)}`,
      user: req.user._id,
      amount,
      number: bKashNumber,
      method: "bKash",
      transactionId,
    });

    return res.status(200).json({ success: true, data: { recharge } });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export async function getRecharges(req, res) {
  try {
    const recharges = await Recharge.find({ user: req.user._id }).sort({ createdAt: -1 }) || [];
    return res.status(200).json({ recharges });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

export async function getTransactions(req, res) {
  try {
    const userId = req.user._id;
    const { limit = 5 } = req.query;
    const transactions = await Transaction.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean() || [];
    return res.status(200).json({
      transactions: transactions.map(t => ({
        id: t._id,
        amount: t.amount,
        type: t.type,
        by: t.by,
        createdAt: t.createdAt
      }))
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
