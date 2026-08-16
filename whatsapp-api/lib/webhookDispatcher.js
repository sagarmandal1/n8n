import axios from "axios";
import crypto from "node:crypto";
import sessionModel from "../models/sessionModel.js";
import WebhookDelivery from "../models/webhookDeliveryModel.js";
import {
    assertSafeWebhookUrl,
    redactWebhookUrl,
    safeWebhookAgent,
} from "./webhookSecurity.js";

// Webhook event constants
export const WEBHOOK_EVENTS = {
    MESSAGE_RECEIVED: "message.received",
    MESSAGE_SENT: "message.sent",
    MESSAGE_STATUS: "message.status",
    MESSAGE_REACTION: "message.reaction",
    SESSION_CONNECTED: "session.connected",
    SESSION_DISCONNECTED: "session.disconnected",
    SESSION_QR_READY: "session.qr_ready",
    SESSION_RECONNECTING: "session.reconnecting",
    SESSION_LOGGED_OUT: "session.logged_out",
    CONNECTION_STATUS: "connection.status",
};

// WhatsApp may wrap media inside ephemeral/view-once containers. Keep the
// webhook payload consistent regardless of the wrapper used by the sender.
function unwrapMessageContent(messageContent = {}) {
    let content = messageContent || {};
    for (let i = 0; i < 3; i += 1) {
        const type = Object.keys(content)[0];
        if (!type || !["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2"].includes(type)) {
            return content;
        }
        content = content[type]?.message || {};
    }
    return content;
}

/**
 * Send webhook event to configured webhook URL
 * @param {string} sessionId - Session ID
 * @param {string} eventType - Event type constant from WEBHOOK_EVENTS
 * @param {object} data - Event data payload
 */
export async function dispatchWebhook(sessionId, eventType, data = {}) {
    let eventId = null;
    try {
        // Get session with webhook URL
        const session = await sessionModel
            .findById(sessionId)
            .select("webhookUrl user +webhookSecret");

        if (!session || !session.webhookUrl) {
            console.log(`No webhook configured for session ${sessionId}`);
            return;
        }

        const payload = {
            id: crypto.randomUUID(),
            event: eventType,
            timestamp: new Date().toISOString(),
            sessionId: sessionId.toString(),
            userId: session.user.toString(),
            data: data,
        };
        eventId = payload.id;

        const webhookUrl = await assertSafeWebhookUrl(session.webhookUrl);
        const secret = session.webhookSecret || process.env.WEBHOOK_SECRET;
        if (!secret) {
            throw new Error("Webhook signing secret is not configured");
        }

        await WebhookDelivery.create({
            eventId,
            session: session._id,
            user: session.user,
            event: eventType,
            endpoint: redactWebhookUrl(webhookUrl),
        });

        const result = await sendWebhookWithRetry(webhookUrl, payload, secret, 3);
        await WebhookDelivery.updateOne(
            { eventId },
            {
                $set: {
                    status: "delivered",
                    attempts: result.attempts,
                    httpStatus: result.status,
                    deliveredAt: new Date(),
                    lastError: "",
                },
            },
        );
        return result.data;
    } catch (error) {
        if (eventId) {
            await WebhookDelivery.updateOne(
                { eventId },
                {
                    $set: {
                        status: "failed",
                        attempts: error.webhookAttempts || 1,
                        httpStatus: error.response?.status || null,
                        lastError: String(error.message || "Webhook delivery failed").slice(0, 500),
                    },
                },
            ).catch(() => {});
        }
        console.error(`Webhook dispatch error for session ${sessionId}:`, error.message);
        // Don't throw - webhook failures should not break main flow
    }
}

/**
 * Send webhook with exponential backoff retry
 */
