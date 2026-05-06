import mongoose from 'mongoose';
import env from './env';
import OrderSchema from '../models/Order';
import OrderVerificationSchema from '../models/OrderVerification';
import ShopInfoSchema from '../models/ShopInfo';
import ImageCollectionSchema from '../models/ImageCollection';

let connectionPromise: Promise<typeof mongoose> | null = null;

function registerModels() {
  mongoose.models.Order || mongoose.model('Order', OrderSchema, 'order');
  mongoose.models.OrderVerification ||
    mongoose.model('OrderVerification', OrderVerificationSchema, 'orderVerification');
  mongoose.models.ShopInfo || mongoose.model('ShopInfo', ShopInfoSchema, 'shopInfo');
  mongoose.models.ImageCollection ||
    mongoose.model('ImageCollection', ImageCollectionSchema, 'imageCollection');
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
