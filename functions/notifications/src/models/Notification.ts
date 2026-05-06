import mongoose from 'mongoose';

const NotificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    type: {
      type: String,
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
    petId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    petName: {
      type: String,
      default: null,
    },
    nextEventDate: {
      type: Date,
      default: null,
    },
    nearbyPetLost: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

export default NotificationSchema;
