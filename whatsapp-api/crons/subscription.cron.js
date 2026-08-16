import cron from "node-cron";
import User from "../models/userModel.js";
import subscriptions from "../json/subscription.js";
import Transaction from "../models/transactionModel.js";
import { sendUserAlert, getClient } from "../lib/whatsapp.js";
import sessionModel from "../models/sessionModel.js";
import ForwardedOrder from "../models/forwardedOrderModel.js";

const subscriptionCron = () => {
  // Run every day at 2 AM
  cron.schedule("0 2 * * *", async () => {
    console.log(
      "🔄 Subscription cron job started at",
      new Date().toISOString(),
    );

    try {
      const now = new Date();

      // Find users with active subscriptions that are about to expire (within 7 days)
      const expiringUsers = await User.find({
        "subscription.status": "active",
        "subscription.endDate": {
          $lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
          $gte: now,
        },
      });

      console.log(
        `Found ${expiringUsers.length} users with expiring subscriptions`,
      );

      // Send renewal reminders
      for (const user of expiringUsers) {
        const daysUntilExpiry = Math.ceil(
          (new Date(user.subscription.endDate) - now) / (1000 * 60 * 60 * 24),
        );

        console.log(
          `User ${user.email} subscription expires in ${daysUntilExpiry} days`,
        );

        // Here you would typically send email notifications
        // await sendRenewalReminder(user.email, daysUntilExpiry);
      }

      // Find users with expired subscriptions
      const expiredUsers = await User.find({
        "subscription.status": "active",
        "subscription.endDate": { $lt: now },
      });

      console.log(
        `Found ${expiredUsers.length} users with expired subscriptions`,
      );

      for (const user of expiredUsers) {
        const sub = user.subscription;
        const plan = subscriptions.plans.find((p) => p.id === sub.id);

        if (!plan) {
          user.subscription.status = "expired";
          await user.save();
          console.log(`⛔ Plan not found, expired: ${user.email}`);
          continue;
        }

        if (sub.autoRenew) {
          // Calculate renewal price
          let renewalPrice = plan.price;

          if (user.balance >= renewalPrice) {
            // Process auto-renewal
            user.balance -= renewalPrice;

            const newStart = sub.endDate;
            const newEnd = new Date(newStart);

            newEnd.setMonth(newEnd.getMonth() + 1);

            user.subscription = {
              ...user.subscription,
              startDate: newStart,
              endDate: newEnd,
              lastRenewal: now,
              status: "active",
            };

            // Record payment
            await Transaction.create({
              user: user._id,
              amount: renewalPrice,
              type: "debit",
              by: "subscription_auto_renewal",
            });

            await user.save();
            console.log(`✅ Auto-renewed: ${user.email}`);

            // Send renewal confirmation email
            // await sendRenewalConfirmation(user.email, plan.name, renewalPrice);
          } else {
            // Insufficient balance
            user.subscription.status = "expired";
            user.subscription.autoRenew = false;

            await user.save();
            console.log(`⛔ Insufficient balance, expired: ${user.email}`);

            // Send insufficient balance notification
            // await sendInsufficientBalanceNotification(user.email, plan.name, renewalPrice);
          }
        } else {
          // Auto-renew disabled
          user.subscription.status = "expired";
          await user.save();
          console.log(`⛔ Auto-renew disabled, expired: ${user.email}`);

          // Send expiration notification
          // await sendExpirationNotification(user.email, plan.name);
        }
      }
    } catch (err) {
      console.error("❌ Subscription cron error:", err.message);
      console.error(err.stack);
    }
  });

  // Forwarding Bot Subscription Expiry Checker - Run every hour
  cron.schedule("0 * * * *", async () => {
    console.log("🔄 Forwarding Bot Expiry Checker started...");
    try {
      const now = new Date();
      const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const usersToAlert = await User.find({
        "fwSubscription.status": "active",
        "fwSubscription.expiryAlertSent": { $ne: true },
        "fwSubscription.endDate": { $lte: in24Hours, $gte: now }
      });

      console.log(`[Expiry Checker] Found ${usersToAlert.length} users to alert.`);

      for (const user of usersToAlert) {
        const remainingHours = Math.ceil(
          (new Date(user.fwSubscription.endDate) - now) / (1000 * 60 * 60)
        );

        const alertMessage = `⚠️ *Forwarding Bot Subscription Alert* ⚠️\n\nYour forwarding bot subscription is expiring in ${remainingHours} hours.\n\nPlease renew your plan at the earliest to prevent any interruption in your forwarding service.`;
        
        const success = await sendUserAlert(user._id.toString(), alertMessage);
        if (success) {
          user.fwSubscription.expiryAlertSent = true;
          await user.save();
          console.log(`[Expiry Checker] Alert sent successfully to user: ${user.email}`);
        } else {
          console.log(`[Expiry Checker] Could not send alert to user: ${user.email} (No active WhatsApp sessions)`);
        }
      }

      // Automatically expire forwarding bot subscription if endDate has passed
      const expiredUsers = await User.find({
        "fwSubscription.status": "active",
        "fwSubscription.endDate": { $lt: now }
      });

      for (const user of expiredUsers) {
        user.fwSubscription.status = "expired";
        await user.save();
        console.log(`[Expiry Checker] Forwarding subscription expired for user: ${user.email}`);
      }

    } catch (err) {
      console.error("❌ Forwarding bot expiry cron error:", err.message);
    }
  });

  // Forwarding Bot Daily Activity Summary - Run every day at 10:00 PM (Asia/Dhaka timezone)
  cron.schedule("0 22 * * *", async () => {
    console.log("📊 Starting daily forwarding summary cron job (10 PM BD Time)...");
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    
    try {
      const endOfPeriod = new Date();
      const startOfPeriod = new Date(endOfPeriod.getTime() - 24 * 60 * 60 * 1000);

      const activeFwUsers = await User.find({
        "fwSubscription.status": "active"
      });

      for (const user of activeFwUsers) {
        // Implement random delay between 5 to 20 seconds to prevent bot detection
        const randomDelay = Math.floor(Math.random() * (20000 - 5000 + 1) + 5000);
        await sleep(randomDelay);

        const sessions = await sessionModel.find({ user: user._id });
        const sessionIds = sessions.map(s => s._id);

        if (sessionIds.length === 0) continue;

        // Query all logs of today for this user
        const logs = await ForwardedOrder.find({
          session: { $in: sessionIds },
          createdAt: { $gte: startOfPeriod, $lt: endOfPeriod }
        });

        if (logs.length === 0) continue;

        const total = logs.length;
        const resolved = logs.filter(l => l.status === "RESOLVED").length;
        const rejected = logs.filter(l => l.status === "REJECTED").length;
        const pending = logs.filter(l => l.status === "PENDING").length;

        // Send consolidated summary to user JID
        const formatOptions = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Dhaka" };
        const startStr = startOfPeriod.toLocaleString("en-US", formatOptions);
        const endStr = endOfPeriod.toLocaleString("en-US", formatOptions);

        const summaryMessage = `📊 *Forwarding Bot Daily Summary* 📊\nPeriod: *${startStr}* to *${endStr}* (BD Time)\n\nHere is a summary of your forwarding activities:\n\n📩 Total Orders: *${total}*\n✅ Resolved: *${resolved}*\n❌ Rejected: *${rejected}*\n⏳ Pending: *${pending}*\n\nThank you for using our service!`;
        await sendUserAlert(user._id.toString(), summaryMessage);

        // Send delivery count summaries to the respective Targets
        for (const session of sessions) {
          const sessionLogs = logs.filter(l => l.session.toString() === session._id.toString());
          const sessionResolved = sessionLogs.filter(l => l.status === "RESOLVED").length;

          if (sessionResolved > 0 && session.forwardingTarget) {
            const targetMessage = `📊 *Forwarding Delivery Summary* 📊\nPeriod: *${startStr}* to *${endStr}* (BD Time)\n\nYou have successfully delivered: *${sessionResolved}* order files today.\n\nThank you for your hard work!`;
            
            try {
              const client = await getClient(user._id.toString(), session._id.toString());
              if (client && client.connected && client.sock) {
                await client.sock.sendMessage(session.forwardingTarget, { text: targetMessage });
                console.log(`[Daily Summary] Sent delivery summary to target ${session.forwardingTarget} for session ${session._id}`);
              }
            } catch (targetErr) {
              console.error(`Failed to send summary to target for session ${session._id}:`, targetErr.message);
            }
          }
        }
      }
    } catch (err) {
      console.error("❌ Daily summary cron error:", err.message);
    }
  }, {
    timezone: "Asia/Dhaka"
  });
};

export default subscriptionCron;
