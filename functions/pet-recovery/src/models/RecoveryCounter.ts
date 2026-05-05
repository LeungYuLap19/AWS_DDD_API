import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Single-document counter for atomic pet recovery serial number generation.
 * The document with _id 'petRecovery' is upserted on first use.
 */
export const RecoveryCounterSchema = new Schema(
  {
    _id: { type: String },
    seq: { type: Number, default: 0 },
  },
  { timestamps: false, _id: false }
);

export default RecoveryCounterSchema;
