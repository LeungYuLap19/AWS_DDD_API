import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Slim Pet schema used by pet-medical for ownership checks only.
 * `pet-medical` does not maintain summary counters / latest-date fields:
 * legacy `medicalRecordsCount`, `medicationRecordsCount`,
 * `dewormRecordsCount`, `bloodTestRecordsCount`, `latestDewormDate`, and
 * `latestBloodTestDate` were unread anywhere in either repo and have been
 * dropped from the write path to eliminate counter races.
 * `strict: false` keeps existing documents intact in the collection.
 */
export const PetSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId },
    ngoId: { type: String },
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true, strict: false }
);

export default PetSchema;
