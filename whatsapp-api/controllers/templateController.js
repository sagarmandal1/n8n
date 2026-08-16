import Template from "../models/templateModel.js";

// Get all templates for user
export async function getTemplates(req, res) {
  try {
    const templates = await Template.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, templates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Create new template
export async function createTemplate(req, res) {
  try {
    const { name, body, category, mediaUrl, mediaType } = req.body;
    if (!name || !body) return res.status(400).json({ error: "Name and body are required." });

    const template = await Template.create({
      user: req.user._id,
      name,
      body,
      category: category || "general",
      mediaUrl: mediaUrl || null,
      mediaType: mediaType || "none",
    });
    res.status(201).json({ success: true, template });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Update template
export async function updateTemplate(req, res) {
  try {
    const { id } = req.params;
    const { name, body, category, mediaUrl, mediaType } = req.body;
    const template = await Template.findOneAndUpdate(
      { _id: id, user: req.user._id },
      { name, body, category, mediaUrl, mediaType },
      { new: true }
    );
    if (!template) return res.status(404).json({ error: "Template not found." });
    res.json({ success: true, template });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Delete template
export async function deleteTemplate(req, res) {
  try {
    const { id } = req.params;
    const template = await Template.findOneAndDelete({ _id: id, user: req.user._id });
    if (!template) return res.status(404).json({ error: "Template not found." });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Increment usage count
export async function useTemplate(req, res) {
  try {
    const { id } = req.params;
    const template = await Template.findOneAndUpdate(
      { _id: id, user: req.user._id },
      { $inc: { usageCount: 1 } },
      { new: true }
    );
    if (!template) return res.status(404).json({ error: "Template not found." });
    res.json({ success: true, template });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
