import mongoose from 'mongoose';
import RefreshTokenSchema from '../models/RefreshToken';
import UserSchema from '../models/User';

export function ensureUserModel() {
  return mongoose.models.User || mongoose.model('User', UserSchema, 'users');
}

export function ensureRefreshTokenModel() {
  return mongoose.models.RefreshToken || mongoose.model('RefreshToken', RefreshTokenSchema, 'refresh_tokens');
}
