import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Compatibility counter schema retained for local model registration parity
 * with profile-owned collections.
 */
const NgoCountersSchema = new Schema(
  {
    ngoId: { type: String, required: true, index: true },
    counter: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default NgoCountersSchema;
