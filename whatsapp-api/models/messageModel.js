import mongoose, { Types } from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    user:      { type: Types.ObjectId, ref: "User", required: true },
    session:   { type: Types.ObjectId, ref: "Session", required: true },
    message:   { type: Object, required: true },
    direction: { type: String, enum: ["sent", "received"], default: "sent" },
    fromNumber: { type: String, default: null },
    msgType:   { type: String, default: "text" },       // text, image, video, audio, document, sticker
    body:      { type: String, default: "" },           // extracted text content for quick display
    mediaUrl:  { type: String, default: null },
    displayName: { type: String, default: null },       // WhatsApp push name / contact display name
  },
  { timestamps: true }
);

// Index for quick inbox queries
messageSchema.index({ user: 1, session: 1, direction: 1, createdAt: -1 });

const Message = mongoose.models.Message || mongoose.model("Message", messageSchema);
export default Message;
