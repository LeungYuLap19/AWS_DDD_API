import mongoose from 'mongoose';

const { Schema } = mongoose;

export const MedicalRecordSchema = new Schema(
  {
    petId: { type: Schema.Types.ObjectId },
    medicalDate: { type: Date, default: null },
    medicalPlace: { type: String, default: null },
    medicalDoctor: { type: String, default: null },
    medicalResult: { type: String, default: null },
    medicalSolution: { type: String, default: null },
  },
  { timestamps: true }
);

export default MedicalRecordSchema;
