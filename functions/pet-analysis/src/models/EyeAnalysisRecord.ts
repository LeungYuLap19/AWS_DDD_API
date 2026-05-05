import mongoose from 'mongoose';

const { Schema } = mongoose;

export const EyeAnalysisRecordSchema = new Schema(
  {
    image: { type: String, default: null },
    result: { type: Schema.Types.Mixed, default: null },
    userId: { type: String, default: null },
    petId: { type: String, default: null },
    side: { type: String, default: null },
    heatmap: { type: String, default: null },
  },
  { timestamps: true }
);

export default EyeAnalysisRecordSchema;
