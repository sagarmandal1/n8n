import express from "express";
import {
  getSubscriptionList,
  getCurrentSubscription,
  purchaseSubscription,
  changeSubscription,
  cancelSubscription,
  renewSubscription,
  updateAutoRenew,
  getPaymentHistory,
  getFwSubscriptionList,
  getCurrentFwSubscription,
  purchaseFwSubscription
} from "../controllers/subscriptionController.js";
import {authenticate as protect} from "../middlewares/authMiddleware.js";

const router = express.Router();

// Public route — landing page pricing visible without login
router.get("/list", getSubscriptionList);
router.get("/current", protect, getCurrentSubscription);
router.post("/purchase", protect, purchaseSubscription);
router.post("/change", protect, changeSubscription);
router.post("/cancel", protect, cancelSubscription);
router.post("/renew", protect, renewSubscription);
router.post("/auto-renew", protect, updateAutoRenew);
router.get("/payments", protect, getPaymentHistory);

router.get("/fw-list", getFwSubscriptionList);
router.get("/fw-current", protect, getCurrentFwSubscription);
router.post("/purchase-fw", protect, purchaseFwSubscription);

export default router;