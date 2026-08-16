import mongoose from "mongoose";

const forwardedOrderSchema = new mongoose.Schema(
  {
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true,
    },
    orderId: {
      type: String,
      required: true,
    },
    originalSender: {
      type: String,
      required: true,
    },
    forwardedMessageId: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "RESOLVED", "REJECTED"],
      default: "PENDING",
    }
  },
  { timestamps: true }
);

// Add index for fast lookup
forwardedOrderSchema.index({ orderId: 1 });
forwardedOrderSchema.index({ forwardedMessageId: 1 });

const ForwardedOrder = mongoose.models.ForwardedOrder || mongoose.model("ForwardedOrder", forwardedOrderSchema);
export default ForwardedOrder;
