import mongoose from 'mongoose';

const { Schema } = mongoose;

const PetSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, default: null },
    ngoId: { type: String, default: null },
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default PetSchema;
