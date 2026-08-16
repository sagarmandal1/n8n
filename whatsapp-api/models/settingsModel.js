import mongoose from "mongoose";

const settingsSchema = new mongoose.Schema(
  {
    paymentGateway: {
      bKash: {
        appKey: { type: String, default: "" },
        appSecret: { type: String, default: "" },
        username: { type: String, default: "" },
        password: { type: String, default: "" },
        isActive: { type: Boolean, default: false }
      },
      stripe: {
        publicKey: { type: String, default: "" },
        secretKey: { type: String, default: "" },
        isActive: { type: Boolean, default: false }
      }
    },
    subscriptionPlans: [
      {
        id: { type: String, required: true },
        name: { type: String, required: true },
        price: { type: Number, required: true },
        durationDays: { type: Number, required: true },
        features: [{ type: String }],
        sessionLimit: { type: Number, default: 1 },
        maxCampaigns: { type: Number, default: 5 },
        isActive: { type: Boolean, default: true }
      }
    ],
    // Platform settings
    platform: {
      siteName: { type: String, default: "WaFastApi" },
      contactEmail: { type: String, default: "" },
      maintenanceMode: { type: Boolean, default: false },
      termsUrl: { type: String, default: "" },
      maxSessionsPerUser: { type: Number, default: 3 },
      welcomeMessage: { type: String, default: "Welcome to WaFastApi!" }
    }
  },
  { timestamps: true }
);

const Settings = mongoose.models.Settings || mongoose.model("Settings", settingsSchema);

export default Settings;

