import mongoose from 'mongoose';

const { Schema } = mongoose;

export const VaccineRecordSchema = new Schema(
  {
    petId: { type: Schema.Types.ObjectId },
    vaccineDate: { type: Date, default: null },
    vaccineName: { type: String, default: null },
    vaccineNumber: { type: String, default: null },
    vaccineTimes: { type: String, default: null },
    vaccinePosition: { type: String, default: null },
  },
  { timestamps: true }
);

export default VaccineRecordSchema;
