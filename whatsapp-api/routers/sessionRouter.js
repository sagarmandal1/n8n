import { Router } from "express";
import {
  getQR,
  newSession,
  getStatus,
  sendMessage,
  getMyInfo,
  logoutSession,
  getSessionList,
  getPairCode,
  deleteSession,
  setWebhook,
  getWebhookConfig,
  rotateWebhookSecret,
  getWebhookDeliveries,
  setFallback,
  setHistory,
  setAiSettings,
  getAnalytics,
  getInbox,
  getConversation,
  setForwarding,
  setUndelivered,
  getForwardingHistory,
  getForwardingStats,
  getDashboardStats,
  setVendors,
  getVendorConfig,
} from "../controllers/sessionController.js";

import mongoose from "mongoose";

const sessionRouter = Router();

sessionRouter.param("sessionId", (req, res, next, sessionId) => {
  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    return res.status(400).json({ error: "Invalid Session ID format" });
  }
  next();
});

sessionRouter.post("/new", newSession);
sessionRouter.get("/list", getSessionList);
sessionRouter.get("/analytics", getAnalytics);
sessionRouter.get("/inbox", getInbox);
sessionRouter.get("/inbox/conversation", getConversation);
sessionRouter.get("/forwarding/history", getForwardingHistory);
sessionRouter.get("/forwarding/stats", getForwardingStats);
sessionRouter.get("/dashboard/stats", getDashboardStats);
sessionRouter.get("/:sessionId/qr", getQR);
sessionRouter.post("/:sessionId/pairCode", getPairCode);

sessionRouter.get("/:sessionId/status", getStatus);
sessionRouter.post("/:sessionId/send", sendMessage);
sessionRouter.get("/:sessionId/info", getMyInfo);
sessionRouter.post("/:sessionId/logout", logoutSession);
sessionRouter.post("/:sessionId/delete", deleteSession);
sessionRouter.post("/:sessionId/set-webhook", setWebhook);
sessionRouter.get("/:sessionId/webhook", getWebhookConfig);
sessionRouter.post("/:sessionId/webhook/rotate-secret", rotateWebhookSecret);
sessionRouter.get("/:sessionId/webhook/deliveries", getWebhookDeliveries);
sessionRouter.post("/:sessionId/set-fallback", setFallback);
sessionRouter.post("/:sessionId/set-ai", setAiSettings);
sessionRouter.post("/:sessionId/set-forwarding", setForwarding);
sessionRouter.post("/:sessionId/set-undelivered", setUndelivered);
sessionRouter.post("/:sessionId/set-vendors", setVendors);
sessionRouter.get("/:sessionId/vendors", getVendorConfig);
sessionRouter.get("/:sessionId/message-history", setHistory);

export default sessionRouter;
