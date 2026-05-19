import mongoose from 'mongoose';
import { getEnv } from './env';

let connectionPromise: Promise<typeof mongoose> | null = null;

/**
 * Reuses the warm-container Mongoose connection, registers this Lambda's model
 * set after the connection is ready, and clears the cached promise if the
 * initial connect attempt fails.
 */
export async function connectToMongoDB() {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  if (!connectionPromise) {
    const env = getEnv();
    connectionPromise = mongoose
      .connect(env.MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        maxPoolSize: 1,
      })
      .then((connection) => connection)
      .catch((error: unknown) => {
        connectionPromise = null;
        throw error;
      });
  }

  return connectionPromise;
}
