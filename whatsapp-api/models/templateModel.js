import mongoose from "mongoose";

const templateSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    body: { type: String, required: true },
    category: {
      type: String,
      enum: ["promotional", "transactional", "support", "general"],
      default: "general",
    },
    mediaUrl:  { type: String, default: null },
    mediaType: { type: String, enum: ["image","video","audio","document","none"], default: "none" },
    usageCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const Template = mongoose.models.Template || mongoose.model("Template", templateSchema);
export default Template;
