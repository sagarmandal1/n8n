import mongoose from "mongoose";

const dynamicOrderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    session: { type: mongoose.Schema.Types.ObjectId, ref: "Session", required: true, index: true },
    customerPhone: { type: String, required: true, index: true },
    applicationId: { type: String, required: true, index: true },
    name: { type: String, default: "" },
    englishName: { type: String, default: "" },
    dob: { type: String, default: "" },
    // Normalised to "male" / "female" so a Bangla order and an English
    // certificate still compare equal.
    gender: { type: String, default: "" },
    fatherName: { type: String, default: "" },
    motherName: { type: String, default: "" },
    address: { type: String, default: "" },
    birthRegistrationNumber: { type: String, default: "" },
    sourceMessageId: { type: String, default: "" },
    sourceText: { type: String, default: "" },
    status: { type: String, enum: ["PENDING", "DELIVERED", "MANUAL_REVIEW", "REVISION"], default: "PENDING", index: true },
    // Revision tracking. A file already delivered can come back for correction;
    // the corrected version is only sent on automatically when the vendor marks
    // it "Revision Done", so a half-finished edit never reaches the customer.
    revisionCount: { type: Number, default: 0 },
    lastRevisionAt: { type: Date, default: null },
    reviewReason: { type: String, default: "" },
    sellerPhone: { type: String, default: "" },
    // Set when the CEO forwards this customer's details to a vendor. It records
    // who was asked to do the work, so the returned file can be resolved by the
    // assignment rather than by content alone — which is what keeps deliveries
    // correct once hundreds of customers share common names.
    assignedVendor: { type: String, default: "", index: true },
    assignedAt: { type: Date, default: null },
    matchedFile: { type: String, default: "" },
    deliveryMessageId: { type: String, default: "" },
    matchedFields: { type: [String], default: [] },
    deliveredAt: { type: Date, default: null },
  },
  { timestamps: true },
);

dynamicOrderSchema.index({ user: 1, session: 1, customerPhone: 1, applicationId: 1 }, { unique: true });
// Every vendor file scans this session's pending orders. With hundreds of
// customers open at once that runs on each delivery, so it needs its own index
// rather than falling back to a single-field one and filtering in memory.
dynamicOrderSchema.index({ user: 1, session: 1, status: 1, createdAt: 1 });

const DynamicOrder = mongoose.models.DynamicOrder || mongoose.model("DynamicOrder", dynamicOrderSchema);
export default DynamicOrder;
