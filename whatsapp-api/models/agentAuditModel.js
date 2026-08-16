import mongoose from "mongoose";

const agentAuditSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    session: { type: mongoose.Schema.Types.ObjectId, ref: "Session", required: true, index: true },
    eventType: {
      type: String,
      enum: [
        "CONTEXT_LOOKUP",
        "DOCUMENT_MATCH",
        "PAYMENT_CHECK",
        "DELIVERY_DECISION",
        "AGENT_RESPONSE",
        "PROCESSING_ERROR",
        "VOICE_TRANSCRIPTION",
      ],
      required: true,
      index: true,
    },
    customerPhone: { type: String, default: "", index: true },
    messageId: { type: String, default: "", index: true },
    outcome: { type: String, default: "" },
    confidence: { type: Number, default: 0, min: 0, max: 1 },
    needsReview: { type: Boolean, default: false, index: true },
    details: { type: Object, default: {} },
    error: { type: String, default: "" },
  },
  { timestamps: true },
);

agentAuditSchema.index({ user: 1, session: 1, createdAt: -1 });
agentAuditSchema.index(
  { user: 1, session: 1, messageId: 1, eventType: 1 },
  { unique: true, partialFilterExpression: { messageId: { $type: "string", $ne: "" } } },
);

const AgentAudit = mongoose.models.AgentAudit || mongoose.model("AgentAudit", agentAuditSchema);
export default AgentAudit;
