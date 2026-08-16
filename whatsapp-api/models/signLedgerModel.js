import mongoose from "mongoose";

const signLedgerSchema = new mongoose.Schema(
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
      default: null,
    },
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SignAgent",
      default: null,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SignOrder",
      default: null,
    },
    entryType: {
      type: String,
      enum: [
        "PREPAID_TOPUP",
        "TRUSTED_PAYMENT",
        "CUSTOMER_CHARGE",
        "AGENT_PAYABLE",
        "PROFIT",
      ],
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    note: {
      type: String,
      default: "",
    },
    meta: {
      type: Object,
      default: {},
    },
  },
  { timestamps: true },
);

signLedgerSchema.index({ user: 1, session: 1, entryType: 1, createdAt: -1 });

const SignLedger =
  mongoose.models.SignLedger || mongoose.model("SignLedger", signLedgerSchema);

export default SignLedger;
