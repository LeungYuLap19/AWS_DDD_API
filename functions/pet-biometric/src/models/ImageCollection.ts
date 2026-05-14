import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Minimal image metadata record used by the upload helper before and after the
 * S3 write completes.
 */
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
