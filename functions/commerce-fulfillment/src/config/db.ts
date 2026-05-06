import mongoose from 'mongoose';
import env from './env';
import OrderVerificationSchema from '../models/OrderVerification';
import OrderSchema from '../models/Order';

let connectionPromise: Promise<typeof mongoose> | null = null;

function registerModels() {
  mongoose.models.OrderVerification ||
    mongoose.model('OrderVerification', OrderVerificationSchema, 'orderVerification');
  mongoose.models.Order || mongoose.model('Order', OrderSchema, 'order');
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
