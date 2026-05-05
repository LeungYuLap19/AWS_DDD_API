import mongoose from 'mongoose';

const { Schema } = mongoose;

export const UserSchema = new Schema(
  {
    deleted: { type: Boolean, default: false },
  },
  { timestamps: true, strict: false }
);

export default UserSchema;
