import { Router } from "express";
import mongoose from "mongoose";
import {
  getDashboardStats, getUsers, updateUserStatus, addBalance, exportUsersCSV,
  getSettings, updateSettings, getRevenueStats, getRevenueChart,
  getAdminInbox, getAllSessions, deleteSession, disconnectSession,
  getAllCampaigns, getSubscriptionPlans, createPlan, updatePlan, deletePlan,
  getAnnouncements, createAnnouncement, deleteAnnouncement, getActiveAnnouncements,
  getCoupons, createCoupon, deleteCoupon, toggleCoupon,
  getAllAutoReplies, getApiUsage, getAuditLogs, getSystemInfo,
} from "../controllers/adminController.js";

const adminRouter = Router();

adminRouter.param("id", (req, res, next, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid ID format" });
  }
  next();
});

adminRouter.param("planId", (req, res, next, planId) => {
  if (!mongoose.Types.ObjectId.isValid(planId)) {
    return res.status(400).json({ error: "Invalid Plan ID format" });
  }
  next();
});

// Dashboard
adminRouter.get("/stats",                getDashboardStats);
adminRouter.get("/system",               getSystemInfo);

// Revenue
adminRouter.get("/revenue",              getRevenueStats);
adminRouter.get("/revenue/chart",        getRevenueChart);

// Users
adminRouter.get("/users",                getUsers);
adminRouter.get("/users/export",         exportUsersCSV);
adminRouter.patch("/users/:id/status",   updateUserStatus);
adminRouter.post("/users/:id/balance",   addBalance);

// Sessions
adminRouter.get("/sessions",             getAllSessions);
adminRouter.delete("/sessions/:id",      deleteSession);
adminRouter.post("/sessions/:id/disconnect", disconnectSession);

// Campaigns
adminRouter.get("/campaigns",            getAllCampaigns);

// Inbox
adminRouter.get("/inbox",                getAdminInbox);

// Subscription Plans
adminRouter.get("/plans",                getSubscriptionPlans);
adminRouter.post("/plans",               createPlan);
adminRouter.put("/plans/:planId",        updatePlan);
adminRouter.delete("/plans/:planId",     deletePlan);

// Settings
adminRouter.get("/settings",             getSettings);
adminRouter.put("/settings",             updateSettings);

// Announcements
adminRouter.get("/announcements",        getAnnouncements);
adminRouter.post("/announcements",       createAnnouncement);
adminRouter.delete("/announcements/:id", deleteAnnouncement);

// Coupons
adminRouter.get("/coupons",              getCoupons);
adminRouter.post("/coupons",             createCoupon);
adminRouter.delete("/coupons/:id",       deleteCoupon);
adminRouter.patch("/coupons/:id/toggle", toggleCoupon);

// Chatbot Rules
adminRouter.get("/autoreplies",          getAllAutoReplies);

// API Usage
adminRouter.get("/usage",                getApiUsage);

// Audit Log
adminRouter.get("/audit",               getAuditLogs);

export default adminRouter;
