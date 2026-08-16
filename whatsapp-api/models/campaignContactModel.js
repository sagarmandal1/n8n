import mongoose from "mongoose";

const campaignContactSchema = new mongoose.Schema(
  {
    campaign: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
      index: true,
    },
    phone: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "SENT", "FAILED"],
      default: "PENDING",
    },
    errorReason: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

const CampaignContact = mongoose.models.CampaignContact || mongoose.model("CampaignContact", campaignContactSchema);
export default CampaignContact;
