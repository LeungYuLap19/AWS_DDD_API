import mongoose from 'mongoose';

const { Schema } = mongoose;

export const PetLostSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId },
    petId: { type: String, default: null },
    serial_number: { type: String, default: null },
    lostDate: { type: Date, required: true, default: null },
    lostLocation: { type: String, required: true, default: null },
    lostDistrict: { type: String, required: true, default: null },
    name: { type: String, required: true, default: null },
    breedimage: { type: [String], default: [] },
    birthday: { type: Date, default: null },
    weight: { type: Number, default: null },
    sex: { type: String, required: true, default: null },
    sterilization: { type: Boolean, default: null },
    animal: { type: String, required: true, default: null },
    breed: { type: String, default: null },
    description: { type: String, default: null },
    remarks: { type: String, default: null },
    status: { type: String, default: null },
    owner: { type: String, default: null },
    ownerContact1: { type: Number, default: null },
  },
  { timestamps: true, strict: 'throw' }
);

export default PetLostSchema;
