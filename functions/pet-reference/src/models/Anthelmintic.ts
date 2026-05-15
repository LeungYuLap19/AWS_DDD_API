import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Curated deworm reference collection. Only `brandName` is exposed to clients.
 */
export const AnthelminticSchema = new Schema(
  {
    brandName: { type: String, default: null },
  },
  { collection: 'anthelmintic' }
);

export default AnthelminticSchema;
