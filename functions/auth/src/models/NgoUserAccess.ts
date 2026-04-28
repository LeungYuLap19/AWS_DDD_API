import mongoose from 'mongoose';

export const NgoUserAccessSchema = new mongoose.Schema(
  {
    ngoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'NGO',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    roleInNgo: {
      type: String,
      required: true,
      enum: ['admin', 'staff', 'helper', 'foster'],
      index: true,
    },
    assignedPetIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Pet',
      },
    ],
    menuConfig: {
      type: Object,
      default: {},
    },
    fosterDetails: {
      startDate: {
        type: Date,
        required() {
          return this.roleInNgo === 'foster';
        },
      },
      endDate: {
        type: Date,
        default: null,
      },
      status: {
        type: String,
        enum: ['active', 'pending_approval', 'completed', 'cancelled'],
        required() {
          return this.roleInNgo === 'foster';
        },
      },
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

NgoUserAccessSchema.index({ userId: 1, ngoId: 1 });
NgoUserAccessSchema.index({ userId: 1, isActive: 1 });
NgoUserAccessSchema.index({ ngoId: 1, roleInNgo: 1, isActive: 1 });

export default NgoUserAccessSchema;
