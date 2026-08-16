import mongoose from "mongoose";

const sessionModel = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
    },
    apiKey: {
      type: String,
      unique: true,
    },
    webhookUrl: {
      type: String,
    },
    webhookSecret: {
      type: String,
      select: false,
    },
    fallbackEnabled: {
      type: Boolean,
      default: false,
    },
    fallbackMessage: {
      type: String,
      default: "",
    },
    aiEnabled: {
      type: Boolean,
      default: false,
    },
    openAiKey: {
      type: String,
      default: "",
    },
    aiPrompt: {
      type: String,
      default: "",
    },
    forwardingEnabled: {
      type: Boolean,
      default: false,
    },
    forwardingTarget: {
      type: String,
      default: "",
    },
    forwardingShowSender: {
      type: Boolean,
      default: true,
    },
    // Where a seller document goes when it cannot be auto-delivered safely
    // (no match, ambiguous match, or an error). Without this the file is only
    // written to the audit trail and nobody is told, so the customer never
    // receives it and no one knows to follow up manually.
    undeliveredEnabled: {
      type: Boolean,
      default: false,
    },
    undeliveredTarget: {
      type: String,
      default: "",
    },
    // Vendors entered through the dashboard. Works alongside vendors.txt —
    // a number in EITHER source is treated as a vendor.
    vendorNumbers: {
      type: [String],
      default: [],
    },
    // Optional group the CEO uses only for vendors. Recorded so the dashboard
    // can show it; vendor identity itself still comes from the number.
    vendorGroupJid: {
      type: String,
      default: "",
    },
    signCopySettings: {
      notifyEnabled: {
        type: Boolean,
        default: true,
      },
      notifyTargets: {
        type: [String],
        default: [],
      },
      rateLimitMinutes: {
        type: Number,
        default: 10,
        min: 0,
      },
      blocklist: {
        type: [String],
        default: [],
      },
    },
  },
  { timestamps: true },
);
sessionModel.pre("save", function () {
  if (!this.apiKey) {
    this.apiKey = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
});

const Session = mongoose.models.Session || mongoose.model("Session", sessionModel);
export default Session;
