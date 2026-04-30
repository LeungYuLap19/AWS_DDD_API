import mongoose from 'mongoose';

const { Schema } = mongoose;

export const NgoCounterSchema = new Schema(
  {
    ngoId: { type: Schema.Types.ObjectId },
    counterType: { type: Object },
    ngoPrefix: { type: String },
    seq: { type: Number },
  },
  { timestamps: true }
);

export default NgoCounterSchema;
