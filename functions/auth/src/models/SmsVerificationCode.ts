import mongoose from 'mongoose';

const { Schema } = mongoose;

export const SmsVerificationCodeSchema = new Schema(
  {
    _id: {
      type: String,
    },
    codeHash: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    consumedAt: {
      type: Date,
      default: null,
    },
  },
  {
    _id: false,
    timestamps: { createdAt: true, updatedAt: false },
  }
);

export default SmsVerificationCodeSchema;
