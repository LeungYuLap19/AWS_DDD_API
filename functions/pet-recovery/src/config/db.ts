import mongoose from 'mongoose';
import env from './env';
import PetLostSchema from '../models/PetLost';
import PetFoundSchema from '../models/PetFound';
import PetSchema from '../models/Pet';
import ImageCollectionSchema from '../models/ImageCollection';
import RecoveryCounterSchema from '../models/RecoveryCounter';

let connectionPromise: Promise<typeof mongoose> | null = null;

function registerModels() {
  mongoose.models.PetLost || mongoose.model('PetLost', PetLostSchema, 'pet_lost');
  mongoose.models.PetFound || mongoose.model('PetFound', PetFoundSchema, 'pet_found');
  mongoose.models.Pet || mongoose.model('Pet', PetSchema, 'pets');
  mongoose.models.ImageCollection ||
    mongoose.model('ImageCollection', ImageCollectionSchema, 'image_collections');
  mongoose.models.RecoveryCounter ||
    mongoose.model('RecoveryCounter', RecoveryCounterSchema, 'recovery_counters');
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
