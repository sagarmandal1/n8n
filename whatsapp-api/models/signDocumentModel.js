import mongoose from "mongoose";

const signDocumentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true,
      index: true,
    },
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SignAgent",
      required: true,
      index: true,
    },
    sourceMessageId: {
      type: String,
      default: "",
    },
    originalFileName: {
      type: String,
      default: "",
    },
    storedPath: {
      type: String,
      required: true,
    },
    mimeType: {
      type: String,
      default: "",
    },
    caption: {
      type: String,
      default: "",
    },
    extractedText: {
      type: String,
      default: "",
    },
    extractionMethod: {
      type: String,
      enum: ["TEXT", "OCR", "NONE"],
      default: "NONE",
    },
    rateDetected: {
      type: Number,
      default: null,
      min: 0,
    },
    rateConfidence: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ["RECEIVED", "MATCHED", "MANUAL_REVIEW"],
      default: "RECEIVED",
      index: true,
    },
    reviewReason: {
      type: String,
      default: "",
    },
    matchedOrders: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "SignOrder",
      },
    ],
  },
  { timestamps: true },
);

signDocumentSchema.index({ user: 1, session: 1, agent: 1, createdAt: -1 });

const SignDocument =
  mongoose.models.SignDocument ||
  mongoose.model("SignDocument", signDocumentSchema);

export default SignDocument;
