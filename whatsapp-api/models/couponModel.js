import mongoose from "mongoose";

const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    discountPercent: { type: Number, required: true, min: 1, max: 100 },
    maxUses: { type: Number, default: 0 },        // 0 = unlimited
    usedCount: { type: Number, default: 0 },
    expiresAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
    applicablePlans: [{ type: String }],            // empty = all plans
    description: { type: String, default: "" },
  },
  { timestamps: true }
);

const Coupon = mongoose.models.Coupon || mongoose.model("Coupon", couponSchema);
export default Coupon;
