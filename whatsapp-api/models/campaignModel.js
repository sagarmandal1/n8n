import mongoose from "mongoose";

const campaignSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    messageText: {
      type: String,
      required: true,
    },
    mediaUrl: {
      type: String,
      default: null,
    },
    mediaType: {
      type: String,
      enum: ["image", "video", "audio", "document", "none"],
      default: "none",
    },
    status: {
      type: String,
      enum: ["PENDING", "RUNNING", "PAUSED", "COMPLETED"],
      default: "PENDING",
    },
    totalContacts: {
      type: Number,
      default: 0,
    },
    sentContacts: {
      type: Number,
      default: 0,
    },
    failedContacts: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

const Campaign = mongoose.models.Campaign || mongoose.model("Campaign", campaignSchema);
export default Campaign;
