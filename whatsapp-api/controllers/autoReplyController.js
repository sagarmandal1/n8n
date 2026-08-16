import mongoose from "mongoose";
import AutoReply from "../models/autoReplyModel.js";
import Session from "../models/sessionModel.js";

// Get all rules for the user
export async function getRules(req, res) {
  try {
    const rules = await AutoReply.find({ user: req.user.id }).populate("session", "status apiKey _id");
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Add a new auto-reply rule
export async function addRule(req, res) {
  try {
    const { sessionId, keyword, replyText, matchType, mediaUrl, mediaType } = req.body;
    
    // Validate session ID format
    if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ error: "Invalid Session ID format" });
    }
    
    // Validate session
    const session = await Session.findOne({ _id: sessionId, user: req.user.id });
    if (!session) {
      return res.status(404).json({ error: "Session not found or not owned by you." });
    }

    const newRule = await AutoReply.create({
      user: req.user.id,
      session: sessionId,
      keyword,
      replyText,
      mediaUrl: mediaUrl || null,
      mediaType: mediaType || "none",
      matchType: matchType || "exact"
    });

    res.status(201).json(newRule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Delete a rule
export async function deleteRule(req, res) {
  try {
    const rule = await AutoReply.findOneAndDelete({ _id: req.params.id, user: req.user.id });
    if (!rule) {
      return res.status(404).json({ error: "Rule not found." });
    }
    res.json({ success: true, message: "Rule deleted successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Toggle rule active status
export async function toggleRule(req, res) {
  try {
    const rule = await AutoReply.findOne({ _id: req.params.id, user: req.user.id });
    if (!rule) return res.status(404).json({ error: "Rule not found." });
    
    rule.isActive = !rule.isActive;
    await rule.save();
    res.json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
