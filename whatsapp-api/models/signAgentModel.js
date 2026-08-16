import mongoose from "mongoose";

const signAgentSchema = new mongoose.Schema(
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
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    lastDetectedRate: {
      type: Number,
      default: null,
      min: 0,
    },
    lastRateSourceText: {
      type: String,
      default: "",
    },
    lastRateDetectedAt: {
      type: Date,
      default: null,
    },
    totalDelivered: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalPayable: {
      type: Number,
      default: 0,
      min: 0,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true },
);

signAgentSchema.index({ user: 1, session: 1, phone: 1 }, { unique: true });

const SignAgent =
  mongoose.models.SignAgent || mongoose.model("SignAgent", signAgentSchema);

export default SignAgent;
