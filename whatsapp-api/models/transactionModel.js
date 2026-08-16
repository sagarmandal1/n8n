import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 10,
      max: 100000,
    },

    type: {
      type: String,
      required: true,
      enum: ["credit", "debit"],
    },

    by: {
      type: String,
      required: true,
    },
  },
  { timestamps: true },
);

const Transaction =
  mongoose.models.Transaction || mongoose.model("Transaction", transactionSchema);

export default Transaction;
