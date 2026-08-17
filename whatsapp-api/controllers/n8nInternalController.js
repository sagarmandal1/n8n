import crypto from "crypto";
import { sendMessage } from "../lib/whatsapp.js";
import sessionModel from "../models/sessionModel.js";

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));

  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

export async function n8nSendText(req, res) {
  try {
    const suppliedSecret = req.headers["x-n8n-secret"];
    const expectedSecret = process.env.N8N_INTERNAL_SECRET;

    if (!expectedSecret) {
      console.error("N8N_INTERNAL_SECRET is not configured");
      return res.status(500).json({
        error: "Internal n8n authentication is not configured",
      });
    }

    if (!safeEqual(suppliedSecret, expectedSecret)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { sessionId, number, message } = req.body || {};

    if (!sessionId || !number || !message) {
      return res.status(400).json({
        error: "sessionId, number and message are required",
      });
    }

    const session = await sessionModel.findById(sessionId);

    if (!session) {
      return res.status(404).json({
        error: "Session not found",
      });
    }

    const cleanNumber = String(number).trim();
    const cleanMessage = String(message).trim();

    if (!cleanNumber || !cleanMessage) {
      return res.status(400).json({
        error: "number and message cannot be empty",
      });
    }

    const result = await sendMessage(
      session.user,
      session._id,
      cleanNumber,
      {
        text: cleanMessage,
      },
      false,
    );

    return res.json({
      success: true,
      sessionId: session._id.toString(),
      message: result || null,
    });
  } catch (error) {
    console.error("n8n internal send error:", error);
    return res.status(500).json({
      error: error.message || "Failed to send WhatsApp message",
    });
  }
}
