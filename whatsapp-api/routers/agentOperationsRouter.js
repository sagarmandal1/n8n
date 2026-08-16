import { Router } from "express";
import {
  analyzeAgentRequest,
  getAgentContext,
  getAgentReviewQueue,
  getAgentServices,
  matchAgentDocument,
  saveAgentAudit,
  updateAgentService,
  verifyAgentPayment,
} from "../controllers/agentOperationsController.js";

const router = Router();

router.post("/analyze", analyzeAgentRequest);
router.post("/context", getAgentContext);
router.post("/document/match", matchAgentDocument);
router.post("/payment/verify", verifyAgentPayment);
router.get("/services", getAgentServices);
router.post("/services/search", getAgentServices);
router.put("/services/:code", updateAgentService);
router.post("/audit", saveAgentAudit);
router.get("/review-queue", getAgentReviewQueue);

export default router;
