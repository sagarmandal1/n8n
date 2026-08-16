import mongoose from "mongoose";

// Persistent LID → phone number map.
//
// WhatsApp increasingly addresses chats by LID, and Baileys can only resolve one
// to a phone number when it has the mapping in its own signal store — which it
// loses on a re-link or a fresh session. Once a LID has been resolved even once,
// remembering it here means later messages from the same person are still
// attributable, instead of being dropped as "unresolved LID".
const lidMapSchema = new mongoose.Schema(
  {
    session: { type: mongoose.Schema.Types.ObjectId, ref: "Session", required: true, index: true },
    lid: { type: String, required: true, index: true },
    phone: { type: String, required: true },
  },
  { timestamps: true },
);

lidMapSchema.index({ session: 1, lid: 1 }, { unique: true });

const LidMap = mongoose.models.LidMap || mongoose.model("LidMap", lidMapSchema);
export default LidMap;
