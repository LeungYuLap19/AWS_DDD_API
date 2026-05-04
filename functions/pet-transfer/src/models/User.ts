import mongoose from 'mongoose';

const { Schema } = mongoose;

const UserSchema = new Schema(
  {
    email: { type: String, trim: true, lowercase: true },
    phoneNumber: { type: String, default: '' },
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default UserSchema;
