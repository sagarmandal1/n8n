import { sendMessage, getGroupList } from "../lib/whatsapp.js";
import sessionModel from "../models/sessionModel.js";
import fs from "fs/promises";

/**
 * Send a text message via API key
 */
export async function sendText(req, res) {
  try {
    const apiKey = req.headers["x-api-key"];

    if (!apiKey) {
      return res.status(400).json({ error: "x-api-key header required" });
    }

    const session = await sessionModel.findOne({ apiKey });
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const { number, message, group } = req.body;
    if ((!number && !group) || !message) {
      return res.status(400).json({ error: "number and message are required" });
    }

    const isGroup = group ? true : false;

    const result = await sendMessage(
      session.user,
      session._id,
      number || group,
      {
        text: message,
      },
      isGroup,
    );

    return res.json({
      success: true,
      message: result || null,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
export async function sendLocation(req, res) {
  try {
    const apiKey = req.headers["x-api-key"];

    if (!apiKey) {
      return res.status(400).json({ error: "x-api-key header required" });
    }

    const session = await sessionModel.findOne({ apiKey });
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const { number, group, location } = req.body;
    if (
      (!number && !group) ||
      !location.degreesLatitude ||
      !location.degreesLongitude
    ) {
      return res.status(400).json({ error: "number and message are required" });
    }

    const isGroup = group ? true : false;

    const result = await sendMessage(
      session.user,
      session._id,
      number || group,
      {
        location,
      },
      isGroup,
    );

    return res.json({
      success: true,
      message: result || null,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
export async function sendPhoto(req, res) {
  try {
    const apiKey = req.headers["x-api-key"];

    if (!apiKey) {
      return res.status(400).json({ error: "x-api-key header required" });
    }

    const session = await sessionModel.findOne({ apiKey });
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const { number, group, caption, viewOnce = false } = req.body;

    if (!number && !group) {
      return res.status(400).json({ error: "number or group is required" });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No images uploaded" });
    }

    const jid = number || group;
    const isGroup = Boolean(group);

    const processUploads = async () => {
      for (const file of req.files) {
        try {
          if (!file.mimetype.startsWith("image/")) continue;
          await sendMessage(
            session.user,
            session._id,
            jid,
            {
              image: { url: file.path },
              caption: caption || "",
              viewOnce,
            },
            isGroup,
          );
        } catch (err) {
          console.error("Error sending photo in background:", err);
        } finally {
          try { await fs.unlink(file.path); } catch (e) {}
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    };
    processUploads();

    return res.json({
      success: true,
      message: "Processing media uploads in background",
      queued: req.files.length,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
export async function sendVideo(req, res) {
  try {
    const apiKey = req.headers["x-api-key"];
    if (!apiKey) {
      return res.status(400).json({ error: "x-api-key header required" });
    }

    const session = await sessionModel.findOne({ apiKey });
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const { number, group, caption, gif = false, viewOnce = false } = req.body;

    if (!number && !group) {
      return res.status(400).json({ error: "number or group is required" });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No videos uploaded" });
    }

    const jid = number || group;
    const isGroup = Boolean(group);
    const processUploads = async () => {
      for (const file of req.files) {
        try {
          if (!file.mimetype.startsWith("video/")) continue;
          await sendMessage(
            session.user,
            session._id,
            jid,
            {
              video: { url: file.path },
              caption: caption || "",
              gifPlayback: gif,
              viewOnce,
            },
            isGroup,
          );
        } catch (err) {
          console.error("Error sending video in background:", err);
        } finally {
          try { await fs.unlink(file.path); } catch (e) {}
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    };
    processUploads();

    return res.json({
      success: true,
      message: "Processing video uploads in background",
      queued: req.files.length,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
export async function sendAudio(req, res) {
  try {
    const apiKey = req.headers["x-api-key"];
    if (!apiKey) {
      return res.status(400).json({ error: "x-api-key header required" });
    }

    const session = await sessionModel.findOne({ apiKey });
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const { number, group, voice = false } = req.body;

    if (!number && !group) {
      return res.status(400).json({ error: "number or group is required" });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No audio files uploaded" });
    }

    const jid = number || group;
    const isGroup = Boolean(group);
    const processUploads = async () => {
      for (const file of req.files) {
        try {
          if (!file.mimetype.startsWith("audio/")) continue;
          await sendMessage(
            session.user,
            session._id,
            jid,
            {
              audio: { url: file.path },
              mimetype: file.mimetype,
              ptt: voice === true,
            },
            isGroup,
          );
        } catch (err) {
          console.error("Error sending audio in background:", err);
        } finally {
          try { await fs.unlink(file.path); } catch (e) {}
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    };
    processUploads();

    return res.json({
      success: true,
      message: "Processing audio uploads in background",
      queued: req.files.length,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
export async function sendFile(req, res) {
  try {
    const apiKey = req.headers["x-api-key"];
    if (!apiKey) {
      return res.status(400).json({ error: "x-api-key header required" });
    }

    const session = await sessionModel.findOne({ apiKey });
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const { number, group, caption } = req.body;

    if (!number && !group) {
      return res.status(400).json({ error: "number or group is required" });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const jid = number || group;
    const isGroup = Boolean(group);
    const processUploads = async () => {
      for (const file of req.files) {
        try {
          await sendMessage(
            session.user,
            session._id,
            jid,
            {
              document: { url: file.path },
              mimetype: file.mimetype,
              fileName: file.originalname,
              caption: caption || "",
            },
            isGroup,
          );
        } catch (err) {
          console.error("Error sending file in background:", err);
        } finally {
          try { await fs.unlink(file.path); } catch (e) {}
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    };
    processUploads();

    return res.json({
      success: true,
      message: "Processing file uploads in background",
      queued: req.files.length,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
export async function giveReaction(req, res) {
  try {
    const apiKey = req.headers["x-api-key"];
    const { number, group, messageKey, emoji } = req.body;

    if (!apiKey) return res.status(400).json({ error: "x-api-key required" });
    if (!messageKey)
      return res.status(400).json({ error: "messageKey required" });
    if (!number && !group)
      return res.status(400).json({ error: "number or group required" });

    const session = await sessionModel.findOne({ apiKey });
    if (!session) return res.status(404).json({ error: "Session not found" });

    const jid = number || group;
    const isGroup = Boolean(group);

    await sendMessage(
      session.user,
      session._id,
      jid,
      {
        react: {
          text: emoji || "",
          key: messageKey,
        },
      },
      isGroup,
    );

    return res.json({ success: true, message: "Reaction sent" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
export async function sendPoll(req, res) {
  try {
    const apiKey = req.headers["x-api-key"];
    const {
      number,
      group,
      name,
      values,
      selectableCount = 1,
      toAnnouncementGroup = false,
    } = req.body;

    if (!apiKey) return res.status(400).json({ error: "x-api-key required" });
    if (
      (!number && !group) ||
      !name ||
      !values ||
      !Array.isArray(values) ||
      values.length < 2
    ) {
      return res.status(400).json({
        error: "number/group, name, and at least 2 values are required",
      });
    }

    const session = await sessionModel.findOne({ apiKey });
    if (!session) return res.status(404).json({ error: "Session not found" });

    const jid = number || group;
    const isGroup = Boolean(group);

    const result = await sendMessage(
      session.user,
      session._id,
      jid,
      {
        poll: {
          name,
          values,
          selectableCount,
          toAnnouncementGroup,
        },
      },
      isGroup,
    );

    return res.json({ success: true, message: "Poll sent", result });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
export async function deleteMessage(req, res) {
  try {
    const apiKey = req.headers["x-api-key"];
    const { number, group, messageKey } = req.body;

    if (!apiKey) return res.status(400).json({ error: "x-api-key required" });
    if (!messageKey)
      return res.status(400).json({ error: "messageKey required" });
    if (!number && !group)
      return res.status(400).json({ error: "number or group required" });

    const session = await sessionModel.findOne({ apiKey });
    if (!session) return res.status(404).json({ error: "Session not found" });

    const jid = number || group;
    const isGroup = Boolean(group);

    await sendMessage(
      session.user,
      session._id,
      jid,
      {
        delete: messageKey,
      },
      isGroup,
    );

    return res.json({ success: true, message: "Message deleted" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
export async function getGroups(req, res) {
  try {
    const apiKey = req.headers["x-api-key"];

    if (!apiKey) {
      return res.status(400).json({ error: "x-api-key header required" });
    }

    const session = await sessionModel.findOne({ apiKey });
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    const groups = await getGroupList(session.user, session._id);
    const writableGroups = Object.entries(groups)
      // Delivery targets must be ordinary groups. Exclude WhatsApp
      // Communities, even when the account technically can post there.
      .filter(([, group]) => group.canWrite === true && group.isCommunity !== true)
      .map(([id, group]) => ({
        id,
        subject: group.subject || "",
        canWrite: true,
        isAdmin: group.isAdmin === true,
        myRole: group.myRole || "member",
        announce: group.announce === true,
        isCommunity: group.isCommunity === true,
      }));
    return res.json({ groups, writableGroups });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ error: error.message });
  }
}
