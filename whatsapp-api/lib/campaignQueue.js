import Campaign from "../models/campaignModel.js";
import CampaignContact from "../models/campaignContactModel.js";
import { sendMessage, getClientForMsg, buildMediaPayload } from "./whatsapp.js";

const MIN_DELAY_MS = 10000; // 10 seconds
const MAX_DELAY_MS = 25000; // 25 seconds

// A lock to prevent multiple poll cycles running simultaneously
let isProcessing = false;

// Helper to sleep
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// Randomizer
const getRandomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

export async function processCampaignQueue() {
    if (isProcessing) return;
    isProcessing = true;

    try {
        // Find *one* campaign that is currently running
        const campaign = await Campaign.findOne({ status: "RUNNING" }).populate('session');
        if (!campaign) {
            isProcessing = false;
            return;
        }

        // Find *one* pending contact for this campaign
        const contact = await CampaignContact.findOne({ 
            campaign: campaign._id,
            status: "PENDING"
        });

        if (!contact) {
            // No contacts left! Mark campaign as completed
            campaign.status = "COMPLETED";
            await campaign.save();
            isProcessing = false;
            return;
        }

        const userId = campaign.user.toString();
        const sessionId = campaign.session._id.toString();
        const number = contact.phone;

        try {
            // Ensure client is connected and ready
            const client = await getClientForMsg(userId, sessionId);
            if (!client.connected) {
                throw new Error("WhatsApp session completely disconnected");
            }

            // Simulate "Typing..."
            const clean = number.replace(/\D/g, "");
            const jid = `${clean}@s.whatsapp.net`;
            try {
                await client.sock.sendPresenceUpdate('composing', jid);
                // type for 2 to 5 seconds depending on text length roughly
                const typingTime = Math.min(Math.max(campaign.messageText.length * 40, 2000), 5000);
                await sleep(typingTime);
                await client.sock.sendPresenceUpdate('paused', jid);
            } catch (pErr) {
                console.error("Queue Presence failed ignoring: ", pErr.message);
            }

            // Send actual message
            const payload = await buildMediaPayload(campaign.messageText, campaign.mediaUrl, campaign.mediaType);
            console.log(`[CAMPAIGN QUEUE] 📦 Payload for ${number}:`, JSON.stringify(payload).substring(0, 120));
            await sendMessage(userId, sessionId, number, payload);

            // Mark Success
            contact.status = "SENT";
            await contact.save();
            
            // Advance progress manually
            await Campaign.findByIdAndUpdate(campaign._id, { $inc: { sentContacts: 1 } });
            
            // Critical Anti-Ban humanized random delay
            const waitTime = getRandomDelay(MIN_DELAY_MS, MAX_DELAY_MS);
            console.log(`[CAMPAIGN QUEUE] 🚀 Message sent to ${number}. Random Sleep: ${waitTime/1000}s...`);
            await sleep(waitTime);

        } catch (err) {
            console.error(`[CAMPAIGN QUEUE] ❌ Failed to send to ${number}:`, err.message);
            contact.status = "FAILED";
            contact.errorReason = err.message || "Unknown error";
            await contact.save();
            await Campaign.findByIdAndUpdate(campaign._id, { $inc: { failedContacts: 1 } });
            
            // wait a bit even on failure to avoid spam looping
            await sleep(3000);
        }

    } catch (err) {
        console.error("[CAMPAIGN QUEUE] Fatal Error:", err);
    } finally {
        isProcessing = false;
    }
}

// Start polling every second
export function startCampaignQueue() {
    console.log("🚀 [CAMPAIGN QUEUE] Anti-Ban Background Worker Started.");
    setInterval(processCampaignQueue, 1500);
}
