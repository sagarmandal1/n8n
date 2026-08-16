import mongoose from "mongoose";

// History of files actually delivered to a customer.
//
// Keyed by a hash of the file's bytes rather than its name, because vendors name
// files arbitrarily and the same document arrives as "41k.pdf", "final.pdf" or
// an auto-generated timestamp. Content is the only stable identity.
//
// An edited file hashes differently, so a genuine revision is never mistaken for
// a duplicate — only a byte-identical resend is.
const deliveredFileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    session: { type: mongoose.Schema.Types.ObjectId, ref: "Session", required: true, index: true },
    customerPhone: { type: String, required: true, index: true },
    fileHash: { type: String, required: true, index: true },
    fileName: { type: String, default: "" },
    applicationId: { type: String, default: "" },
    sellerPhone: { type: String, default: "" },
    deliveryMessageId: { type: String, default: "" },
  },
  { timestamps: true },
);

// One record per customer per distinct file.
deliveredFileSchema.index({ session: 1, customerPhone: 1, fileHash: 1 }, { unique: true });

const DeliveredFile = mongoose.models.DeliveredFile || mongoose.model("DeliveredFile", deliveredFileSchema);
export default DeliveredFile;
