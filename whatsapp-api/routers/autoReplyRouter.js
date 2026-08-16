import express from "express";
import mongoose from "mongoose";
import { getRules, addRule, deleteRule, toggleRule } from "../controllers/autoReplyController.js";

const autoReplyRouter = express.Router();

autoReplyRouter.param("id", (req, res, next, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid ID format" });
  }
  next();
});

autoReplyRouter.get("/", getRules);
autoReplyRouter.post("/", addRule);
autoReplyRouter.put("/:id/toggle", toggleRule);
autoReplyRouter.delete("/:id", deleteRule);

export default autoReplyRouter;
