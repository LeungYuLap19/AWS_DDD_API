import mongoose from 'mongoose';

const { Schema } = mongoose;

const UserSchema = new Schema({}, { strict: false, timestamps: true });

export default UserSchema;
