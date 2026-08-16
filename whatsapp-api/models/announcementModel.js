import mongoose from "mongoose";

const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, required: true, maxlength: 2000 },
    type: { type: String, enum: ["info", "warning", "success", "urgent"], default: "info" },
    isActive: { type: Boolean, default: true },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const Announcement = mongoose.models.Announcement || mongoose.model("Announcement", announcementSchema);
export default Announcement;
