import mongoose from "mongoose";

const rechargeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    id: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 10,
      max: 100000,
    },

    number: {
      type: String,
      required: true,
      // Accepts BD mobile numbers OR bKash-PGW (automated gateway)
    },
    method: {
      type: String,
      required: true,
    },

    transactionId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "completed", "failed"],
      default: "pending",
      index: true,
    },

    adminNote: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  { timestamps: true },
);

// Index for faster queries
rechargeSchema.index({ createdAt: -1 });
rechargeSchema.index({ user: 1, status: 1 });

const Recharge =
  mongoose.models.Recharge || mongoose.model("Recharge", rechargeSchema);

export default Recharge;
