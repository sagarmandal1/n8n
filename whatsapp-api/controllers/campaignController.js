import mongoose from "mongoose";
import Campaign from "../models/campaignModel.js";
import CampaignContact from "../models/campaignContactModel.js";
import Session from "../models/sessionModel.js";

// Create a new campaign
export async function createCampaign(req, res) {
  try {
    const { sessionId, name, messageText, numbers, mediaUrl, mediaType } = req.body;
    const userId = req.user._id;

    if (!sessionId || !name || !messageText || !numbers || !numbers.length) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ error: "Invalid Session ID format" });
    }

    const session = await Session.findOne({ _id: sessionId, user: userId });
    if (!session) {
      return res.status(404).json({ error: "Session not found." });
    }

    // Filter and clean valid numbers
    const validNumbers = numbers
      .map(n => n.replace(/\D/g, ""))
      .filter(n => n.length >= 10);

    if (validNumbers.length === 0) {
      return res.status(400).json({ error: "No valid numbers provided." });
    }
    
    // Deduplicate array
    const uniqueNumbers = [...new Set(validNumbers)];

    const campaign = new Campaign({
      user: userId,
      session: sessionId,
      name,
      messageText,
      mediaUrl: mediaUrl || null,
      mediaType: mediaType || 'none',
      totalContacts: uniqueNumbers.length,
      status: "RUNNING"
    });

    await campaign.save();

    // Insert contacts efficiently
    const contacts = uniqueNumbers.map((phone) => ({
      campaign: campaign._id,
      phone,
      status: "PENDING"
    }));

    await CampaignContact.insertMany(contacts);

    return res.status(201).json({ success: true, campaign });
  } catch (error) {
    console.error("Create Campaign Error:", error);
    return res.status(500).json({ error: "Server error creating campaign." });
  }
}

// Get all campaigns for user
export async function getCampaigns(req, res) {
  try {
    const campaigns = await Campaign.find({ user: req.user._id })
      .populate('session', '_id status text')
      .sort({ createdAt: -1 });
    
    return res.json({ success: true, campaigns });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// Update status (e.g., Pause or Resume)
export async function updateCampaignStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const campaign = await Campaign.findOne({ _id: id, user: req.user._id });
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found." });
    }

    if (!["RUNNING", "PAUSED", "COMPLETED"].includes(status)) {
       return res.status(400).json({ error: "Invalid status" });
    }

    campaign.status = status;
    await campaign.save();

    return res.json({ success: true, campaign });
  } catch (error) {
     return res.status(500).json({ error: error.message });
  }
}

// Delete campaign and contacts entirely
export async function deleteCampaign(req, res) {
    try {
      const { id } = req.params;
      const campaign = await Campaign.findOne({ _id: id, user: req.user._id });
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });
      
      await CampaignContact.deleteMany({ campaign: campaign._id });
      await Campaign.findByIdAndDelete(campaign._id);
      
      return res.json({ success: true });
    } catch(err) {
      return res.status(500).json({ error: err.message });
    }
}
