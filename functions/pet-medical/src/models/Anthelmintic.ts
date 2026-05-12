import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Reference list of dewormer brands. The legacy `GetBreed` Lambda read the
 * `anthelmintic` collection through the same `brandName` projection — the
 * schema is intentionally minimal because the document set is curated outside
 * the API and only `brandName` is rendered to clients.
 */
export const AnthelminticSchema = new Schema(
  {
    brandName: { type: String, default: null },
  },
  { collection: 'anthelmintic' }
);

export default AnthelminticSchema;
