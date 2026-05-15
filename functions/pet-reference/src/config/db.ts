import mongoose from 'mongoose';
import env from './env';
import AnimalSchema from '../models/Animal';
import AnthelminticSchema from '../models/Anthelmintic';

let connectionPromise: Promise<typeof mongoose> | null = null;

function registerModels(): void {
  if (!mongoose.models.Animal) mongoose.model('Animal', AnimalSchema, 'animal_list');
  if (!mongoose.models.Anthelmintic) mongoose.model('Anthelmintic', AnthelminticSchema, 'anthelmintic');
}

/**
 * Reuses the warm-container Mongoose connection, registers this Lambda's model
 * set after the connection is ready, and clears the cached promise if the
 * initial connect attempt fails.
 */
export async function connectToMongoDB(): Promise<typeof mongoose> {
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
