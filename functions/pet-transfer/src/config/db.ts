import mongoose from 'mongoose';
import env from './env';
import PetSchema from '../models/Pet';
import UserSchema from '../models/User';

let connectionPromise: Promise<typeof mongoose> | null = null;

function registerModels() {
  mongoose.models.Pet || mongoose.model('Pet', PetSchema, 'pets');
  mongoose.models.User || mongoose.model('User', UserSchema, 'users');
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
