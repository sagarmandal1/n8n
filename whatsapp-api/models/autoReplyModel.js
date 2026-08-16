import mongoose from "mongoose";

const autoReplySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    session: { type: mongoose.Schema.Types.ObjectId, ref: "Session", required: true },
    keyword: { type: String, required: true },
    replyText: { type: String, required: true },
    matchType: { type: String, enum: ["exact", "contains", "regex"], default: "exact" },
    isActive: { type: Boolean, default: true },
    mediaUrl: { type: String, default: null },
    mediaType: { type: String, enum: ["image", "video", "audio", "document", "none"], default: "none" }
  },
  { timestamps: true }
);

const AutoReply = mongoose.models.AutoReply || mongoose.model("AutoReply", autoReplySchema);
export default AutoReply;
