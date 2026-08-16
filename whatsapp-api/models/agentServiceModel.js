import mongoose from "mongoose";

const agentServiceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    session: { type: mongoose.Schema.Types.ObjectId, ref: "Session", required: true, index: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    requirements: { type: [String], default: [] },
    deliveryTime: { type: String, default: "" },
    priceText: { type: String, default: "যোগাযোগ করে নিশ্চিত করুন" },
    keywords: { type: [String], default: [] },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

agentServiceSchema.index({ user: 1, session: 1, code: 1 }, { unique: true });

const AgentService = mongoose.models.AgentService || mongoose.model("AgentService", agentServiceSchema);
export default AgentService;
