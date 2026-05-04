import mongoose from 'mongoose';

const { Schema } = mongoose;

const PetSourceSchema = new Schema(
  {
    petId: { type: Schema.Types.ObjectId, required: true },
    placeofOrigin: { type: String, default: null },
    channel: { type: String, default: null },
    rescueCategory: { type: [String], default: [] },
    causeOfInjury: { type: String, default: null },
  },
  { timestamps: true }
);

PetSourceSchema.index({ petId: 1 }, { unique: true });

export default PetSourceSchema;
