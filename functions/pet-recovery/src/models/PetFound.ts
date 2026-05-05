import mongoose from 'mongoose';

const { Schema } = mongoose;

export const PetFoundSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId },
    serial_number: { type: String, default: null },
    foundDate: { type: Date, required: true, default: null },
    foundLocation: { type: String, required: true, default: null },
    foundDistrict: { type: String, required: true, default: null },
    breedimage: { type: [String], default: [] },
    animal: { type: String, required: true, default: null },
    description: { type: String, default: null },
    remarks: { type: String, default: null },
    status: { type: String, default: null },
    owner: { type: String, default: null },
    ownerContact1: { type: Number, default: null },
    breed: { type: String, default: null },
  },
  { timestamps: true, strict: 'throw' }
);

export default PetFoundSchema;
