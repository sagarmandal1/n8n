import { Router } from "express";
import {
  getRecharges,
  getTransactions,
  submitRecharge,
  bkashCreate,
  bkashCallback,
} from "../controllers/rechargeController.js";
import { authenticate } from "../middlewares/authMiddleware.js";

const rechargeRouter = Router();

// ── Manual submit (kept as fallback) ──────────────────────────────────────
rechargeRouter.post("/submit", submitRecharge);

// ── bKash Automated PGW ────────────────────────────────────────────────────
// Step 1: Frontend calls this → returns bkashURL
rechargeRouter.post("/bkash/create", bkashCreate);

// Step 2: bKash redirects here after payment (no auth – bKash hits it externally)
rechargeRouter.get("/bkash/callback", bkashCallback);

// ── History ────────────────────────────────────────────────────────────────
rechargeRouter.get("/history", getRecharges);
rechargeRouter.get("/transactions", getTransactions);

export default rechargeRouter;