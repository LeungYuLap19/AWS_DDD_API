import mongoose from 'mongoose';

const { Schema } = mongoose;

export const BloodTestRecordSchema = new Schema(
  {
    petId: { type: Schema.Types.ObjectId },
    userId: { type: Schema.Types.ObjectId },
    bloodTestDate: { type: Date, default: null },
    heartworm: { type: String, default: null },
    lymeDisease: { type: String, default: null },
    ehrlichiosis: { type: String, default: null },
    anaplasmosis: { type: String, default: null },
    babesiosis: { type: String, default: null },
  },
  { timestamps: true }
);

export default BloodTestRecordSchema;
