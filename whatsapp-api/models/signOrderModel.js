import mongoose from "mongoose";

const signOrderSchema = new mongoose.Schema(
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
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SignCustomer",
      required: true,
      index: true,
    },
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SignAgent",
      default: null,
      index: true,
    },
    sourceMessageId: {
      type: String,
      default: "",
    },
    requestedDigit: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    customerMessage: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: [
        "PENDING",
        "MATCHED",
        "DELIVERED",
        "MANUAL_REVIEW",
        "FUNDS_HOLD",
        "FAILED",
      ],
      default: "PENDING",
      index: true,
    },
    reviewReason: {
      type: String,
      default: "",
    },
    matchedDocument: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SignDocument",
      default: null,
    },
    detectedAgentRate: {
      type: Number,
      default: null,
      min: 0,
    },
    customerSellRate: {
      type: Number,
      default: null,
      min: 0,
    },
    adminProfit: {
      type: Number,
      default: null,
    },
    deliveryMessageId: {
      type: String,
      default: "",
    },
    deliveredAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

signOrderSchema.index({ user: 1, session: 1, status: 1, createdAt: -1 });

const SignOrder =
  mongoose.models.SignOrder || mongoose.model("SignOrder", signOrderSchema);

export default SignOrder;
