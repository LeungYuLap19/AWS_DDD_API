import mongoose from 'mongoose';

const { Schema } = mongoose;

const NgoCountersSchema = new Schema(
  {
    ngoId: { type: String, required: true, index: true },
    counter: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default NgoCountersSchema;
