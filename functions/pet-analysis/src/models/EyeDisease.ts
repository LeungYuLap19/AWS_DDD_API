import mongoose from 'mongoose';

const { Schema } = mongoose;

export const EyeDiseaseSchema = new Schema(
  {
    eyeDisease_eng: { type: String, required: true },
    eyeDisease_chi: { type: String, required: true },
    eyeDisease_issue: { type: String, required: true },
    eyeDisease_care: { type: String, required: true },
    eyeDisease_issue_en: { type: String, required: true },
    eyeDisease_care_en: { type: String, required: true },
    eyeDisease_medication: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: false }
);

export default EyeDiseaseSchema;
