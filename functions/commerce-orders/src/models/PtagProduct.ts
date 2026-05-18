import { Schema } from 'mongoose';

const ptagProductSchema = new Schema(
  {
    name: { type: String, trim: true, required: true },
    deliveryCharge: { type: Number, default: 0 },
    options: {
      sizes: [{ type: String, trim: true }],
      colours: [{ type: String, trim: true }],
    },
    tiers: [
      {
        type: {
          type: String,
          trim: true,
          required: true,
        },
        price: {
          type: Number,
          required: true,
        },
      },
    ],
  },
  { timestamps: true }
);

export default ptagProductSchema;
