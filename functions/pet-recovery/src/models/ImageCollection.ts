import mongoose from 'mongoose';

const { Schema } = mongoose;

export const ImageCollectionSchema = new Schema(
  {
    fileName: { type: String, default: null },
    url: { type: String, default: null },
    fileSize: { type: Number, default: null },
    mimeType: { type: String, default: null },
    owner: { type: String, default: 'user' },
  },
  { timestamps: true }
);

export default ImageCollectionSchema;
