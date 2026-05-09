import mongoose from 'mongoose';
import env from './env';
import OrderSchema from '../models/Order';

let connectionPromise: Promise<typeof mongoose> | null = null;

function registerModels() {
  mongoose.models.Order || mongoose.model('Order', OrderSchema, 'order');
}

/**
 * Reuses the warm-container Mongoose connection, registers this Lambda's model
 * set after the connection is ready, and clears the cached promise if the
 * initial connect attempt fails.
 */
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
