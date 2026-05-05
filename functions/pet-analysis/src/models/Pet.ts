import mongoose from 'mongoose';

const { Schema } = mongoose;

export const PetSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId },
    ngoId: { type: String, default: null },
    deleted: { type: Boolean, default: false },
    eyeimages: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true, strict: false }
);

export default PetSchema;
