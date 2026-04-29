import mongoose from 'mongoose';
import env from './env';
import NGOSchema from '../models/NGO';
import NgoCounterSchema from '../models/NgoCounters';
import NgoUserAccessSchema from '../models/NgoUserAccess';
import UserSchema from '../models/User';

let connectionPromise: Promise<typeof mongoose> | null = null;

function registerModels() {
  mongoose.models.User || mongoose.model('User', UserSchema, 'users');
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
