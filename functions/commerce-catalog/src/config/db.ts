import mongoose from 'mongoose';
import env from './env';
import { ProductListSchema } from '../models/ProductList';
import { ProductLogSchema } from '../models/ProductLog';
import { ShopInfoSchema } from '../models/ShopInfo';

let connectionPromise: Promise<typeof mongoose> | null = null;

function registerModels() {
  mongoose.models.ProductList || mongoose.model('ProductList', ProductListSchema, 'product');
  mongoose.models.ProductLog || mongoose.model('ProductLog', ProductLogSchema, 'product_log');
  mongoose.models.ShopInfo || mongoose.model('ShopInfo', ShopInfoSchema, 'shopInfo');
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
