import mongoose from 'mongoose';
import env from './env';
import ImageCollectionSchema from '../models/ImageCollection';
import NgoCounterSchema from '../models/NgoCounters';
import PetSchema from '../models/Pet';
import UserSchema from '../models/User';

let connectionPromise: Promise<typeof mongoose> | null = null;

function registerModels() {
  mongoose.models.User || mongoose.model('User', UserSchema, 'users');
  mongoose.models.Pet || mongoose.model('Pet', PetSchema, 'pets');
  mongoose.models.NgoCounters || mongoose.model('NgoCounters', NgoCounterSchema, 'ngo_counters');
  mongoose.models.ImageCollection || mongoose.model('ImageCollection', ImageCollectionSchema, 'image_collections');
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
