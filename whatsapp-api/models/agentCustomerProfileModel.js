import mongoose from "mongoose";

const agentCustomerProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    session: { type: mongoose.Schema.Types.ObjectId, ref: "Session", required: true, index: true },
    phone: { type: String, required: true, index: true },
    role: { type: String, enum: ["customer", "seller", "unknown"], default: "unknown" },
    lastIntent: { type: String, default: "" },
    sentiment: { type: String, default: "neutral" },
    lifecycleStage: { type: String, default: "" },
    serviceCode: { type: String, default: "" },
    entities: { type: Object, default: {} },
    messageCount: { type: Number, default: 0, min: 0 },
    lastMessageAt: { type: Date, default: null },
  },
  { timestamps: true },
);

agentCustomerProfileSchema.index({ user: 1, session: 1, phone: 1 }, { unique: true });

const AgentCustomerProfile = mongoose.models.AgentCustomerProfile || mongoose.model("AgentCustomerProfile", agentCustomerProfileSchema);
export default AgentCustomerProfile;
