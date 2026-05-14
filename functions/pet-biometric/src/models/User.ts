import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Intentionally permissive compatibility schema for the shared `users`
 * collection.
 *
 * `pet-biometric` does not own user persistence and only needs model
 * registration compatibility when reusing profile-owned collections.
 */
const UserSchema = new Schema({}, { strict: false, timestamps: true });

export default UserSchema;
