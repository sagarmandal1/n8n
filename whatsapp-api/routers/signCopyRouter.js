import { Router } from "express";
import {
  createSignAgent,
  createSignCustomer,
  getSignAgents,
  getSignCopyOverview,
  getSignCustomers,
  getSignCustomerRequests,
  getSignDocuments,
  getSignLedger,
  getSignOrders,
  getSignCopySettings,
  updateSignCopySettings,
  approveSignCustomerRequest,
  rejectSignCustomerRequest,
  blockSignCustomerRequest,
  retrySignOrder,
  signCustomerTransaction,
  updateSignAgent,
  updateSignCustomer,
  validateObjectIdParam,
} from "../controllers/signCopyController.js";

const signCopyRouter = Router();

signCopyRouter.param("id", validateObjectIdParam);

signCopyRouter.get("/overview", getSignCopyOverview);
signCopyRouter.get("/settings", getSignCopySettings);
signCopyRouter.put("/settings", updateSignCopySettings);

signCopyRouter.get("/customers", getSignCustomers);
signCopyRouter.post("/customers", createSignCustomer);
signCopyRouter.put("/customers/:id", updateSignCustomer);
signCopyRouter.post("/customers/:id/transaction", signCustomerTransaction);

signCopyRouter.get("/agents", getSignAgents);
signCopyRouter.post("/agents", createSignAgent);
signCopyRouter.put("/agents/:id", updateSignAgent);

signCopyRouter.get("/requests", getSignCustomerRequests);
signCopyRouter.post("/requests/:id/approve", approveSignCustomerRequest);
signCopyRouter.post("/requests/:id/reject", rejectSignCustomerRequest);
signCopyRouter.post("/requests/:id/block", blockSignCustomerRequest);

signCopyRouter.get("/orders", getSignOrders);
signCopyRouter.post("/orders/:id/retry", retrySignOrder);

signCopyRouter.get("/documents", getSignDocuments);
signCopyRouter.get("/ledger", getSignLedger);

export default signCopyRouter;