async function sendWebhookWithRetry(
    webhookUrl,
    payload,
    secret,
    maxAttempts = 3,
    attempt = 1
) {
    const body = JSON.stringify(payload);
    const signature = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;

    try {
        const response = await axios.post(webhookUrl, body, {
            timeout: 10000,
            maxRedirects: 0,
            httpsAgent: safeWebhookAgent,
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "WhatsApp-API-Webhook/1.0",
                "X-Webhook-Id": payload.id,
                "X-Webhook-Signature": signature,
                "X-Webhook-Secret": secret,
            },
        });

        if (response.status >= 200 && response.status < 300) {
            // console.log(`✅ Webhook sent successfully to ${webhookUrl}`);
            return { data: response.data, status: response.status, attempts: attempt };
        } else {
            throw new Error(`Webhook returned status ${response.status}`);
        }
    } catch (error) {
        const status = error.response?.status;
        const retryable = !status || status === 408 || status === 425 || status === 429 || status >= 500;
        if (retryable && attempt < maxAttempts) {
            const delay = Math.pow(2, attempt - 1) * 1000;
            console.warn(
                `Webhook failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms...`
            );

            await new Promise((resolve) => setTimeout(resolve, delay));
            return sendWebhookWithRetry(webhookUrl, payload, secret, maxAttempts, attempt + 1);
        }

        console.error(`Webhook delivery failed after ${attempt} attempt(s):`, error.message);
        await logFailedWebhook(webhookUrl, payload, error.message);
        error.webhookAttempts = attempt;
        throw error;
    }
}

/**
 * Log failed webhook attempts for debugging
 */
async function logFailedWebhook(url, payload, error) {
    try {
        console.error(`Failed webhook - URL: ${redactWebhookUrl(url)}, Error: ${error}`);
        // TODO: Store in database for manual retry/debugging
    } catch (e) {
        console.error("Error logging failed webhook:", e);
    }
}

/**
 * Dispatch message received event
 */
export async function onMessageReceived(sessionId, message, senderPhone, mediaUrl = undefined, location = undefined, contact = undefined, mediaMeta = undefined) {
    const msgContent = unwrapMessageContent(message.message || {});
    // Extract text from standard conversation, extended text, or media captions
    const captionOrText = 
        msgContent.conversation || 
        msgContent.extendedTextMessage?.text || 
        msgContent.imageMessage?.caption || 
        msgContent.videoMessage?.caption || 
        msgContent.documentMessage?.caption || 
        "";
    const ocrText = mediaMeta?.ocrText ? String(mediaMeta.ocrText).slice(0, 12000) : "";
    const extractedLabel = mediaMeta?.ocrMethod === "TRANSCRIPTION"
        ? "[Voice transcription]"
        : "[OCR extracted text]";
    const textMsg = [
        captionOrText,
        ocrText ? `\n\n${extractedLabel}\n${ocrText}` : "",
    ].filter(Boolean).join("");

    // Detect type of message (conversation, imageMessage, etc.)
    const msgType = Object.keys(msgContent)[0] || "text";

    // Extract reply contexts
    let quotedMessageId = null;
    if (msgContent[msgType] && msgContent[msgType].contextInfo) {
        quotedMessageId = msgContent[msgType].contextInfo.stanzaId || null;
    }

    const payload = {
        from: senderPhone,
        message: textMsg,
        messageId: message.key?.id,
        timestamp: message.messageTimestamp,
        type: msgType,
        quotedMessageId: quotedMessageId,
    participant: message.key?.participant || senderPhone,
  };

  if (mediaUrl) payload.mediaUrl = mediaUrl;
  if (mediaMeta?.mimeType) payload.mimeType = mediaMeta.mimeType;
  if (mediaMeta?.fileName) payload.fileName = mediaMeta.fileName;
  if (mediaMeta?.ocrText) payload.ocrText = String(mediaMeta.ocrText).slice(0, 12000);
  if (mediaMeta?.ocrMethod) payload.ocrMethod = mediaMeta.ocrMethod;
    if (location) payload.location = location;
    if (contact) payload.contact = contact;

    await dispatchWebhook(sessionId, WEBHOOK_EVENTS.MESSAGE_RECEIVED, payload);
}

/**
 * Dispatch message sent event
 */
