import mongoose from 'mongoose';

const { Schema } = mongoose;

export const MedicationRecordSchema = new Schema(
  {
    petId: { type: Schema.Types.ObjectId },
    medicationDate: { type: Date, default: null },
    drugName: { type: String, default: null },
    drugPurpose: { type: String, default: null },
    drugMethod: { type: String, default: null },
    drugRemark: { type: String, default: null },
    allergy: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default MedicationRecordSchema;
