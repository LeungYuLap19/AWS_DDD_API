import mongoose from 'mongoose';
import env from './env';
import UserSchema from '../models/User';
import RefreshTokenSchema from '../models/RefreshToken';
import EmailVerificationCodeSchema from '../models/EmailVerificationCode';
import SmsVerificationCodeSchema from '../models/SmsVerificationCode';
import NGOSchema from '../models/NGO';
import NgoCounterSchema from '../models/NgoCounters';
import NgoUserAccessSchema from '../models/NgoUserAccess';

let connectionPromise: Promise<typeof mongoose> | null = null;

function registerModels() {
  mongoose.models.User || mongoose.model('User', UserSchema, 'users');
  mongoose.models.RefreshToken || mongoose.model('RefreshToken', RefreshTokenSchema, 'refresh_tokens');
  mongoose.models.EmailVerificationCode ||
    mongoose.model('EmailVerificationCode', EmailVerificationCodeSchema, 'email_verification_codes');
  mongoose.models.SmsVerificationCode ||
    mongoose.model('SmsVerificationCode', SmsVerificationCodeSchema, 'sms_verification_codes');
  mongoose.models.NGO || mongoose.model('NGO', NGOSchema, 'ngos');
  mongoose.models.NgoCounters || mongoose.model('NgoCounters', NgoCounterSchema, 'ngo_counters');
  mongoose.models.NgoUserAccess ||
    mongoose.model('NgoUserAccess', NgoUserAccessSchema, 'ngo_user_access');
}

export async function connectToMongoDB() {
  if (mongoose.connection.readyState === 1) {
    registerModels();
    return mongoose;
  }

  if (!connectionPromise) {
    connectionPromise = mongoose
      .connect(env.MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        maxPoolSize: 1,
      })
      .then((connection) => {
        registerModels();
        return connection;
      })
      .catch((error: unknown) => {
        connectionPromise = null;
        throw error;
      });
  }

  return connectionPromise;
}
