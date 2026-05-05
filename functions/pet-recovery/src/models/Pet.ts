import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Minimal Pet schema used by pet-recovery for ownership lookup and status updates
 * when a lost-pet report is linked to an owned pet.
 *
 * The full Pet schema is owned by the pet-profile lambda. This file only declares
 * the fields pet-recovery actually reads/writes.
 */
export const PetSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId },
    ngoId: { type: String },
    status: { type: String, default: null },
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true, strict: false }
);

export default PetSchema;