export async function onMessageSent(sessionId, message, recipientPhone) {
    const msgContent = unwrapMessageContent(message?.message || {});
    const textMsg = 
        msgContent.conversation || 
        msgContent.extendedTextMessage?.text || 
        msgContent.imageMessage?.caption || 
        msgContent.videoMessage?.caption || 
        msgContent.documentMessage?.caption || 
        "";

    const msgType = Object.keys(msgContent)[0] || "text";

    await dispatchWebhook(sessionId, WEBHOOK_EVENTS.MESSAGE_SENT, {
        to: recipientPhone,
        message: textMsg,
        type: msgType,
        messageId: message?.key?.id || message?.id,
        timestamp: new Date().toISOString(),
        status: "sent",
    });
}

const statusCache = new Set();

/**
 * Dispatch message status update (sent/delivered/read)
 */
export async function onMessageStatusUpdate(sessionId, update) {
    // update.update.status corresponds to WAMessageStatus enum
    // 1=PENDING, 2=SERVER_ACK (sent), 3=DELIVERY_ACK (delivered), 4=READ, 5=PLAYED
    const statusMap = {
        0: "ERROR",
        1: "PENDING",
        2: "SENT",
        3: "DELIVERED",
        4: "READ",
        5: "PLAYED"
    };

    const statusText = statusMap[update.update?.status] || "UNKNOWN";
    const messageId = update.key?.id;

    // Clean device suffixes from numbers (e.g., 919330014767:46 -> 919330014767)
    const rawTo = update.key?.remoteJid?.replace(/@s.whatsapp.net|@g.us|@lid/, "") || "unknown";
    const to = rawTo.split(":")[0];

    // Build deduplication key to stop Multi-Device spam
    const cacheKey = `${sessionId}-${messageId}-${to}-${statusText}`;
    
    if (statusCache.has(cacheKey)) {
        return; // Ignore duplicate device receipt
    }
    statusCache.add(cacheKey);

    // Free memory after 15 mins
    setTimeout(() => statusCache.delete(cacheKey), 15 * 60 * 1000);

    await dispatchWebhook(sessionId, WEBHOOK_EVENTS.MESSAGE_STATUS, {
        messageId: messageId,
        to: to,
        status: statusText,
        statusCode: update.update?.status,
    });
}

/**
 * Dispatch message reaction
 */
export async function onMessageReaction(sessionId, reactionData, senderPhone) {
    await dispatchWebhook(sessionId, WEBHOOK_EVENTS.MESSAGE_REACTION, {
        messageId: reactionData.key?.id, // ID of the message being reacted to
        from: senderPhone,
        reaction: reactionData.text || "", // Emoji string
        timestamp: reactionData.senderTimestampMs,
    });
}

/**
 * Dispatch session connection event
 */
export async function onSessionConnected(sessionId, userInfo) {
    await dispatchWebhook(sessionId, WEBHOOK_EVENTS.SESSION_CONNECTED, {
        phoneNumber: userInfo?.id,
        name: userInfo?.name,
        status: "connected",
    });
}

/**
 * Dispatch session disconnection event
 */
export async function onSessionDisconnected(sessionId, reason) {
    await dispatchWebhook(sessionId, WEBHOOK_EVENTS.SESSION_DISCONNECTED, {
        reason: reason || "unknown",
        timestamp: new Date().toISOString(),
    });
}

/**
 * Dispatch QR ready event
 */
export async function onQRReady(sessionId, qrCode) {
    await dispatchWebhook(sessionId, WEBHOOK_EVENTS.SESSION_QR_READY, {
        qrCode: qrCode ? "data available" : null,
        status: "qr_ready",
    });
}

/**
 * Dispatch reconnecting event
 */
export async function onReconnecting(sessionId, attempt) {
    await dispatchWebhook(sessionId, WEBHOOK_EVENTS.SESSION_RECONNECTING, {
        attempt: attempt || 1,
        timestamp: new Date().toISOString(),
    });
}

/**
 * Dispatch logged out event
 */
export async function onLoggedOut(sessionId) {
    await dispatchWebhook(sessionId, WEBHOOK_EVENTS.SESSION_LOGGED_OUT, {
        reason: "user_logout",
        timestamp: new Date().toISOString(),
    });
}
