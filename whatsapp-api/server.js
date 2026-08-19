import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";
import { RateLimiterMemory } from "rate-limiter-flexible";

process.on("uncaughtException", (err) => {
  console.error("🔥 Uncaught Exception:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("🔥 Unhandled Rejection:", err);
});

//env config
import "dotenv/config";

import authRouter from "./routers/authRouter.js";
import connectDB from "./lib/mongodb.js";
import { authenticate, isAdmin } from "./middlewares/authMiddleware.js";
import { requireFwSubscriptionActive } from "./middlewares/fwSubscriptionMiddleware.js";
import sessionRouter from "./routers/sessionRouter.js";
import whatsappRouter from "./routers/whatsappRouter.js";
import subscriptionRouter from "./routers/subscriptionRouter.js";
import autoReplyRouter from "./routers/autoReplyRouter.js";
import campaignRouter from "./routers/campaignRouter.js";
import adminRouter from "./routers/adminRouter.js";
import uploadRouter from "./routers/uploadRouter.js";
import templateRouter from "./routers/templateRouter.js";
import startCrons from "./crons/index.js";
import { subscriptionMiddleware } from "./middlewares/subscriptionMiddleware.js";
import rechargeRouter from "./routers/rechargeRouter.js";
import profileRouter from "./routers/profileRouter.js";
import { getSubscriptionList } from "./controllers/subscriptionController.js";
import Session from "./models/sessionModel.js";
import { startCampaignQueue } from "./lib/campaignQueue.js";
import { initSession, closeAllSessions } from "./lib/whatsapp.js";
import agentOperationsRouter from "./routers/agentOperationsRouter.js";
import { n8nSendText } from "./controllers/n8nInternalController.js";
import ocrTestRouter from "./routers/ocrTestRouter.js";
import ocrLensRouter from "./routers/ocrLensRouter.js";

const app = express();
await connectDB();

// Restore active sessions so inbound events keep flowing after server restarts.
const sessionsToRestore = await Session.find(
  { status: { $in: ["CONNECTED", "RECONNECTING"] } },
  "_id user",
).lean();

for (const s of sessionsToRestore) {
  try {
    await Promise.race([
      initSession(String(s.user), String(s._id)),
      new Promise((_, reject) => setTimeout(() => reject(new Error("session restore timeout")), 20000)),
    ]);
    console.log(`♻️ Session restored: ${s._id}`);
  } catch (error) {
    console.error(`Failed to restore session ${s._id}:`, error.message);
  }
}

// Load dashboard-managed vendors before any message is handled, so a vendor
// added through the UI is recognised immediately after a restart.
try {
  const { setDbVendors } = await import("./lib/vendorList.js");
  const withVendors = await Session.find({}, "vendorNumbers").lean();
  setDbVendors(withVendors.flatMap((entry) => entry.vendorNumbers || []));
} catch (error) {
  console.error("Failed to preload dashboard vendors:", error.message);
}

// 🔥 Start all cron jobs
startCrons();
startCampaignQueue();

const PORT = process.env.PORT || 3000;

let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Shutdown] ${signal}: closing WhatsApp sockets before exit`);
  try {
    await closeAllSessions();
  } finally {
    process.exit(0);
  }
};
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(helmet({ contentSecurityPolicy: false })); // Disabled CSP to not break local views

const rateLimiter = new RateLimiterMemory({
  points: 100, // 100 requests per IP
  duration: 60, // per 60 seconds
});
app.use((req, res, next) => {
  rateLimiter
    .consume(req.ip)
    .then(() => next())
    .catch(() => res.status(429).json({ error: "Too Many Requests" }));
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(cors({ origin: "*" })); // Should ideally be restricted to trusted domains in production
app.use(morgan("dev"));
app.use(cookieParser());

/* ───────── API ───────── */
app.use("/api/auth", authRouter);
app.use("/api/session", authenticate, sessionRouter);

// Private server-to-server endpoint for n8n
app.post("/api/internal/n8n/send/text", n8nSendText);
app.use("/api/ocr-test", ocrTestRouter);
app.use("/api/ocr-lens-test", ocrLensRouter);
app.use("/api/whatsapp", subscriptionMiddleware, whatsappRouter);
app.use("/api/agent", subscriptionMiddleware, agentOperationsRouter);
app.use("/api/autoreply", authenticate, autoReplyRouter);
app.use("/api/campaign", authenticate, campaignRouter);
// Public: plan list visible on landing page without login
app.get("/api/subscription/list", getSubscriptionList);
// Protected: all other subscription routes
app.use("/api/subscription", authenticate, subscriptionRouter);
app.use("/api/recharge", authenticate, rechargeRouter);
app.use("/api/profile", authenticate, profileRouter);
app.use("/api/template", authenticate, templateRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/admin", authenticate, isAdmin, adminRouter);

// Public announcements endpoint (for user dashboard)
import { getActiveAnnouncements } from "./controllers/adminController.js";
app.get("/api/announcements", authenticate, getActiveAnnouncements);

app.get("/", async (req, res) => {
  // If logged in → redirect to dashboard; guests → show landing page
  const token = req.cookies?.token;
  if (token) {
    try {
      const { default: jwt } = await import("jsonwebtoken");
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded?.role === "admin") return res.redirect("/admin");
      return res.redirect("/sessions");
    } catch (_) {
      // Invalid/expired token — show landing page
    }
  }
  res.sendFile(path.join(__dirname, "views", "index.html"));
});
app.get("/doc", (req, res) =>
  res.sendFile(path.join(__dirname, "views", "api-doc.html")),
);
app.get("/login", authenticate, (req, res) => {
  if (req.user) {
    if (req.user.role === "admin") return res.redirect("/admin");
    return res.redirect("/sessions");
  } else {
    res.sendFile(path.join(__dirname, "views", "login.html"));
  }
});

app.get("/register", authenticate, (req, res) => {
  if (req.user) {
    if (req.user.role === "admin") return res.redirect("/admin");
    return res.redirect("/sessions");
  } else {
    res.sendFile(path.join(__dirname, "views", "register.html"));
  }
});

app.get("/sessions", authenticate, (req, res) => {
  if (!req.user) return res.redirect("/login");
  if (req.user.role === "admin") return res.redirect("/admin");
  res.sendFile(path.join(__dirname, "views", "sessions.html"));
});
app.get("/recharge", authenticate, (req, res) => {
  if (!req.user) return res.redirect("/login");
  if (req.user.role === "admin") return res.redirect("/admin");
  res.sendFile(path.join(__dirname, "views", "recharge.html"));
});
app.get("/recharge/history", authenticate, (req, res) => {
  if (!req.user) return res.redirect("/login");
  if (req.user.role === "admin") return res.redirect("/admin");
  res.sendFile(path.join(__dirname, "views", "history/recharge.html"));
});
app.get("/message/history", authenticate, (req, res) => {
  if (!req.user) return res.redirect("/login");
  if (req.user.role === "admin") return res.redirect("/admin");
  res.sendFile(path.join(__dirname, "views", "history/message.html"));
});
app.get("/forwarding/history", authenticate, (req, res) => {
  if (!req.user) return res.redirect("/login");
  if (req.user.role === "admin") return res.redirect("/admin");
  res.sendFile(path.join(__dirname, "views", "history/forwarding.html"));
});
app.get("/profile", authenticate, (req, res) => {
  if (!req.user) return res.redirect("/login");
  if (req.user.role === "admin") return res.redirect("/admin");
  res.sendFile(path.join(__dirname, "views", "profile.html"));
});
app.get("/subscriptions", authenticate, (req, res) => {
  if (!req.user) return res.redirect("/login");
  if (req.user.role === "admin") return res.redirect("/admin");
  res.sendFile(path.join(__dirname, "views", "subscriptions.html"));
});

app.get("/chatbot", authenticate, (req, res) => {
  if (!req.user) return res.redirect("/login");
  if (req.user.role === "admin") return res.redirect("/admin");
  res.sendFile(path.join(__dirname, "views", "chatbot.html"));
});

app.get("/campaigns", authenticate, (req, res) => {
  if (!req.user) return res.redirect("/login");
  if (req.user.role === "admin") return res.redirect("/admin");
  res.sendFile(path.join(__dirname, "views", "campaigns.html"));
});

app.get("/admin", authenticate, isAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "views", "admin", "dashboard.html"));
});

app.get("/admin/revenue", authenticate, isAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, "views", "admin", "revenue.html"));
});

app.get("/inbox", authenticate, (req, res) => {
  if (!req.user) return res.redirect("/login");
  if (req.user.role === "admin") return res.redirect("/admin");
  res.sendFile(path.join(__dirname, "views", "inbox.html"));
});

app.get("/templates", authenticate, (req, res) => {
  if (!req.user) return res.redirect("/login");
  if (req.user.role === "admin") return res.redirect("/admin");
  if (req.query?.module === "signcopy") {
    return requireFwSubscriptionActive(req, res, () =>
      res.sendFile(path.join(__dirname, "views", "signcopy.html")),
    );
  }
  res.sendFile(path.join(__dirname, "views", "templates.html"));
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("🔥 Global Error Handler:", err);
  if (err.name === "CastError") {
    return res.status(400).json({ success: false, error: `Invalid ${err.path || "ID"} format` });
  }
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    error: err.message || "Internal server error"
  });
});

app.listen(PORT, async () => {
  console.log(`🚀 Express Server running → http://localhost:${PORT}`);
});
