import mongoose from 'mongoose';

const { Schema } = mongoose;

export const ApiLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, default: null },
    result: { type: Schema.Types.Mixed, default: null },
    error: { type: Schema.Types.Mixed, default: null },
    image_url: { type: String, default: null },
    token: { type: Number, default: null },
    model_type: { type: String, default: null },
  },
  { timestamps: true }
);

export default ApiLogSchema;
