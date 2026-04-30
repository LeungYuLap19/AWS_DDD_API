import mongoose from 'mongoose';

const { Schema } = mongoose;

export const UserSchema = new Schema(
  {
    image: {
      type: String,
      default: '',
    },
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
    },
    role: {
      type: String,
      required: true,
      default: 'user',
    },
    verified: {
      type: Boolean,
      required: true,
      default: false,
    },
    subscribe: {
      type: Boolean,
      required: true,
      default: false,
    },
    promotion: {
      type: Boolean,
      required: true,
      default: false,
    },
    district: {
      type: String,
      default: null,
    },
    birthday: {
      type: Date,
      default: null,
    },
    deleted: {
      type: Boolean,
      default: false,
    },
    credit: {
      type: Number,
    },
    vetCredit: {
      type: Number,
    },
    eyeAnalysisCredit: {
      type: Number,
    },
    bloodAnalysisCredit: {
      type: Number,
    },
    phoneNumber: {
      type: String,
    },
    gender: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

UserSchema.index(
  { email: 1 },
  {
    name: 'email_active_unique',
    unique: true,
    partialFilterExpression: {
      deleted: false,
      email: { $exists: true, $type: 'string', $gt: '' },
    },
  }
);

UserSchema.index(
  { phoneNumber: 1 },
  {
    name: 'phone_active_unique',
    unique: true,
    partialFilterExpression: {
      deleted: false,
      phoneNumber: { $exists: true, $type: 'string', $gt: '' },
    },
  }
);

export default UserSchema;
