import mongoose from "mongoose";

const signCustomerSchema = new mongoose.Schema(
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
    customerType: {
      type: String,
      enum: ["prepaid", "trusted"],
      default: "prepaid",
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    assignedAgent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SignAgent",
      default: null,
    },
    sellRate: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    balance: {
      type: Number,
      default: 0,
      min: 0,
    },
    dueAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    creditLimit: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalBilled: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalPaid: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalDelivered: {
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

signCustomerSchema.index({ user: 1, session: 1, phone: 1 }, { unique: true });

const SignCustomer =
  mongoose.models.SignCustomer ||
  mongoose.model("SignCustomer", signCustomerSchema);

export default SignCustomer;
