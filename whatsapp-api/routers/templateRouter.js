import { Router } from "express";
import mongoose from "mongoose";
import { getTemplates, createTemplate, updateTemplate, deleteTemplate, useTemplate } from "../controllers/templateController.js";
import signCopyRouter from "./signCopyRouter.js";
import { requireFwSubscriptionActive } from "../middlewares/fwSubscriptionMiddleware.js";

const templateRouter = Router();

templateRouter.param("id", (req, res, next, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid ID format" });
  }
  next();
});

templateRouter.use("/signcopy", requireFwSubscriptionActive, signCopyRouter);

templateRouter.get("/", getTemplates);
templateRouter.post("/", createTemplate);
templateRouter.put("/:id", updateTemplate);
templateRouter.delete("/:id", deleteTemplate);
templateRouter.post("/:id/use", useTemplate);

export default templateRouter;
