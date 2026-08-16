import { Router } from "express";
import {
  createCampaign,
  getCampaigns,
  updateCampaignStatus,
  deleteCampaign
} from "../controllers/campaignController.js";

import mongoose from "mongoose";

const campaignRouter = Router();

campaignRouter.param("id", (req, res, next, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid ID format" });
  }
  next();
});

// Endpoints (Assuming `authenticate` middleware is mounted on parent `/api/campaign`)
campaignRouter.post("/", createCampaign);
campaignRouter.get("/", getCampaigns);
campaignRouter.put("/:id/status", updateCampaignStatus);
campaignRouter.delete("/:id", deleteCampaign);

export default campaignRouter;
