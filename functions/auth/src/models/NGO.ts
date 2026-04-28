import mongoose from 'mongoose';

export const NGOSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    description: {
      type: String,
    },
    email: {
      type: String,
      required: true,
    },
    phone: {
      type: String,
    },
    website: {
      type: String,
    },
    address: {
      type: String,
    },
    registrationNumber: {
      type: String,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    logo: {
      type: String,
      default: '',
    },
    socialMedia: {
      facebook: String,
      instagram: String,
      twitter: String,
      youtube: String,
    },
    establishedDate: {
      type: Date,
    },
    categories: [
      {
        type: String,
        enum: [
          'animal_rescue',
          'wildlife',
          'pet_adoption',
          'veterinary',
          'education',
          'rehabilitation',
          'shelter',
          'other',
        ],
      },
    ],
    petPlacementOptions: [
      {
        type: Object,
        name: {
          type: String,
        },
        positions: [
          {
            type: String,
          },
        ],
        default: [],
      },
    ],
    stats: {
      totalAnimalsHelped: {
        type: Number,
        default: 0,
      },
      totalVolunteers: {
        type: Number,
        default: 0,
      },
      totalDonations: {
        type: Number,
        default: 0,
      },
    },
  },
  {
    timestamps: true,
  }
);

NGOSchema.index({ name: 1 });
NGOSchema.index({ email: 1 });
NGOSchema.index({ isActive: 1, isVerified: 1 });
NGOSchema.index({ categories: 1 });

export default NGOSchema;
