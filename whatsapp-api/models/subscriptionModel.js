import mongoose from "mongoose";

// Define the schema as a plain object, not as a model
const subscriptionSchemaDefinition = {
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
    default: true,
  },
  billingCycle: {
    type: String,
    enum: ['monthly', 'yearly'],
    default: 'monthly',
  },
  status: {
    type: String,
    enum: ['active', 'expired', 'cancelled', 'payment_failed'],
    default: 'active',
  },
  lastRenewal: {
    type: Date,
  },
  lastPaymentAttempt: {
    type: Date,
  },
  cancellationReason: {
    type: String,
  },
  cancellationDate: {
    type: Date,
  },
  downgradeTo: {
    type: String,
  },
  downgradePending: {
    type: Boolean,
    default: false,
  },
};

// Create schema object (not model)
const subscriptionSchema = new mongoose.Schema(
  subscriptionSchemaDefinition,
  { 
    _id: false,
    timestamps: false 
  }
);

// Export the schema, not a model
export default subscriptionSchema;