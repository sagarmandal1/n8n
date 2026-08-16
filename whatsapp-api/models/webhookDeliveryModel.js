import mongoose from "mongoose";

const webhookDeliverySchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    session: { type: mongoose.Schema.Types.ObjectId, ref: "Session", required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    event: { type: String, required: true, index: true },
    endpoint: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "delivered", "failed"],
      default: "pending",
      index: true,
    },
    attempts: { type: Number, default: 0 },
    httpStatus: { type: Number, default: null },
    lastError: { type: String, default: "" },
    deliveredAt: { type: Date, default: null },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      expires: 0,
    },
  },
  { timestamps: true },
);

const WebhookDelivery =
  mongoose.models.WebhookDelivery ||
  mongoose.model("WebhookDelivery", webhookDeliverySchema);

export default WebhookDelivery;
