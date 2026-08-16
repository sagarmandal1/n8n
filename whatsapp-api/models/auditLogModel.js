import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    admin: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, required: true },       // e.g., "user_banned", "balance_added", "plan_created"
    target: { type: String, default: "" },           // e.g., user email or plan name
    details: { type: String, default: "" },          // additional info
    ip: { type: String, default: "" },
  },
  { timestamps: true }
);

const AuditLog = mongoose.models.AuditLog || mongoose.model("AuditLog", auditLogSchema);
export default AuditLog;
