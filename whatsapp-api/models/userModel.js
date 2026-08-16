import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const subscriptionSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    autoRenew: {
      type: Boolean,
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "expired", "canceled"],
      default: "active",
    },
  },
  { _id: false },
);
const fwSubscriptionSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "expired", "canceled"],
      default: "active",
    },
    expiryAlertSent: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false },
);
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      match: /^[a-z][a-z0-9_-]*$/,
      index: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      index: true,
    },

    password: {
      type: String,
      required: true,
      minlength: 6,
      select: false, // 👈 hide by default
    },

    balance: {
      type: Number,
      default: 0,
      min: 0,
    },

    subscription: {
      type: subscriptionSchema,
      default: null,
    },

    fwSubscription: {
      type: fwSubscriptionSchema,
      default: null,
    },

    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },

    status: {
      type: String,
      enum: ["active", "banned"],
      default: "active",
    },
  },
  { timestamps: true },
);

userSchema.pre("save", function () {
  if (!this.isModified("password")) {
    return;
  }

  const salt = bcrypt.genSaltSync(10);
  this.password = bcrypt.hashSync(this.password, salt);
});

userSchema.methods.matchPassword = function (password) {
  return bcrypt.compareSync(password, this.password);
};

const User = mongoose.models.User || mongoose.model("User", userSchema);

export default User;
