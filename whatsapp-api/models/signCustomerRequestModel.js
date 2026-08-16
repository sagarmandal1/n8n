import mongoose from "mongoose";

const signCustomerRequestSchema = new mongoose.Schema(
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
    phone: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    senderName: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "blocked"],
      default: "pending",
      index: true,
    },
    requestedDigits: {
      type: [String],
      default: [],
    },
    lastMessage: {
      type: String,
      default: "",
    },
    lastMessageId: {
      type: String,
      default: "",
    },
    firstSeenAt: {
      type: Date,
      default: null,
    },
    lastSeenAt: {
      type: Date,
      default: null,
    },
    notifyCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastNotifiedAt: {
      type: Date,
      default: null,
    },
    customerNotifyCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastCustomerNotifiedAt: {
      type: Date,
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    rejectedAt: {
      type: Date,
      default: null,
    },
    blockedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

signCustomerRequestSchema.index({ user: 1, session: 1, phone: 1 }, { unique: true });
signCustomerRequestSchema.index({ user: 1, session: 1, status: 1, lastSeenAt: -1 });

const SignCustomerRequest =
  mongoose.models.SignCustomerRequest ||
  mongoose.model("SignCustomerRequest", signCustomerRequestSchema);

export default SignCustomerRequest;
